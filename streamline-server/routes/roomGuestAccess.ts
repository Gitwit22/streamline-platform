import { Router } from "express";
import admin from "firebase-admin";
import jwt from "jsonwebtoken";
import { firestore } from "../firebaseAdmin";
import { tryGetAuthUser, verifyInviteToken } from "../middleware/requireAuth";
import { tryGetGuestSession } from "../middleware/guestSession";
import { verifyRoomAccessToken } from "../middleware/roomAccessToken";
import { sanitizeDisplayName } from "../lib/sanitizeDisplayName";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { signGuestSession } from "../middleware/guestSession";
import { roleToParticipantPermission } from "../lib/livekitPermissions";

export function extractInviteToken(req: any): string | null {
  const hdr = (req?.headers as any) || {};
  const fromHeader = hdr["x-invite-token"] ?? hdr["X-Invite-Token"];
  if (typeof fromHeader === "string" && fromHeader.trim()) return fromHeader.trim();
  // Fallback: some clients may pass the invite token in the room-access header.
  const fromRoomAccessHeader = hdr["x-room-access-token"] ?? hdr["X-Room-Access-Token"];
  if (typeof fromRoomAccessHeader === "string" && fromRoomAccessHeader.trim()) return fromRoomAccessHeader.trim();
  const fromBody = req?.body?.inviteToken;
  if (typeof fromBody === "string" && fromBody.trim()) return fromBody.trim();
  const fromQuery = req?.query?.inviteToken ?? req?.query?.t;
  if (typeof fromQuery === "string" && fromQuery.trim()) return fromQuery.trim();
  return null;
}

export function tryGetLegacyInviteGuest(req: any, roomId: string): { inviteId: string; roomId: string; role: "guest" | "participant" } | null {
  const raw = extractInviteToken(req);
  if (!raw) return null;
  try {
    let claims: any;
    try {
      claims = verifyInviteToken(raw) as any;
    } catch {
      // Also allow roomAccessTokens in invite flows (share links).
      claims = verifyRoomAccessToken(raw) as any;
    }
    const claimRoomId = typeof claims?.roomId === "string" ? claims.roomId.trim() : "";
    // Normalize role: defensive parse, trim whitespace, lowercase
    const rawRole = String(claims?.role ?? "").trim().toLowerCase();
    // Never allow elevated roles through legacy invite JWTs for guest RTC join.
    // Cohost (and legacy moderator) invites must be handled by the authed flow.
    if (rawRole === "host" || rawRole === "cohost" || rawRole === "moderator") return null;
    if (!claimRoomId || claimRoomId !== roomId) return null;

    const inviteId = `legacy:${Buffer.from(raw).toString("base64url").slice(0, 24)}`;
    // Backward compatibility: treat old "viewer" role as "guest" for /room flows
    // Security: Explicitly validate known roles, reject unknown/corrupted values
    let role: "guest" | "participant";
    if (rawRole === "participant") {
      role = "participant";
    } else if (rawRole === "guest" || rawRole === "viewer") {
      role = "guest"; // Map legacy "viewer" to "guest"
    } else {
      // Unknown/corrupted role - reject for security
      return null;
    }
    return { inviteId, roomId, role };
  } catch {
    return null;
  }
}

async function getAccessTokenCtor() {
  const mod = await import("livekit-server-sdk");
  return mod.AccessToken;
}

function getLiveKitServerUrlForClient(): string | null {
  const raw = String(process.env.LIVEKIT_URL || "").trim();
  if (!raw) return null;
  // LiveKit client expects ws(s) URLs. Allow operators to configure https(s)
  // and normalize it safely.
  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
  }
  return raw;
}

