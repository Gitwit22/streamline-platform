import { Router } from "express";
import admin from "firebase-admin";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { firestore } from "../firebaseAdmin";
import { tryGetAuthUserAny, verifyInviteToken } from "../middleware/requireAuth";
import {
  tryGetGuestSession,
  signGuestSession,
  setGuestSessionCookie,
  GUEST_SESSION_TTL,
  type GuestSessionClaims,
} from "../middleware/guestSession";
import { verifyRoomAccessToken } from "../middleware/roomAccessToken";
import { sanitizeDisplayName } from "../lib/sanitizeDisplayName";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import {
  getInviteAcceptance,
  recordInviteAcceptance,
  isFirestoreInviteId,
  jwtInviteAcceptanceId,
  isInviteShapedClaims,
  type InviteAcceptance,
} from "../lib/inviteAcceptance";
import { resolveCohostRoomPermissions } from "../lib/rolePermissions";
import { roleToParticipantPermission, applyPresenceModeToGrant, toLiveKitTrackSourceNumber } from "../lib/livekitPermissions";
import { isValidPresenceMode, normalizePresenceMode, buildPresenceMetadata, type PresenceMode } from "../lib/presenceMode";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import { isAdmin } from "../middleware/adminAuth";
import { resolveHostName } from "../lib/resolveHostName";
import { logDelegatedRoomAction, resolveOwnerActingContext } from "../lib/collaborators";
import { onHostGoingLive } from "../lib/viewerStats";
import { collaboratorToRoomAccessPermissions } from "../lib/roomModerationPolicy";
import {
  anonymousGuestsAllowed,
  decideDirectGuestJoin,
  decideTokenAccess,
  directJoinAllowed,
  isInviteSessionId,
  resolveRoomAccessMode,
} from "../lib/roomAccessPolicy";
import { applyOwnerPresetToControls, loadOwnerRolePreset } from "../lib/permissions/rolePresetStore";

/**
 * Invite JWT from x-invite-token, body.inviteToken or query inviteToken/t.
 * Deliberately does NOT read x-room-access-token: room access tokens are
 * per-participant credentials, not invites, and must never count as one.
 */
export function extractInviteToken(req: any): string | null {
  const hdr = (req?.headers as any) || {};
  const fromHeader = hdr["x-invite-token"] ?? hdr["X-Invite-Token"];
  if (typeof fromHeader === "string" && fromHeader.trim()) return fromHeader.trim();
  const fromBody = req?.body?.inviteToken;
  if (typeof fromBody === "string" && fromBody.trim()) return fromBody.trim();
  const fromQuery = req?.query?.inviteToken ?? req?.query?.t;
  if (typeof fromQuery === "string" && fromQuery.trim()) return fromQuery.trim();
  return null;
}

/**
 * Maps a verified invite-JWT role to the guest-session role an anonymous
 * holder may get. Elevated roles (host/cohost/moderator) and unknown values
 * return null: cohost invites go through the authenticated flow.
 * Backward compatibility: legacy "guest" behaved like an on-stage participant
 * and legacy "viewer" like a "guest".
 */
export function inviteClaimRoleToGuestRole(rawRole: unknown): "guest" | "participant" | null {
  const r = String(rawRole ?? "").trim().toLowerCase();
  if (r === "participant" || r === "guest") return "participant";
  if (r === "viewer") return "guest";
  return null;
}

/**
 * Maps a room access token role to the role a share-link holder may join
 * with. Never elevates: "viewer" stays subscribe-only, guest/participant stay
 * guest, and host/cohost tokens are not shareable at all.
 */
export function roomAccessRoleToShareRole(rawRole: unknown): "guest" | "viewer" | null {
  const r = String(rawRole ?? "").trim().toLowerCase();
  if (r === "viewer") return "viewer";
  if (r === "guest" || r === "participant") return "guest";
  return null;
}

/** Verified invite JWT claims for this room (any non-host role), else null. */
export function getInviteClaimsForRoom(req: any, roomId: string): { role: string; createdByUid: string | null; exp: number | null; raw: string } | null {
  const raw = extractInviteToken(req);
  if (!raw) return null;
  try {
    const claims = verifyInviteToken(raw) as any;
    if (!isInviteShapedClaims(claims)) return null;
    const claimRoomId = typeof claims?.roomId === "string" ? claims.roomId.trim() : "";
    const role = String(claims?.role ?? "").trim().toLowerCase();
    if (!claimRoomId || claimRoomId !== roomId || role === "host") return null;
    return {
      role,
      createdByUid: typeof claims?.createdByUid === "string" && claims.createdByUid ? claims.createdByUid : null,
      exp: typeof claims?.exp === "number" ? claims.exp : null,
      raw,
    };
  } catch {
    return null;
  }
}

export function tryGetLegacyInviteGuest(req: any, roomId: string): { inviteId: string; roomId: string; role: "guest" | "participant" } | null {
  const claims = getInviteClaimsForRoom(req, roomId);
  if (!claims) return null;
  const role = inviteClaimRoleToGuestRole(claims.role);
  if (!role) return null;
  const inviteId = `legacy:${Buffer.from(claims.raw).toString("base64url").slice(0, 24)}`;
  return { inviteId, roomId, role };
}

/**
 * Share-link fallback for anonymous callers whose `t` is a room access token
 * rather than an invite. Only used to let such a holder in at the token's own
 * (non-elevated) role; never counts as an invite for publish decisions.
 */
export function tryGetRoomAccessShareGuest(req: any, roomId: string): { role: "guest" | "viewer"; raw: string } | null {
  const hdr = (req?.headers as any) || {};
  const candidates = [
    hdr["x-room-access-token"] ?? hdr["X-Room-Access-Token"],
    extractInviteToken(req),
  ];
  for (const c of candidates) {
    if (typeof c !== "string" || !c.trim()) continue;
    try {
      const claims = verifyRoomAccessToken(c.trim()) as any;
      if (String(claims?.roomId || "").trim() !== roomId) continue;
      const role = roomAccessRoleToShareRole(claims?.role);
      if (role) return { role, raw: c.trim() };
    } catch {
      // not a room access token
    }
  }
  return null;
}

/**
 * Role of a valid roomAccessToken for this room sent via x-room-access-token,
 * or null. Read-only membership proof (used by GET /rooms/:roomId/status).
 */
export function roomAccessRoleForRoom(req: any, roomId: string): string | null {
  const hdr = (req?.headers as any) || {};
  const raw = hdr["x-room-access-token"] ?? hdr["X-Room-Access-Token"];
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const claims = verifyRoomAccessToken(raw.trim()) as any;
    if (String(claims?.roomId || "").trim() !== roomId) return null;
    const role = String(claims?.role || "").trim().toLowerCase();
    return role || null;
  } catch {
    return null;
  }
}