function getRoomAccessSecret() {
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  const explicit = process.env.ROOM_ACCESS_TOKEN_SECRET;
  const fallback = process.env.JWT_SECRET;
  const raw = String(explicit || fallback || "").trim();

  // In production/staging we require a real secret, but we allow falling back to
  // JWT_SECRET for backwards compatibility with older deployments.
  if (env === "production" || env === "staging") {
    if (!raw || raw === "dev-secret") {
      throw new Error("ROOM_ACCESS_TOKEN_SECRET (or JWT_SECRET) must be set (no dev-secret in production)");
    }
    if (!explicit && process.env.AUTH_DEBUG === "1") {
      console.warn("[roomGuestAccess] Using JWT_SECRET fallback for ROOM_ACCESS_TOKEN_SECRET");
    }
  }

  return raw || "dev-secret";
}

function roleGrant(role: "guest" | "participant" | "host") {
  // Use canonical roleToParticipantPermission() for consistency
  const participantPerm = roleToParticipantPermission(role);
  const isHost = role === "host";

  return {
    roomJoin: true,
    canSubscribe: participantPerm.canSubscribe,
    canPublish: participantPerm.canPublish,
    canPublishData: participantPerm.canPublishData,
    canPublishSources: participantPerm.canPublishSources,
    roomAdmin: isHost,
  } as const;
}

const router = Router();

// Simple, best-effort in-memory IP rate limiter for invite redemption.
// This is not perfect in multi-instance deployments, but it stops obvious abuse.
const redeemIpWindowMs = 60_000;
const redeemIpMax = 12;
const redeemIpHits = new Map<string, { count: number; resetAt: number }>();

function hitRedeemRateLimit(ip: string): boolean {
  const now = Date.now();
  const key = ip || "unknown";
  const existing = redeemIpHits.get(key);
  if (!existing || now >= existing.resetAt) {
    redeemIpHits.set(key, { count: 1, resetAt: now + redeemIpWindowMs });
    return false;
  }
  existing.count += 1;
  if (existing.count > redeemIpMax) return true;
  return false;
}

// Per-inviteId rate limiter to prevent abuse of specific invite links
const inviteIdWindowMs = 30_000; // 30 seconds
const inviteIdMax = 20; // Max 20 joins per invite per 30s
const inviteIdHits = new Map<string, { count: number; resetAt: number }>();

function hitInviteIdRateLimit(inviteId: string): boolean {
  const now = Date.now();
  const existing = inviteIdHits.get(inviteId);
  if (!existing || now >= existing.resetAt) {
    inviteIdHits.set(inviteId, { count: 1, resetAt: now + inviteIdWindowMs });
    return false;
  }
  existing.count += 1;
  if (existing.count > inviteIdMax) return true;
  return false;
}

// Idempotency tracking: prevent rapid duplicate joins from same client
// Key: inviteId:deviceFingerprint, Value: { identity, expiresAt }
const idempotencyCache = new Map<string, { identity: string; expiresAt: number }>();
const idempotencyCacheTtl = 10_000; // 10 seconds

function generateDeviceFingerprint(req: any): string {
  // Simple fingerprint from IP + User-Agent
  // In production, could use more sophisticated techniques
  const ip = String(req.ip || req.connection?.remoteAddress || "unknown");
  const ua = String(req.get("user-agent") || "unknown");
  return `${ip}:${ua.substring(0, 100)}`;
}

function checkIdempotency(inviteId: string, fingerprint: string): { identity: string } | null {
  const now = Date.now();
  const key = `${inviteId}:${fingerprint}`;
  const cached = idempotencyCache.get(key);
  if (cached && now < cached.expiresAt) {
    return { identity: cached.identity };
  }
  // Clean up expired entries
  if (cached && now >= cached.expiresAt) {
    idempotencyCache.delete(key);
  }
  return null;
}

function setIdempotency(inviteId: string, fingerprint: string, identity: string): void {
  const now = Date.now();
  const key = `${inviteId}:${fingerprint}`;
  idempotencyCache.set(key, {
    identity,
    expiresAt: now + idempotencyCacheTtl,
  });
}

/**
 * POST /api/invites/:inviteId/redeem
 * Auth: none
 * Sets: HttpOnly cookie sl_guest=<signedJWT>
 * Returns: { roomId }
 */
router.post("/invites/:inviteId/redeem", async (req: any, res) => {
  try {
    const inviteId = String(req.params.inviteId || "").trim();
    if (!inviteId) return res.status(400).json({ error: "inviteId_required" });

    const ip = String(req.ip || "");
    if (hitRedeemRateLimit(ip)) {
      return res.status(429).json({ error: "rate_limited" });
    }

    const inviteRef = firestore.collection("roomInvites").doc(inviteId);

    const result = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(inviteRef);
      if (!snap.exists) {
        return { ok: false as const, status: 404 as const, error: "invite_not_found" };
      }

      const data = (snap.data() as any) || {};
      const roomId = String(data.roomId || "").trim();
      if (!roomId) {
        return { ok: false as const, status: 409 as const, error: "invite_room_missing" };
      }

      if (data.revokedAt) {
        return { ok: false as const, status: 403 as const, error: "invite_revoked" };
      }

      const expiresAtMs = (data.expiresAt as any)?.toMillis?.() ?? null;
      if (expiresAtMs && expiresAtMs < Date.now()) {
        return { ok: false as const, status: 410 as const, error: "invite_expired" };
      }

      const maxUses = data.maxUses ?? null;
      const useCount = Number(data.useCount || 0);
      if (maxUses !== null && Number(maxUses) > 0 && useCount >= Number(maxUses)) {
        return { ok: false as const, status: 410 as const, error: "invite_max_used" };
      }

      tx.update(inviteRef, {
        useCount: useCount + 1,
        lastRedeemedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { ok: true as const, roomId };
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    const expiresIn = "2h";
    const sessionJwt = signGuestSession({ inviteId, roomId: result.roomId, role: "guest" }, expiresIn);

    // CRITICAL: Use SameSite=None in production for cross-site compatibility (FB/IG in-app browsers).
    // Requires Secure=true. Local dev uses Lax since localhost is same-site.
    const isProduction = String(process.env.NODE_ENV || "development").toLowerCase() === "production";
    const secure = isProduction;
    const sameSite: "none" | "lax" = isProduction ? "none" : "lax";

    res.cookie("sl_guest", sessionJwt, {
      httpOnly: true,
      sameSite,
      secure,
      path: "/",
      maxAge: 2 * 60 * 60 * 1000,
    });

    return res.json({ roomId: result.roomId, guestSessionToken: sessionJwt });
  } catch (err: any) {
    console.error("/api/invites/:inviteId/redeem error", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /api/invites/:inviteId/join-now
 * Auth: none (creates guest session)
 * Body: { displayName?: string }
 * Returns: { serverUrl, roomToken, roomId, identity, displayName, guestSessionToken, roomAccessToken, isViewer, role }
 * 
 * Consolidated endpoint that combines:
 * 1. Invite redemption (validates invite, increments use count)
 * 2. LiveKit token minting
 * 3. Guest session creation
 * 
 * This eliminates multiple round-trips for guest join flow, improving time-to-video.
 */
router.post("/invites/:inviteId/join-now", async (req: any, res) => {
  const startTime = Date.now();
  let logPayload: any = { inviteId: "unknown", event: "join_now_start" };
  
  try {
    const inviteId = String(req.params.inviteId || "").trim();
    logPayload.inviteId = inviteId;
    
    if (!inviteId) {
      logPayload.event = "join_now_fail";
      logPayload.reason = "inviteId_required";
      console.log("[join-now]", logPayload);
      return res.status(400).json({ error: "inviteId_required" });
    }

    const ip = String(req.ip || "");
    
    // IP rate limiting
    if (hitRedeemRateLimit(ip)) {
      logPayload.event = "join_now_fail";
      logPayload.reason = "ip_rate_limited";
      logPayload.ip = ip;
      console.log("[join-now]", logPayload);
      return res.status(429).json({ error: "rate_limited" });
    }
    
    // Per-inviteId rate limiting
    if (hitInviteIdRateLimit(inviteId)) {
      logPayload.event = "join_now_fail";
      logPayload.reason = "invite_rate_limited";
      console.log("[join-now]", logPayload);
      return res.status(429).json({ error: "rate_limited" });
    }
    
    // Idempotency check: prevent duplicate sessions from rapid double-clicks
    const deviceFingerprint = generateDeviceFingerprint(req);
    const existingSession = checkIdempotency(inviteId, deviceFingerprint);
    if (existingSession) {
      logPayload.event = "join_now_idempotent";
      logPayload.cachedIdentity = existingSession.identity;
      console.log("[join-now]", logPayload);
      // Return cached identity but regenerate tokens (they're cheap)
      // This prevents weird duplicate sessions while still allowing token refresh
    }

    // Step 1: Redeem the invite (validate + increment use count)
    const inviteRef = firestore.collection("roomInvites").doc(inviteId);

    const redeemResult = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(inviteRef);
      if (!snap.exists) {
        logPayload.reason = "invite_not_found";
        return { ok: false as const, status: 404 as const, error: "invite_not_found" };
      }

      const data = (snap.data() as any) || {};
      const roomId = String(data.roomId || "").trim();
      if (!roomId) {
        logPayload.reason = "invite_room_missing";
        return { ok: false as const, status: 409 as const, error: "invite_room_missing" };
      }

      if (data.revokedAt) {
        logPayload.reason = "invite_revoked";
        return { ok: false as const, status: 403 as const, error: "invite_revoked" };
      }

      const expiresAtMs = (data.expiresAt as any)?.toMillis?.() ?? null;
      if (expiresAtMs && expiresAtMs < Date.now()) {
        logPayload.reason = "invite_expired";
        logPayload.expiresAtMs = expiresAtMs;
        return { ok: false as const, status: 410 as const, error: "invite_expired" };
      }

      const maxUses = data.maxUses ?? null;
      const useCount = Number(data.useCount || 0);
      
      // Enforce single-use invites strictly
      if (maxUses === 1 && useCount >= 1) {
        logPayload.reason = "single_use_exhausted";
        logPayload.useCount = useCount;
        return { ok: false as const, status: 409 as const, error: "invite_already_used" };
      }
      
      // Enforce multi-use max atomically
      if (maxUses !== null && Number(maxUses) > 1 && useCount >= Number(maxUses)) {
        logPayload.reason = "max_uses_reached";
        logPayload.maxUses = maxUses;
        logPayload.useCount = useCount;
        return { ok: false as const, status: 410 as const, error: "invite_max_used" };
      }

      // Atomically increment use count
      tx.update(inviteRef, {
        useCount: useCount + 1,
        lastRedeemedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Backward compatibility: treat old "viewer" role as "guest" for /room flows
      // Security: Explicitly validate known roles, reject unknown/corrupted values
      // Normalize role: defensive parse, trim whitespace, lowercase
      const inviteRole = String(data.role ?? "").trim().toLowerCase();
      let role: "guest" | "host";
      if (inviteRole === "host") {
        role = "host";
      } else if (inviteRole === "guest" || inviteRole === "participant" || inviteRole === "viewer") {
        role = "guest"; // Map participant/viewer to guest for RTC join
      } else {
        // Unknown/corrupted role - reject for security
        logPayload.reason = "invalid_role";
        logPayload.invalidRole = data.role;
        return { ok: false as const, status: 401 as const, error: "INVALID_ROLE" };
      }

      return { ok: true as const, roomId, role, maxUses, useCount: useCount + 1 };
    });

    if (!redeemResult.ok) {
      logPayload.event = "join_now_fail";
      logPayload.status = redeemResult.status;
      logPayload.latencyMs = Date.now() - startTime;
      console.log("[join-now]", logPayload);
      return res.status(redeemResult.status).json({ error: redeemResult.error });
    }

    const roomId = redeemResult.roomId;
    const inviteRole = redeemResult.role;
    logPayload.roomId = roomId;
    logPayload.role = inviteRole;
    logPayload.maxUses = redeemResult.maxUses;
    logPayload.currentUseCount = redeemResult.useCount;

    // Step 2: Get room details (validate room exists)
    const roomSnap = await firestore.collection("rooms").doc(roomId).get();
    if (!roomSnap.exists) {
      logPayload.event = "join_now_fail";
      logPayload.reason = PERMISSION_ERRORS.ROOM_NOT_FOUND;
      logPayload.latencyMs = Date.now() - startTime;
      console.log("[join-now]", logPayload);
      return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    }

    const room = (roomSnap.data() as any) || {};
    const livekitRoomName = String(room.livekitRoomName || roomId).trim();
    const roomName = String(room.roomName || room.name || livekitRoomName || roomId);
    const allowGuestsPolicy = typeof room.allowGuests === "boolean" ? !!room.allowGuests : null;

    // Optional per-room guest policy
    if (allowGuestsPolicy === false) {
      logPayload.event = "join_now_fail";
      logPayload.reason = "guests_not_allowed";
      logPayload.latencyMs = Date.now() - startTime;
      console.log("[join-now]", logPayload);
      return res.status(401).json({ error: "login_required" });
    }

    // Step 3: Mint LiveKit token
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      const missing: string[] = [];
      if (!apiKey) missing.push("LIVEKIT_API_KEY");
      if (!apiSecret) missing.push("LIVEKIT_API_SECRET");
      logPayload.event = "join_now_fail";
      logPayload.reason = "livekit_misconfigured";
      logPayload.missing = missing;
      console.log("[join-now]", logPayload);
      return res.status(500).json({ code: "misconfigured", error: "LiveKit keys missing", missing });
    }

    const displayName = sanitizeDisplayName(String(req.body?.displayName || "")).trim() || `Guest-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    
    // Use cached identity for idempotent requests, otherwise generate new
    const identity = existingSession?.identity || `invite:${inviteId}:${Math.random().toString(16).slice(2)}`;
    logPayload.identity = identity;
    logPayload.displayName = displayName;
    
    // Store in idempotency cache
    if (!existingSession) {
      setIdempotency(inviteId, deviceFingerprint, identity);
    }

    const AccessToken = await getAccessTokenCtor();
    
    // LiveKit token TTL: 30 minutes (reasonable for guest sessions)
    // Shorter TTL improves security, longer TTL reduces re-auth friction
    const livekitTtl = "30m";
    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: displayName,
      ttl: livekitTtl,
    });

    const grant = roleGrant(inviteRole);
    at.addGrant({ room: livekitRoomName, ...grant } as any);

    const livekitToken = await at.toJwt();
    logPayload.livekitTtl = livekitTtl;

    // Step 4: Create guest session JWT
    // Guest session TTL: 2 hours (longer than LiveKit token, allows token refresh)
    // CRITICAL: Guest session must expire AFTER LiveKit token so re-minting works
    const guestSessionTtl = "2h";
    // Guest sessions only support "guest" | "participant" roles
    // If invite has role="host", treat as "guest" for the unauthenticated join-now flow
    const guestSessionRole: "guest" | "participant" = inviteRole === "host" ? "guest" : inviteRole;
    const guestSessionToken = signGuestSession({ inviteId, roomId, role: guestSessionRole }, guestSessionTtl);
    logPayload.guestSessionTtl = guestSessionTtl;

    // Step 5: Create room access token
    const basePerms =
      inviteRole === "guest"
        ? {
            canStream: false,
            canRecord: false,
            canDestinations: false,
            canModerate: false,
            canLayout: false,
            canScreenShare: false,
            canInvite: false,
            canAnalytics: false,
            canMuteGuests: false,
            canRemoveGuests: false,
          }
        : {
            canStream: false,
            canRecord: false,
            canDestinations: false,
            canModerate: false,
            canLayout: false,
            canScreenShare: false,
            canInvite: false,
            canAnalytics: false,
            canMuteGuests: false,
            canRemoveGuests: false,
          };

    const roomAccessPayload = {
      roomId,
      roomName,
      livekitRoomName,
      role: inviteRole,
      permissions: basePerms,
      identity,
    } as const;

    const roomAccessToken = jwt.sign(roomAccessPayload, getRoomAccessSecret(), { expiresIn: "12h" });

    // Step 6: Set HttpOnly cookie
    const isProduction = String(process.env.NODE_ENV || "development").toLowerCase() === "production";
    const secure = isProduction;
    const sameSite: "none" | "lax" = isProduction ? "none" : "lax";

    res.cookie("sl_guest", guestSessionToken, {
      httpOnly: true,
      sameSite,
      secure,
      path: "/",
      maxAge: 2 * 60 * 60 * 1000,
    });

    // Step 7: Get LiveKit server URL
    const serverUrl = getLiveKitServerUrlForClient();
    if (!serverUrl) {
      logPayload.event = "join_now_fail";
      logPayload.reason = "livekit_url_missing";
      logPayload.latencyMs = Date.now() - startTime;
      console.log("[join-now]", logPayload);
      return res.status(500).json({
        code: "misconfigured",
        error: "LIVEKIT_URL missing",
        missing: ["LIVEKIT_URL"],
      });
    }

    // Success! Log observability metrics
    logPayload.event = "join_now_success";
    logPayload.latencyMs = Date.now() - startTime;
    delete logPayload.reason; // No failure reason
    console.log("[join-now]", logPayload);

    // Return everything the client needs to connect immediately
    // NEVER log tokens in production - treat like passwords
    return res.json({
      serverUrl,
      roomToken: livekitToken,
      roomId,
      identity,
      displayName,
      guestSessionToken,
      roomAccessToken,
      isViewer: false, // All invite-based guests are RTC participants with mic+cam (guest role)
      role: inviteRole,
      roomName,
    });
  } catch (err: any) {
    logPayload.event = "join_now_fail";
    logPayload.reason = "exception";
    logPayload.error = err?.message || String(err);
    logPayload.latencyMs = Date.now() - startTime;
    console.error("[join-now]", logPayload);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /api/rooms/:roomId/status
 * Auth: host auth OR guest session cookie required
 * Returns: { roomId, status: "idle" | "live" }
 */
router.get("/rooms/:roomId/status", async (req: any, res) => {
  try {
    const roomId = String(req.params.roomId || "").trim();
    if (!roomId) return res.status(400).json({ error: "roomId_required" });

    const snap = await firestore.collection("rooms").doc(roomId).get();
    if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

    const room = (snap.data() as any) || {};
    const status = room.status === "live" ? "live" : "idle";
    const allowGuestsPolicy = typeof room.allowGuests === "boolean" ? !!room.allowGuests : null;

    const user = tryGetAuthUser(req);
    let guest = tryGetGuestSession(req);

    // Optional per-room guest policy: only enforced when explicitly set.
    if (!user && allowGuestsPolicy === false) {
      return res.status(401).json({ error: "login_required" });
    }

    if (!user && !guest) {
      const legacyGuest = tryGetLegacyInviteGuest(req, roomId);
      if (legacyGuest) {
        guest = legacyGuest as any;
        const expiresIn = "2h";
        const sessionJwt = signGuestSession({ inviteId: legacyGuest.inviteId, roomId, role: "guest" }, expiresIn);
        const isProduction = String(process.env.NODE_ENV || "development").toLowerCase() === "production";
        const secure = isProduction;
        const sameSite: "none" | "lax" = isProduction ? "none" : "lax";
        res.cookie("sl_guest", sessionJwt, {
          httpOnly: true,
          sameSite,
          secure,
          path: "/",
          maxAge: 2 * 60 * 60 * 1000,
        });
      }
    }

    if (!user && (!guest || guest.roomId !== roomId)) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    return res.json({ roomId, status });
  } catch (err) {
    console.error("/api/rooms/:roomId/status error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /api/rooms/:roomId/token
 * Auth:
 *  - Host/cohost (authed): allowed anytime
 *  - Guest session: only when rooms/{roomId}.status === "live"; mints viewer-only token
 */
router.post("/rooms/:roomId/token", async (req: any, res) => {
  try {
    res.setHeader("x-sl-token-grants", "v4-with-sources");
    const roomId = String(req.params.roomId || "").trim();
    if (!roomId) return res.status(400).json({ error: "roomId_required" });

    const user = tryGetAuthUser(req);
    let guest = tryGetGuestSession(req);

    if (!user && !guest) {
      const legacyGuest = tryGetLegacyInviteGuest(req, roomId);
      if (legacyGuest) {
        guest = legacyGuest as any;
        const expiresIn = "2h";
        const sessionJwt = signGuestSession({ inviteId: legacyGuest.inviteId, roomId, role: legacyGuest.role }, expiresIn);
        const isProduction = String(process.env.NODE_ENV || "development").toLowerCase() === "production";
        const secure = isProduction;
        const sameSite: "none" | "lax" = isProduction ? "none" : "lax";
        res.cookie("sl_guest", sessionJwt, {
          httpOnly: true,
          sameSite,
          secure,
          path: "/",
          maxAge: 2 * 60 * 60 * 1000,
        });
      }
    }

    const allowGuestJoin = String(process.env.ALLOW_GUEST_RTC_JOIN || "").trim() === "1";

    const snap = await firestore.collection("rooms").doc(roomId).get();
    if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

    const room = (snap.data() as any) || {};
    const ownerId = typeof room.ownerId === "string" ? room.ownerId.trim() : "";
    const livekitRoomName = String(room.livekitRoomName || roomId).trim();
    const roomStatus = room.status === "live" ? "live" : "idle";

    // Room policy defaults (secure-by-default for older docs)
    const visibilityRaw = typeof room.visibility === "string" ? room.visibility.trim().toLowerCase() : "";
    const visibility: "public" | "unlisted" | "private" =
      visibilityRaw === "public" || visibilityRaw === "unlisted" || visibilityRaw === "private"
        ? (visibilityRaw as any)
        : "unlisted";
    const requiresAuth = typeof room.requiresAuth === "boolean" ? !!room.requiresAuth : true;
    const requiresPayment = typeof room.requiresPayment === "boolean" ? !!room.requiresPayment : false;
    const roomType = typeof room.roomType === "string" ? String(room.roomType).trim() : "";
    const allowGuestsPolicy = typeof room.allowGuests === "boolean" ? !!room.allowGuests : null;

    // Policy: room type must be rtc when explicitly set
    if (roomType && roomType !== "rtc") {
      return res.status(400).json({ error: "room_not_rtc" });
    }

    // Policy: auth requirement
    // Allow guests to join via a verified guest session (sl_guest cookie) or legacy invite token.
    if (requiresAuth && !user && !guest) {
      return res.status(401).json({ error: "login_required" });
    }

    // Optional per-room guest policy: only enforced when explicitly set.
    if (!user && allowGuestsPolicy === false) {
      return res.status(401).json({ error: "login_required" });
    }

    // If not authed, guest access must be explicitly enabled and backed by a verified guest session
    if (!user) {
      if (!allowGuestJoin) {
        return res.status(401).json({ error: "login_required" });
      }
      if (!guest || guest.roomId !== roomId) {
        return res.status(401).json({ error: "login_required" });
      }
    }

    // Policy: visibility
    const isOwner = !!user && !!ownerId && user.uid === ownerId;
    // Private rooms are owner-only UNLESS the caller presents a valid invite token.
    // This supports "invite someone on stage" while keeping strict access by default.
    const inviteForRoom = tryGetLegacyInviteGuest(req, roomId);
    const hasInviteAccess = !!inviteForRoom;
    if (visibility === "private" && !isOwner && !hasInviteAccess) {
      return res.status(403).json({ error: "not_allowed" });
    }

    // Policy: payment
    if (requiresPayment && !isOwner) {
      return res.status(402).json({ error: "payment_required" });
    }

    // Guests can only join once room is live.
    if (!user && roomStatus !== "live") {
      return res.status(409).json({ error: "room_not_live" });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      const missing: string[] = [];
      if (!apiKey) missing.push("LIVEKIT_API_KEY");
      if (!apiSecret) missing.push("LIVEKIT_API_SECRET");
      return res.status(500).json({ code: "misconfigured", error: "LiveKit keys missing", missing });
    }

    const displayName = sanitizeDisplayName(String(req.body?.displayName || req.body?.identity || "Guest")).trim() || "Guest";

    // Determine LiveKit role based on authentication
    // - Authenticated users: host (if owner) or participant
    // - Guest sessions: "guest" (RTC participant with mic/cam)
    const lkRole: "guest" | "participant" | "host" = user
      ? (isOwner ? "host" : "participant")
      : guest?.role === "participant"
        ? "participant"
        : "guest";
    const identity = user ? user.uid : `invite:${guest!.inviteId}:${Math.random().toString(16).slice(2)}`;
    if (!identity || !String(identity).trim()) {
      return res.status(500).json({ code: "internal_error", error: "invalid_identity" });
    }
    if (!livekitRoomName) {
      return res.status(500).json({ code: "internal_error", error: "invalid_livekit_room_name" });
    }

    // When host joins, flip room live.
    if (user && isOwner && roomStatus !== "live") {
      await firestore.collection("rooms").doc(roomId).set(
        {
          status: "live",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    const AccessToken = await getAccessTokenCtor();
    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: displayName,
    });

    const grant = roleGrant(lkRole);
    at.addGrant({ room: livekitRoomName, ...grant } as any);

    const token = await at.toJwt();

    const effectiveRoleKey: "guest" | "participant" | "host" = lkRole;
    const basePerms =
      effectiveRoleKey === "host"
        ? {
            canStream: true,
            canRecord: true,
            canDestinations: true,
            canModerate: true,
            canLayout: true,
            canScreenShare: true,
            canInvite: true,
            canAnalytics: true,
            canMuteGuests: true,
            canRemoveGuests: true,
          }
        : effectiveRoleKey === "participant"
          ? {
              canStream: false,
              canRecord: false,
              canDestinations: false,
              canModerate: false,
              canLayout: false,
              canScreenShare: false,
              canInvite: false,
              canAnalytics: false,
              canMuteGuests: false,
              canRemoveGuests: false,
            }
          : {
              canStream: false,
              canRecord: false,
              canDestinations: false,
              canModerate: false,
              canLayout: false,
              canScreenShare: false,
              canInvite: false,
              canAnalytics: false,
              canMuteGuests: false,
              canRemoveGuests: false,
            };

    const roomAccessPayload = {
      roomId,
      roomName: String(room.roomName || room.name || livekitRoomName || roomId),
      livekitRoomName,
      role: effectiveRoleKey,
      permissions: basePerms,
      identity,
    } as const;

    const roomAccessToken = jwt.sign(roomAccessPayload, getRoomAccessSecret(), { expiresIn: "12h" });

    const serverUrl = getLiveKitServerUrlForClient();
    if (!serverUrl) {
      return res.status(500).json({
        code: "misconfigured",
        error: "LIVEKIT_URL missing",
        missing: ["LIVEKIT_URL"],
      });
    }

    return res.json({
      token,
      serverUrl,
      roomId,
      roomName: roomAccessPayload.roomName,
      roomAccessToken,
      participantIdentity: identity,
      isViewer: false, // guest/participant/host all use /room route (not HLS viewer)
      role: lkRole,
      effectiveRoleKey,
    });
  } catch (err: any) {
    console.error("/api/rooms/:roomId/token error", err?.message || err);
    res.setHeader("x-sl-token-grants", "v4-with-sources");
    return res.status(500).json({
      code: "internal_error",
      error: "Failed to create room token",
      message: process.env.AUTH_DEBUG === "1" ? String(err?.message || err) : undefined,
    });
  }
});

export default router;