/** Random LiveKit identity for an invite-based guest. */
function newInviteIdentity(inviteId: string): string {
  return `invite:${inviteId}:${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Validates a client-generated join nonce (InviteRedeem keeps one per tab in
 * sessionStorage). Returns null when absent or malformed.
 */
export function normalizeJoinNonce(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(v)) return null;
  return v;
}

/**
 * Stable identity for a join-now redeem: the same (invite, nonce) pair always
 * maps to the same identity (double-click / retry from the same tab), while
 * different tabs/people (different nonces) never collide.
 */
export function joinNowIdentity(inviteId: string, nonce: string | null): string {
  if (!nonce) return newInviteIdentity(inviteId);
  const h = crypto.createHash("sha256").update(`${inviteId}:${nonce}`).digest("hex").slice(0, 16);
  return `invite:${inviteId}:${h}`;
}

async function getAccessTokenCtor() {
  const mod = await import("livekit-server-sdk");
  return mod.AccessToken;
}

async function getRoomServiceClient() {
  const mod = await import("livekit-server-sdk");
  return mod.RoomServiceClient;
}

function deriveServiceUrl(): string | null {
  const raw = process.env.LIVEKIT_URL || "";
  if (!raw) return null;
  // Convert wss://host to https://host for RoomServiceClient
  return raw.replace(/^wss?:\/\//i, (m) => (m.toLowerCase() === "ws://" ? "http://" : "https://"));
}

async function getParticipantCount(livekitRoomName: string): Promise<number | null> {
  const serviceUrl = deriveServiceUrl();
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!serviceUrl || !apiKey || !apiSecret) return null;
  try {
    const RoomServiceClient = await getRoomServiceClient();
    const client = new RoomServiceClient(serviceUrl, apiKey, apiSecret);
    const participants = await client.listParticipants(livekitRoomName);
    return participants?.length ?? 0;
  } catch (err) {
    console.warn("[roomGuestAccess] participant count failed", (err as any)?.message || err);
    return null;
  }
}

async function getPlanLimit(uid: string, field: string): Promise<number | undefined> {
  const userSnap = await firestore.collection("users").doc(uid).get();
  const planId = String((userSnap.data() || {}).planId || "free");
  const planSnap = await firestore.collection("plans").doc(planId).get();
  if (!planSnap.exists) return undefined;
  const limits = (planSnap.data() || {}).limits || {};
  const raw = (limits as any)[field];
  if (raw === undefined || raw === null) return undefined;
  const num = Number(raw);
  return Number.isFinite(num) ? num : undefined;
}

function normalizePositiveCap(raw: number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

async function resolveMaxGuestsCap(ownerId: string | null): Promise<number | undefined> {
  const planCapRaw = ownerId ? await getPlanLimit(ownerId, "maxGuests") : undefined;
  const planCap = normalizePositiveCap(planCapRaw);

  const envRaw = Number(process.env.MAX_GUESTS_PER_ROOM || "0");
  const envCap = Number.isFinite(envRaw) && envRaw > 0 ? Math.floor(envRaw) : undefined;

  return planCap !== undefined ? planCap : envCap;
}

const CAPACITY_LOCK_TTL_MS = 10_000;

async function acquireCapacityLock(roomId: string): Promise<string | null> {
  const owner = crypto.randomUUID();
  const ref = firestore.collection("roomCapacityLocks").doc(roomId);
  const now = Date.now();
  try {
    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? ((snap.data() as any) || {}) : {};
      const existingOwner = typeof data.owner === "string" ? data.owner : "";
      const expiresAtMs = typeof data.expiresAtMs === "number" ? data.expiresAtMs : 0;
      if (expiresAtMs > now && existingOwner && existingOwner !== owner) {
        throw new Error("capacity_lock_busy");
      }
      tx.set(
        ref,
        {
          owner,
          expiresAtMs: now + CAPACITY_LOCK_TTL_MS,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
    return owner;
  } catch {
    return null;
  }
}

async function releaseCapacityLock(roomId: string, owner: string): Promise<void> {
  const ref = firestore.collection("roomCapacityLocks").doc(roomId);
  try {
    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? ((snap.data() as any) || {}) : {};
      const existingOwner = typeof data.owner === "string" ? data.owner : "";
      if (existingOwner && existingOwner === owner) {
        tx.set(
          ref,
          {
            expiresAtMs: 0,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    });
  } catch {
    // best-effort
  }
}

async function enforceCapacityOrRespond(params: {
  roomId: string;
  livekitRoomName: string;
  ownerId: string | null;
  bypass: boolean;
  res: any;
}): Promise<{ ok: true; lockOwner: string | null } | { ok: false }> {
  const { roomId, livekitRoomName, ownerId, bypass, res } = params;
  if (bypass) return { ok: true, lockOwner: null };

  const cap = await resolveMaxGuestsCap(ownerId);
  if (cap === undefined) return { ok: true, lockOwner: null };

  const lockOwner = await acquireCapacityLock(roomId);
  if (!lockOwner) {
    res.status(503).json({ error: "capacity_check_busy" });
    return { ok: false };
  }

  const participantCount = await getParticipantCount(livekitRoomName);
  // If LiveKit returns null (room not created yet / idle), treat as 0 participants.
  // An idle room that hasn't been started in LiveKit has no participants.
  const effectiveCount = participantCount ?? 0;
  if (effectiveCount >= cap) {
    await releaseCapacityLock(roomId, lockOwner);
    res.status(429).json({ error: "room_full" });
    return { ok: false };
  }

  return { ok: true, lockOwner };
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

type MintRole = "viewer" | "guest" | "participant" | "cohost" | "host";

const NO_ROOM_PERMISSIONS: Record<string, boolean> = {
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

const FULL_ROOM_PERMISSIONS: Record<string, boolean> = {
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
};

/** Controls-doc role -> "viewer" | "participant" | "cohost" | "" (legacy moderator = cohost). */
export function normalizeControlsRole(raw: unknown): "viewer" | "participant" | "cohost" | "" {
  const r = String(raw ?? "").trim().toLowerCase();
  if (r === "viewer") return "viewer";
  if (r === "participant" || r === "speaker") return "participant";
  if (r === "cohost" || r === "moderator" || r === "co-host" || r === "co_host") return "cohost";
  return "";
}

// Cohosts get host-level publish sources but never roomAdmin: LiveKit admin
// stays with the owner (and delegated producers).
function roleGrant(role: MintRole, presenceMode?: PresenceMode, opts?: { screenShare?: boolean }) {
  // Use canonical roleToParticipantPermission() for consistency
  const participantPerm = roleToParticipantPermission(role, { screenShare: opts?.screenShare });
  const isHost = role === "host";

  // Apply presence-mode restrictions when joining as invisible.
  const effectivePerm = presenceMode
    ? applyPresenceModeToGrant(participantPerm, presenceMode)
    : participantPerm;

  // Enforce allowed sources at the LiveKit level, not just in our app layer,
  // so a modified client can't e.g. screen-share as a guest. The SDK expects
  // protobuf TrackSource enum values (it converts them to strings in toJwt).
  const canPublishSources = effectivePerm.canPublish
    ? effectivePerm.canPublishSources
        .map((src) => toLiveKitTrackSourceNumber(src))
        // 0 (UNKNOWN) can't be serialized into the JWT grant.
        .filter((n): n is number => typeof n === "number" && n > 0)
    : [];

  return {
    roomJoin: true,
    canSubscribe: effectivePerm.canSubscribe,
    canPublish: effectivePerm.canPublish,
    canPublishData: effectivePerm.canPublishData,
    ...(canPublishSources.length ? { canPublishSources } : {}),
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

// Join-now idempotency: identities are derived from a client nonce (see
// joinNowIdentity) instead of an IP+User-Agent fingerprint, which gave two
// people behind the same NAT/browser the same LiveKit identity.

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

    const sessionJwt = signGuestSession(
      { inviteId, roomId: result.roomId, role: "guest", identity: newInviteIdentity(inviteId) },
      GUEST_SESSION_TTL,
    );
    setGuestSessionCookie(res, sessionJwt);

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
    
    // Idempotency: a retry/double-click from the same tab sends the same
    // client nonce and gets the same identity; different nonces never share one.
    const joinNonce = normalizeJoinNonce(req.body?.clientNonce ?? req.body?.nonce);
    // Logged-in callers redeem as themselves (account identity) and get an
    // acceptance record so later /token calls keep their invited role.
    const authedUser = await tryGetAuthUserAny(req).catch(() => null);

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

      // Security: Explicitly validate known roles, reject unknown/corrupted values.
      // Active product flows (roomInvites.ts, invites.ts) never mint host invites.
      // A host role in an invite doc is treated as invalid state (likely DB tampering),
      // not a recoverable case — reject explicitly rather than silently downgrading.
      const inviteRole = String(data.role ?? "").trim().toLowerCase();
      let role: "guest";
      if (inviteRole === "host") {
        // Host invites are impossible through active flows; treat as invalid/suspicious.
        logPayload.reason = "host_role_in_invite";
        logPayload.invalidRole = data.role;
        console.error("[join-now] SECURITY: invite doc has role=host — rejecting as invalid state", {
          inviteId,
          roomId,
          rawRole: data.role,
        });
        return { ok: false as const, status: 403 as const, error: "INVALID_INVITE_ROLE" };
      } else if (inviteRole === "guest" || inviteRole === "participant" || inviteRole === "viewer") {
        role = "guest"; // Map participant/viewer to guest for RTC join
      } else {
        // Unknown/corrupted role - reject for security
        logPayload.reason = "invalid_role";
        logPayload.invalidRole = data.role;
        return { ok: false as const, status: 403 as const, error: "INVALID_ROLE" };
      }

      const expiresAtMsOut = typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs) ? expiresAtMs : null;
      const createdByUid = typeof data.createdByUid === "string" && data.createdByUid ? data.createdByUid : null;
      return { ok: true as const, roomId, role, maxUses, useCount: useCount + 1, expiresAtMs: expiresAtMsOut, createdByUid };
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
    const ownerId = typeof room.ownerId === "string" && room.ownerId.trim() ? room.ownerId.trim() : null;

    // Optional per-room guest policy. Applies to anonymous guests only:
    // logged-in invitees join with their account.
    if (allowGuestsPolicy === false && !authedUser) {
      logPayload.event = "join_now_fail";
      logPayload.reason = "guests_not_allowed";
      logPayload.latencyMs = Date.now() - startTime;
      console.log("[join-now]", logPayload);
      return res.status(401).json({ error: "login_required" });
    }

    // Enforce room capacity (plan maxGuests) for unauthenticated guest join.
    // Fail-closed if we cannot determine occupancy.
    const capDecision = await enforceCapacityOrRespond({
      roomId,
      livekitRoomName,
      ownerId,
      bypass: false,
      res,
    });
    if (!capDecision.ok) {
      logPayload.event = "join_now_fail";
      logPayload.reason = "room_full_or_capacity_unavailable";
      logPayload.latencyMs = Date.now() - startTime;
      console.log("[join-now]", logPayload);
      return;
    }

    const capLockOwner = capDecision.lockOwner;
    try {

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
    
    // Logged-in callers keep their account identity; anonymous guests get a
    // nonce-derived identity that is also stored in the guest session so
    // /token refreshes reconnect as the same participant.
    const identity = authedUser ? authedUser.uid : joinNowIdentity(inviteId, joinNonce);
    logPayload.identity = identity;
    logPayload.displayName = displayName;
    logPayload.authed = !!authedUser;

    if (authedUser) {
      try {
        await recordInviteAcceptance({
          roomId,
          uid: authedUser.uid,
          inviteId,
          role: "participant",
          createdByUid: redeemResult.createdByUid,
          expiresAtMs: redeemResult.expiresAtMs,
        });
      } catch (err: any) {
        // Non-fatal: the guest session below still carries the invite.
        console.warn("[join-now] failed to record acceptance", err?.message || err);
      }
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

    // SECURITY: inviteRole is always "guest" (host role is rejected in the
    // redeem step above). Logged-in invitees are reported as "participant",
    // which carries the same publish grant.
    const mintedRole: "guest" | "participant" = authedUser ? "participant" : "guest";
    // Participant "Share Screen" comes from the room owner's participant preset.
    const participantScreenShare = (await loadOwnerRolePreset(ownerId, "participant")).canScreenShare;
    const grant = roleGrant(mintedRole, undefined, { screenShare: participantScreenShare });
    at.addGrant({ room: livekitRoomName, ...grant } as any);

    const livekitToken = await at.toJwt();
    logPayload.livekitTtl = livekitTtl;

    // Step 4: Create guest session JWT
    // Guest session TTL: 2 hours (longer than LiveKit token, allows token refresh)
    // CRITICAL: Guest session must expire AFTER LiveKit token so re-minting works
    const guestSessionToken = signGuestSession(
      { inviteId, roomId, role: "guest", displayName, identity: authedUser ? undefined : identity },
      GUEST_SESSION_TTL,
    );
    logPayload.guestSessionTtl = GUEST_SESSION_TTL;

    // Step 5: Create room access token
    const basePerms = { ...NO_ROOM_PERMISSIONS, canScreenShare: participantScreenShare };

    const roomAccessPayload = {
      roomId,
      roomName,
      livekitRoomName,
      role: mintedRole,
      permissions: basePerms,
      identity,
    } as const;

    const roomAccessToken = jwt.sign(roomAccessPayload, getRoomAccessSecret(), { expiresIn: "12h" });

    // Step 6: Set HttpOnly cookie
    setGuestSessionCookie(res, guestSessionToken);

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
      role: mintedRole,
      roomName,
      permissions: basePerms,
      adminOverride: false,
      presenceMode: "normal",
    });
    } finally {
      if (capLockOwner) {
        await releaseCapacityLock(roomId, capLockOwner);
      }
    }
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

    const user = await tryGetAuthUserAny(req);
    let guest: { roomId: string } | null = tryGetGuestSession(req, roomId);

    // Any valid roomAccessToken for this room (x-room-access-token) proves
    // membership. Host/cohost tokens are allowed even when guests are not.
    const memberRole = roomAccessRoleForRoom(req, roomId);
    if (!user && (memberRole === "host" || memberRole === "cohost")) {
      return res.json({ roomId, status });
    }

    // Optional per-room guest policy: only enforced when explicitly set.
    if (!user && allowGuestsPolicy === false) {
      return res.status(401).json({ error: "login_required" });
    }

    if (!user && memberRole) {
      return res.json({ roomId, status });
    }

    // Any verified invite JWT for this room (x-invite-token), including
    // cohost invites, may read the coarse status.
    if (!user && (!guest || guest.roomId !== roomId) && !tryGetLegacyInviteGuest(req, roomId) && getInviteClaimsForRoom(req, roomId)) {
      return res.json({ roomId, status });
    }

    if (!user && (!guest || guest.roomId !== roomId)) {
      const legacyGuest = tryGetLegacyInviteGuest(req, roomId);
      if (legacyGuest) {
        guest = legacyGuest;
        const sessionJwt = signGuestSession(
          { inviteId: legacyGuest.inviteId, roomId, role: legacyGuest.role, identity: newInviteIdentity(legacyGuest.inviteId) },
          GUEST_SESSION_TTL,
        );
        setGuestSessionCookie(res, sessionJwt);
      } else if (resolveRoomAccessMode(room) !== "invite_only" && tryGetRoomAccessShareGuest(req, roomId)) {
        // Read-only status for share-link holders in link/public rooms; no
        // session is minted.
        guest = { roomId };
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

    const user = await tryGetAuthUserAny(req);
    // Only a session scoped to this room counts; with both a cookie and a
    // header present, the one for this room wins (see selectGuestSession).
    const presentedSession = tryGetGuestSession(req, roomId);
    let guest: GuestSessionClaims | null =
      presentedSession && presentedSession.roomId === roomId ? presentedSession : null;
    // Track whether the guest had a pre-existing session (e.g. from a prior
    // join-now call) vs being newly promoted from a legacy invite token below.
    // Pre-existing sessions prove prior authorization and allow the guest to
    // refresh tokens without the ALLOW_GUEST_RTC_JOIN env-var gate and
    // without requiring the room to be "live".
    const hadPreExistingSession = !!guest;

    // A session minted from a Firestore invite dies with that invite.
    if (guest && isFirestoreInviteId(guest.inviteId)) {
      try {
        const inviteSnap = await firestore.collection("roomInvites").doc(guest.inviteId).get();
        if (inviteSnap.exists && (inviteSnap.data() as any)?.revokedAt) {
          if (!user) return res.status(403).json({ error: "invite_revoked" });
          guest = null;
        }
      } catch {
        // fail open on transient read errors; the session itself is signed
      }
    }

    // Anonymous share-link holder whose token is a room access token: may
    // join at that token's own role, viewer stays subscribe-only.
    let shareViewerOnly = false;
    // True when the guest identity came from a room access token share link
    // (not an invite). Share links count as "anyone with the link".
    let viaShareLink = false;

    if (!user && !guest) {
      const legacyGuest = tryGetLegacyInviteGuest(req, roomId);
      if (legacyGuest) {
        guest = { ...legacyGuest, identity: newInviteIdentity(legacyGuest.inviteId) };
      } else {
        const share = tryGetRoomAccessShareGuest(req, roomId);
        if (share) {
          const shareId = `share:${crypto.createHash("sha256").update(share.raw).digest("base64url").slice(0, 24)}`;
          guest = { inviteId: shareId, roomId, role: "guest", identity: newInviteIdentity(shareId) };
          shareViewerOnly = share.role === "viewer";
          viaShareLink = true;
        }
      }
    }

    const allowGuestJoin = String(process.env.ALLOW_GUEST_RTC_JOIN || "").trim() === "1";

    const snap = await firestore.collection("rooms").doc(roomId).get();
    if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

    const room = (snap.data() as any) || {};
    const ownerId = typeof room.ownerId === "string" ? room.ownerId.trim() : "";
    const livekitRoomName = String(room.livekitRoomName || roomId).trim();
    const roomStatus = room.status === "live" ? "live" : "idle";
    const actingContext = user ? await resolveOwnerActingContext(req) : null;
    const isOwner = !!user && !!ownerId && user.uid === ownerId;
    const isDelegatedProducer = !!(
      user &&
      actingContext?.isDelegated &&
      actingContext.ownerUid === ownerId
    );
    const isPrivilegedProducer = isOwner || isDelegatedProducer;

    // Room access mode (invite_only default; see lib/roomAccessPolicy.ts).
    const roomAccessMode = resolveRoomAccessMode(room);
    const requiresPayment = typeof room.requiresPayment === "boolean" ? !!room.requiresPayment : false;
    const roomType = typeof room.roomType === "string" ? String(room.roomType).trim() : "";

    // Policy: room type must be rtc when explicitly set
    if (roomType && roomType !== "rtc") {
      return res.status(400).json({ error: "room_not_rtc" });
    }

    // Explicit host override: no anonymous guests at all (even invited ones).
    if (!user && !anonymousGuestsAllowed(room)) {
      return res.status(401).json({ error: "login_required" });
    }

    // If not authed, must have a verified guest session scoped to this room.
    // Guests with a pre-existing session (issued by join-now after invite
    // validation, or by join-guest) can refresh tokens without the
    // ALLOW_GUEST_RTC_JOIN env-var gate — the session IS the proof of prior
    // authorization. Only newly-promoted legacy-invite guests are gated by the
    // env var.
    if (!user) {
      if (!guest || guest.roomId !== roomId) {
        return res.status(401).json({ error: "login_required" });
      }
      if (!hadPreExistingSession && !allowGuestJoin) {
        return res.status(401).json({ error: "login_required" });
      }
    }

    // Invite evidence. Only real invites count: a verified invite JWT for this
    // room, an invite guest session for this room, or (logged in) an
    // acceptance doc. Room access tokens, share links and direct (link)
    // guest sessions are never invites.
    const inviteClaims = getInviteClaimsForRoom(req, roomId);
    const acceptance: InviteAcceptance | null =
      user && !isPrivilegedProducer ? await getInviteAcceptance(roomId, user.uid) : null;
    const hasGuestSessionForRoom = !!guest && guest.roomId === roomId;
    // Sessions minted for direct link joins ("direct:") or renewed for a
    // share-link holder ("share:") are not invites.
    const isDirectSession = hasGuestSessionForRoom && !isInviteSessionId(guest!.inviteId);
    const hasInviteSessionForRoom = hasGuestSessionForRoom && !isDirectSession && !viaShareLink;
    const hasInviteAccess = !!inviteClaims || !!acceptance || hasInviteSessionForRoom;

    // Platform admin acting as host in a room they don't own: asked for the
    // host role (or no role, with no invite/session evidence). Gets host
    // grants and full room permissions; adminOverride is reported so the
    // client doesn't end the room when the admin leaves.
    const requestedRole = String(req.body?.role || "").trim().toLowerCase();
    const isAdminHost =
      !!user &&
      !isPrivilegedProducer &&
      (requestedRole === "host" || (!requestedRole && !hasInviteAccess && !hasGuestSessionForRoom)) &&
      (await isAdmin(user.uid));
    const isHostLike = isPrivilegedProducer || isAdminHost;
    const adminOverride = isAdminHost;

    const identity = user
      ? isDelegatedProducer
        ? `producer:${user.uid}:${ownerId}`
        : user.uid
      : guest!.identity || newInviteIdentity(guest!.inviteId);
    if (!identity || !String(identity).trim()) {
      return res.status(500).json({ code: "internal_error", error: "invalid_identity" });
    }

    // Host stage decisions (Bring on stage / Move to audience / role preset)
    // live in rooms/{roomId}/controls/{identity}. Honor them so a token
    // re-mint after a role change doesn't undo it, and treat a host stage
    // grant (participant/cohost) as invite evidence. Owners/delegates are
    // never affected.
    let identityControls: Record<string, unknown> | null = null;
    let controlsRole = "";
    if (!isHostLike) {
      try {
        const docId = String(identity).includes("/") ? "" : String(identity).slice(0, 128);
        if (docId) {
          const ctlSnap = await firestore.collection("rooms").doc(roomId).collection("controls").doc(docId).get();
          identityControls = ((ctlSnap.data() as any) || null) as Record<string, unknown> | null;
          controlsRole = normalizeControlsRole(identityControls?.role);
        }
      } catch (err: any) {
        console.warn("[roomGuestAccess] controls role lookup failed", err?.message || err);
      }
    }
    const hasStageGrant = controlsRole === "participant" || controlsRole === "cohost";

    // Cohost: logged-in, not the owner, holding a cohost acceptance, a cohost
    // invite JWT (legacy "moderator" included) or a host-applied cohost role.
    const inviteClaimIsCohost =
      !!inviteClaims && (inviteClaims.role === "cohost" || inviteClaims.role === "moderator");
    const isCohost =
      !!user && !isHostLike && (acceptance?.role === "cohost" || inviteClaimIsCohost || controlsRole === "cohost");

    // Policy: room access. invite_only refuses everyone without an invite,
    // cohost role or stage grant (403 not_allowed, no audience either);
    // link/public let them watch subscribe-only.
    const accessDecision = decideTokenAccess(roomAccessMode, {
      isHostLike,
      isCohost,
      hasInvite: hasInviteAccess || hasStageGrant,
    });
    if (!accessDecision.allow) {
      return res.status(accessDecision.status).json({ error: accessDecision.error, access: roomAccessMode });
    }
    const viewerOnly = accessDecision.maxRole === "viewer";

    if (isCohost && inviteClaimIsCohost && acceptance?.role !== "cohost") {
      // Persist so the cohost keeps the role after the invite link is gone
      // (also applies the owner's cohost preset to their controls doc).
      await recordInviteAcceptance({
        roomId,
        uid: user!.uid,
        inviteId: jwtInviteAcceptanceId(inviteClaims!.raw),
        role: "cohost",
        createdByUid: inviteClaims!.createdByUid,
        expiresAtMs: inviteClaims!.exp ? inviteClaims!.exp * 1000 : null,
      }).catch((err: any) => console.warn("[token] failed to record cohost acceptance", err?.message || err));
    } else if (isCohost && !identityControls) {
      // Cohost from before presets were applied on acceptance: give them the
      // owner's cohost preset now (only when the host hasn't set a role).
      await applyOwnerPresetToControls({ roomId, identity: user!.uid, presetId: "cohost", ownerUid: ownerId || null, onlyIfUnset: true });
    }

    // Policy: payment
    if (requiresPayment && !isHostLike) {
      return res.status(402).json({ error: "payment_required" });
    }

    // First-time guests (no pre-existing session) can only join once room is live.
    // Guests with pre-existing sessions (already in the room via join-now) can
    // refresh tokens during brief room status changes to avoid disconnections.
    if (!user && roomStatus !== "live" && !hadPreExistingSession) {
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

    // Display name resolution priority:
    // 1. Explicit request body displayName (client re-sends on refresh)
    // 2. Guest session JWT displayName (survives localStorage loss)
    // 3. Request body identity (legacy fallback)
    // 4. Auto-generated Guest-XXXXXX as last resort
    const rawDisplayName = String(req.body?.displayName || "").trim();
    const sessionDisplayName = guest?.displayName || "";
    const identityFallback = String(req.body?.identity || "").trim();
    const resolvedName = rawDisplayName
      || sessionDisplayName
      || identityFallback
      || `Guest-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const displayName = sanitizeDisplayName(resolvedName).trim() || `Guest-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    // Validate and normalize presence mode (default to "normal", "silent" → "invisible")
    // Authenticated room owners (and future moderator/cohost roles) may use
    // non-normal presence modes.  Guests cannot.
    const rawPresenceMode = req.body?.presenceMode;
    let presenceMode: PresenceMode =
      user && isHostLike && isValidPresenceMode(rawPresenceMode)
        ? normalizePresenceMode(rawPresenceMode)
        : "normal";

    if (presenceMode === "invisible" && isDelegatedProducer && !actingContext?.permissions?.joinInvisibleProducer) {
      presenceMode = "normal";
    }

    // Server-side gate: invisible host requires the plan entitlement.
    // If the plan doesn't include it, silently downgrade to "normal".
    if (presenceMode === "invisible" && user && !isAdminHost) {
      try {
        const ent = await getEffectiveEntitlements(ownerId || user.uid);
        if (!ent.features.invisibleHost) {
          presenceMode = "normal";
        }
      } catch {
        presenceMode = "normal";
      }
    }

    // Determine LiveKit role based on authentication
    // - Authenticated users: host (if owner) or participant
    // - Guest sessions: "guest" (RTC participant with mic/cam)
    // Uninvited link/public visitors (and share-link holders) are audience
    // viewers until the host brings them on stage.
    let lkRole: MintRole = user
      ? (isHostLike ? "host" : isCohost ? "cohost" : viewerOnly ? "viewer" : "participant")
      : shareViewerOnly || viewerOnly
        ? "viewer"
        : guest?.role === "participant"
          ? "participant"
          : "guest";
    // Host stage decisions override the default role (see identityControls).
    if (lkRole !== "host") {
      if (controlsRole === "viewer") lkRole = "viewer";
      else if (controlsRole === "participant") lkRole = "participant";
      else if (controlsRole === "cohost") lkRole = user ? "cohost" : "participant";
    }

    // Enforce room capacity (plan maxGuests) for non-owner joins.
    // Fail-closed if we cannot determine occupancy.
    const capacity = await enforceCapacityOrRespond({
      roomId,
      livekitRoomName,
      ownerId: ownerId || null,
      bypass: !!(user && isHostLike),
      res,
    });
    if (!capacity.ok) return;

    const capLockOwner = capacity.lockOwner;
    try {
    if (!livekitRoomName) {
      return res.status(500).json({ code: "internal_error", error: "invalid_livekit_room_name" });
    }

    // When host joins, flip room live.
    if (user && isPrivilegedProducer && roomStatus !== "live") {
      if (isDelegatedProducer && !actingContext?.permissions?.startRooms) {
        return res.status(403).json({ error: "delegation_start_rooms_denied" });
      }
      await firestore.collection("rooms").doc(roomId).set(
        {
          status: "live",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    // Viewer counting: the host/producer going live starts (or continues) the
    // room's live viewer session. Fire-and-forget; never delays the token.
    if (user && isPrivilegedProducer) {
      void onHostGoingLive(roomId, room);
    }

    const AccessToken = await getAccessTokenCtor();
    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: displayName,
    });

    // Participant "Share Screen" (Settings > Role Defaults): the identity's
    // applied preset wins, else the room owner's participant preset.
    const isStageParticipant = lkRole === "participant" || lkRole === "guest";
    const participantScreenShare = isStageParticipant
      ? typeof identityControls?.canScreenShare === "boolean"
        ? (identityControls.canScreenShare as boolean)
        : (await loadOwnerRolePreset(ownerId || null, "participant")).canScreenShare
      : false;

    const grant = roleGrant(lkRole, presenceMode, { screenShare: participantScreenShare });
    at.addGrant({ room: livekitRoomName, ...grant } as any);

    // Attach presence metadata so the frontend can filter the roster
    if (presenceMode !== "normal") {
      at.metadata = JSON.stringify(
        buildPresenceMetadata({
          role: lkRole,
          presenceMode,
        }),
      );
    }

    const token = await at.toJwt();

    const effectiveRoleKey: MintRole = lkRole;
    // Cohost room permissions: the room owner's cohost preset (with any
    // scopes the host set on this cohost's controls doc), limited to what the
    // owner's plan allows (recording, destinations, streaming).
    const basePerms: Record<string, boolean> =
      effectiveRoleKey === "cohost"
        ? await resolveCohostRoomPermissions({
            roomId,
            identity: String(identity),
            ownerUid: ownerId || null,
            identityControls,
          })
        : effectiveRoleKey === "host"
          ? isDelegatedProducer
            ? collaboratorToRoomAccessPermissions(actingContext?.permissions)
            : { ...FULL_ROOM_PERMISSIONS }
          : effectiveRoleKey === "participant" || effectiveRoleKey === "guest"
            ? { ...NO_ROOM_PERMISSIONS, canScreenShare: participantScreenShare }
            : { ...NO_ROOM_PERMISSIONS };

    const roomAccessPayload = {
      roomId,
      roomName: String(room.roomName || room.name || livekitRoomName || roomId),
      livekitRoomName,
      role: effectiveRoleKey,
      permissions: basePerms,
      identity,
      presenceMode,
      actingOwnerUid: isDelegatedProducer ? ownerId : undefined,
      adminOverride: adminOverride || undefined,
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

    const ownerEntitlements = user ? await getEffectiveEntitlements(ownerId || user.uid) : null;
    if (isDelegatedProducer && user) {
      await logDelegatedRoomAction({
        actedByUid: user.uid,
        ownerUid: ownerId,
        roomId,
        action: "room_token_mint",
        metadata: {
          presenceMode,
          identity,
        },
      }).catch(() => {});
    }

    // Guest session renewal: whenever this request carried a valid session
    // for the room (or was just promoted from an invite), hand back a fresh
    // one with the same claims and a new expiry, pinned to the identity we
    // minted, so long sessions don't lapse mid-room.
    let renewedGuestSessionToken: string | undefined;
    if (guest && guest.roomId === roomId && !shareViewerOnly) {
      renewedGuestSessionToken = signGuestSession(
        {
          inviteId: guest.inviteId,
          roomId,
          role: guest.role,
          displayName: user ? guest.displayName : displayName,
          identity: user ? guest.identity : identity,
        },
        GUEST_SESSION_TTL,
      );
      setGuestSessionCookie(res, renewedGuestSessionToken);
    }

    return res.json({
      token,
      serverUrl,
      roomId,
      roomName: roomAccessPayload.roomName,
      roomAccessToken,
      participantIdentity: identity,
      // Subscribe-only tokens (strict publish policy, share-link viewers) are
      // reported as viewers so the client hides publish controls.
      isViewer: lkRole === "viewer",
      ...(renewedGuestSessionToken ? { guestSessionToken: renewedGuestSessionToken } : {}),
      role: lkRole,
      effectiveRoleKey,
      // Same permissions as in roomAccessToken (what the server enforces).
      permissions: basePerms,
      // True when a platform admin was elevated to host in a room they don't own.
      adminOverride,
      // Effective presence mode after any server-side downgrade.
      presenceMode,
      // Production-room access mode (invite_only | link | public).
      access: roomAccessMode,
      effectiveEntitlements: ownerEntitlements,
      actingContext: user
        ? {
            ownerUid: ownerId || user.uid,
            actedByUid: user.uid,
            isDelegated: isDelegatedProducer,
            ownerDisplayName: actingContext?.ownerDisplayName || null,
            ownerEmail: actingContext?.ownerEmail || null,
          }
        : null,
    });
    } finally {
      if (capLockOwner) {
        await releaseCapacityLock(roomId, capLockOwner);
      }
    }
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

/**
 * Derive a normalized room lifecycle status from the raw Firestore room document.
 *   - "live"  → room.status === "live"
 *   - "ended" → room.status === "ended" (host explicitly ended the session)
 *   - "idle"  → everything else (created but not yet started, or paused)
 *
 * When the room document is missing entirely, callers should use "not_found".
 */
function deriveRoomStatus(room: Record<string, any> | null): "idle" | "live" | "ended" | "not_found" {
  if (!room) return "not_found";
  const raw = typeof room.status === "string" ? room.status.trim().toLowerCase() : "";
  if (raw === "live") return "live";
  if (raw === "ended" || raw === "closed" || raw === "archived") return "ended";
  return "idle";
}

function deriveDebugReason(roomStatus: string, room: Record<string, any> | null, extra?: string): string | undefined {
  if (roomStatus === "not_found") return "room_not_found";
  if (roomStatus === "ended") return `room_marked_${room?.status ?? "ended"}`;
  if (roomStatus === "idle") return "room_idle_not_started";
  return extra || undefined;
}

/**
 * GET /api/rooms/:roomId/info
 * Auth: NONE — fully public
 * Returns basic room metadata so the join page can render room name,
 * host info, and guest-allowed status before any authentication.
 */
router.get("/rooms/:roomId/info", async (req: any, res) => {
  try {
    const roomId = String(req.params.roomId || "").trim();
    if (!roomId) return res.status(400).json({ error: "roomId_required" });

    const snap = await firestore.collection("rooms").doc(roomId).get();
    if (!snap.exists) {
      return res.status(404).json({
        error: PERMISSION_ERRORS.ROOM_NOT_FOUND,
        roomStatus: "not_found" as const,
        guestJoinAllowed: false,
        debugReason: "room_not_found",
      });
    }

    const room = (snap.data() as any) || {};
    const roomStatus = deriveRoomStatus(room);
    const roomAccessMode = resolveRoomAccessMode(room);
    // allowGuests / guestJoinAllowed describe joining WITHOUT an invite from
    // the room link: never in invite_only rooms. Invite holders use
    // /invites/:inviteId/info.
    const allowGuests = anonymousGuestsAllowed(room) && roomAccessMode !== "invite_only";
    const guestJoinAllowed = directJoinAllowed(roomAccessMode, room, roomStatus === "live");
    const roomName = String(room.roomName || room.name || roomId);
    const hostName = await resolveHostName(room.ownerId);
    const roomType = room.roomType === "hls" || room.hlsConfig?.enabled === true ? "hls" : "rtc";
    const debugReason = deriveDebugReason(roomStatus, room);

    // Only return safe, public info — never expose owner IDs, secrets, or internal fields
    return res.json({
      roomId,
      roomName,
      status: roomStatus === "live" ? "live" : "idle", // backward compat
      roomStatus,
      allowGuests,
      guestJoinAllowed,
      access: roomAccessMode,
      hostName,
      roomType,
      debugReason,
    });
  } catch (err) {
    console.error("/api/rooms/:roomId/info error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /api/invites/:inviteId/info
 * Auth: NONE — fully public, read-only
 * Returns invite + room metadata so the landing page can render context
 * before the user clicks "Join". Does NOT increment useCount.
 */
router.get("/invites/:inviteId/info", async (req: any, res) => {
  try {
    const inviteId = String(req.params.inviteId || "").trim();
    if (!inviteId) return res.status(400).json({ error: "inviteId_required" });

    const inviteSnap = await firestore.collection("roomInvites").doc(inviteId).get();
    if (!inviteSnap.exists) return res.status(404).json({ error: "invite_not_found" });

    const invite = (inviteSnap.data() as any) || {};

    // Check validity: not revoked and not expired
    const now = Date.now();
    const revoked = !!invite.revokedAt;
    const expiresAtRaw = invite.expiresAt;
    const expiresAtMillis = expiresAtRaw?.toMillis?.() ?? null;
    const expired = expiresAtRaw
      ? (typeof expiresAtMillis === "number" ? expiresAtMillis < now : false)
      : false;
    const maxUsesReached = typeof invite.maxUses === "number" && invite.maxUses > 0
      ? (invite.useCount || 0) >= invite.maxUses
      : false;
    const inviteValid = !revoked && !expired && !maxUsesReached;

    // Resolve room info
    const roomId = String(invite.roomId || "");
    const roomSnap = roomId ? await firestore.collection("rooms").doc(roomId).get() : null;
    const roomExists = !!roomSnap?.exists;
    const room = roomExists ? (roomSnap!.data() as any) || {} : null;
    const roomName = String(room?.roomName || room?.name || roomId || "Room");
    const allowGuests = typeof room?.allowGuests === "boolean" ? room.allowGuests : true;
    const roomStatus = roomExists ? deriveRoomStatus(room) : "not_found";
    const roomType = room?.roomType === "hls" || room?.hlsConfig?.enabled === true ? "hls" : "rtc";
    const guestJoinAllowed = inviteValid && roomStatus === "live" && allowGuests;

    // Debug reason for non-live states
    let debugReason: string | undefined;
    if (!inviteValid) {
      debugReason = revoked ? "invite_revoked" : expired ? "invite_expired" : maxUsesReached ? "invite_max_uses_reached" : "invite_invalid";
    } else {
      debugReason = deriveDebugReason(roomStatus, room);
    }

    // Resolve host name from room owner
    const hostName = await resolveHostName(room?.ownerId);

    return res.json({
      inviteId,
      roomId,
      roomName,
      hostName,
      role: invite.role || "guest",
      status: roomStatus === "live" ? "live" : "idle", // backward compat
      roomStatus,
      allowGuests,
      guestJoinAllowed,
      inviteValid,
      roomType,
      debugReason,
    });
  } catch (err) {
    console.error("/api/invites/:inviteId/info error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /api/rooms/:roomId/join-guest
 * Auth: NONE — direct guest join without invite link
 * Body: { displayName: string }
 * Returns: { serverUrl, roomToken, roomId, identity, displayName, guestSessionToken, roomAccessToken, role }
 *
 * This enables "click link → enter name → watch" without an invite. Only for
 * rooms whose access is "link" or "public" (invite_only rooms answer 403
 * not_allowed); the visitor joins as a subscribe-only audience viewer. The
 * room must have allowGuests !== false and be live (or the env flag
 * ALLOW_GUEST_DIRECT_JOIN_IDLE=1 must be set to allow joining idle rooms).
 */
router.post("/rooms/:roomId/join-guest", async (req: any, res) => {
  try {
    const roomId = String(req.params.roomId || "").trim();
    if (!roomId) return res.status(400).json({ error: "roomId_required" });

    const rawName = String(req.body?.displayName || "").trim();
    const displayName = sanitizeDisplayName(rawName).trim();
    if (!displayName || displayName.length < 1) {
      return res.status(400).json({ error: "displayName_required" });
    }

    // IP rate limiting (reuse existing limiter)
    const ip = String(req.ip || "");
    if (hitRedeemRateLimit(ip)) {
      return res.status(429).json({ error: "rate_limited" });
    }

    // Validate room exists
    const snap = await firestore.collection("rooms").doc(roomId).get();
    if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

    const room = (snap.data() as any) || {};
    const livekitRoomName = String(room.livekitRoomName || roomId).trim();
    const roomName = String(room.roomName || room.name || livekitRoomName || roomId);
    const roomStatus = room.status === "live" ? "live" : "idle";
    const ownerId = typeof room.ownerId === "string" && room.ownerId.trim() ? room.ownerId.trim() : null;

    // Policy: room access. invite_only rooms refuse direct (no-invite) joins;
    // link/public rooms admit the visitor as a subscribe-only audience
    // viewer. Publishing needs an invite or the host's "Bring on stage".
    const roomAccessMode = resolveRoomAccessMode(room);
    const decision = decideDirectGuestJoin(roomAccessMode, room);
    if (!decision.allow) {
      return res.status(decision.status).json({ error: decision.error, access: roomAccessMode });
    }
    if (room.requiresPayment === true) {
      return res.status(402).json({ error: "payment_required" });
    }

    // Policy: room must be live for direct guest join (unless env override)
    const allowIdleJoin = String(process.env.ALLOW_GUEST_DIRECT_JOIN_IDLE || "").trim() === "1";
    if (roomStatus !== "live" && !allowIdleJoin) {
      return res.status(409).json({ error: "room_not_live" });
    }

    // Enforce capacity
    const capDecision = await enforceCapacityOrRespond({
      roomId,
      livekitRoomName,
      ownerId,
      bypass: false,
      res,
    });
    if (!capDecision.ok) return;

    const capLockOwner = capDecision.lockOwner;
    try {
      // Mint LiveKit token
      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;
      if (!apiKey || !apiSecret) {
        return res.status(500).json({ code: "misconfigured", error: "LiveKit keys missing" });
      }

      const identity = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const AccessToken = await getAccessTokenCtor();
      const at = new AccessToken(apiKey, apiSecret, {
        identity,
        name: displayName,
        ttl: "30m",
      });

      const grant = roleGrant("viewer");
      at.addGrant({ room: livekitRoomName, ...grant } as any);
      const livekitToken = await at.toJwt();

      // Create a synthetic guest session (no invite ID — direct join)
      const guestSessionToken = signGuestSession(
        { inviteId: `direct:${roomId}:${identity}`, roomId, role: "guest", displayName, identity },
        GUEST_SESSION_TTL,
      );

      // Room access token
      const roomAccessPayload = {
        roomId,
        roomName,
        livekitRoomName,
        role: "viewer" as const,
        permissions: { ...NO_ROOM_PERMISSIONS },
        identity,
      };
      const roomAccessToken = jwt.sign(roomAccessPayload, getRoomAccessSecret(), { expiresIn: "12h" });

      // Set HttpOnly cookie
      setGuestSessionCookie(res, guestSessionToken);

      const serverUrl = getLiveKitServerUrlForClient();
      if (!serverUrl) {
        return res.status(500).json({ code: "misconfigured", error: "LIVEKIT_URL missing" });
      }

      return res.json({
        serverUrl,
        roomToken: livekitToken,
        roomId,
        identity,
        displayName,
        guestSessionToken,
        roomAccessToken,
        role: "viewer",
        isViewer: true,
        access: roomAccessMode,
        roomName,
        permissions: roomAccessPayload.permissions,
        adminOverride: false,
        presenceMode: "normal",
      });
    } finally {
      if (capLockOwner) {
        await releaseCapacityLock(roomId, capLockOwner);
      }
    }
  } catch (err: any) {
    console.error("/api/rooms/:roomId/join-guest error", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /api/rooms/:roomId/token/invisible
 * Auth: REQUIRED + must have admin or moderator role
 * Body: { displayName?: string }
 * Returns: { serverUrl, roomToken, roomId, identity, mode: "invisible" }
 *
 * Creates a participant that:
 *   - can subscribe (watch/listen)
 *   - cannot publish audio/video/data
 *   - is marked hidden in metadata
 * Ideal for note-taking bots, invisible moderators, observing admins.
 */
router.post("/rooms/:roomId/token/invisible", async (req: any, res) => {
  try {
    const roomId = String(req.params.roomId || "").trim();
    if (!roomId) return res.status(400).json({ error: "roomId_required" });

    const user = await tryGetAuthUserAny(req);
    if (!user) return res.status(401).json({ error: "auth_required" });

    // Check admin status
    const callerIsAdmin = await isAdmin(user.uid);
    if (!callerIsAdmin) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    // Validate room
    const snap = await firestore.collection("rooms").doc(roomId).get();
    if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

    const room = (snap.data() as any) || {};
    const livekitRoomName = String(room.livekitRoomName || roomId).trim();

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      return res.status(500).json({ code: "misconfigured", error: "LiveKit keys missing" });
    }

    const displayName = sanitizeDisplayName(String(req.body?.displayName || "")).trim() || "Observer";
    const identity = `invisible_${user.uid}_${Date.now()}`;

    const AccessToken = await getAccessTokenCtor();
    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: displayName,
      metadata: JSON.stringify({ hidden: true, role: "invisible_mod" }),
    });

    at.addGrant({
      room: livekitRoomName,
      roomJoin: true,
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
    } as any);

    const token = await at.toJwt();

    const serverUrl = getLiveKitServerUrlForClient();
    if (!serverUrl) {
      return res.status(500).json({ code: "misconfigured", error: "LIVEKIT_URL missing" });
    }

    return res.json({
      serverUrl,
      roomToken: token,
      roomId,
      identity,
      mode: "invisible",
    });
  } catch (err: any) {
    console.error("/api/rooms/:roomId/token/invisible error", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
