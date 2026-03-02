import { LIMIT_ERRORS } from "../lib/limitErrors";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

import { Router } from "express";
import crypto from "crypto";
import { InviteClaims, requireAuth, requireAuthOrInvite, verifyInviteToken } from "../middleware/requireAuth";
import { firestore } from "../firebaseAdmin";
import admin from "firebase-admin";
import { ensureRoomDoc } from "../services/rooms";
import { isAdmin } from "../middleware/adminAuth";
import { SIMPLE_ROLE_DEFAULTS } from "./account";
import { intersectPermissionsWithEntitlements } from "../lib/rolePermissions";
import { resolveRoomIdentity } from "../lib/roomIdentity";
import { sanitizeDisplayName } from "../lib/sanitizeDisplayName";
import { roleToParticipantPermission } from "../lib/livekitPermissions";
import jwt from "jsonwebtoken";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import { resolveMaxDestinations } from "../lib/planLimits";
import { getPlatformTranscodeEnabled } from "../lib/platformFlags";

// Dynamic import for AccessToken constructor
async function getAccessTokenCtor() {
  const mod = await import("livekit-server-sdk");
  return mod.AccessToken;
}

async function getRoomServiceClient() {
  const mod = await import("livekit-server-sdk");
  return mod.RoomServiceClient;
}

async function getHlsUiFlag() {
  const snap = await firestore.collection("featureFlags").doc("hlsSettingsTab").get();
  const data = snap.exists ? ((snap.data() as any) || {}) : {};
  const enabled = data.enabled === undefined ? true : !!data.enabled;
  return {
    enabled,
    reason: typeof data.reason === "string" ? data.reason : undefined,
  };
}

async function getRecordingUiFlag() {
  const snap = await firestore.collection("featureFlags").doc("recording").get();
  const data = snap.exists ? ((snap.data() as any) || {}) : {};
  const enabled = data.enabled === undefined ? true : !!data.enabled;
  return {
    enabled,
    reason: typeof data.reason === "string" ? data.reason : undefined,
  };
}

async function getSegmentedUiFlags() {
  const [
    contentLibrarySnap,
    projectsSnap,
    editorSnap,
    myContentSnap,
    myContentRecordingsSnap,
  ] = await Promise.all([
    firestore.collection("featureFlags").doc("contentLibraryEnabled").get(),
    firestore.collection("featureFlags").doc("projectsEnabled").get(),
    firestore.collection("featureFlags").doc("editorEnabled").get(),
    firestore.collection("featureFlags").doc("myContentEnabled").get(),
    firestore.collection("featureFlags").doc("myContentRecordingsEnabled").get(),
  ]);

  const contentLibraryData = contentLibrarySnap.exists ? ((contentLibrarySnap.data() as any) || {}) : {};
  const projectsData = projectsSnap.exists ? ((projectsSnap.data() as any) || {}) : {};
  const editorData = editorSnap.exists ? ((editorSnap.data() as any) || {}) : {};
  const myContentData = myContentSnap.exists ? ((myContentSnap.data() as any) || {}) : {};
  const myContentRecordingsData = myContentRecordingsSnap.exists
    ? ((myContentRecordingsSnap.data() as any) || {})
    : {};

  // New segmented flags default to DISABLED when missing.
  return {
    contentLibraryEnabled: contentLibraryData.enabled === true,
    projectsEnabled: projectsData.enabled === true,
    editorEnabled: editorData.enabled === true,
    myContentEnabled: myContentData.enabled === true,
    myContentRecordingsEnabled: myContentRecordingsData.enabled === true,
  };
}

function deriveServiceUrl(): string | null {
  const raw = process.env.LIVEKIT_URL || "";
  if (!raw) return null;
  // Convert wss://host to https://host for RoomServiceClient
  return raw.replace(/^wss?:\/\//i, (m) => (m.toLowerCase() === "ws://" ? "http://" : "https://"));
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

type GrantRole = "viewer" | "participant" | "host" | "cohost";

type ViewerInvite = {
  roomId: string;
  roleProfileId: "viewer";
  expiresAt?: FirebaseFirestore.Timestamp | null;
  expiresOnRoomEnd?: boolean;
  viewerGraceMinutes?: number;
  maxUses?: number | null;
  usedCount?: number;
  usedSessions?: string[];
  revokedAt?: FirebaseFirestore.Timestamp | null;
  allowRejoin?: boolean;
  requirePasscode?: string | null;
  requireDisplayName?: boolean;
  allowAnonymous?: boolean;
  createdAt?: FirebaseFirestore.Timestamp;
  createdBy?: string;
};

function roleToGrant(role: GrantRole) {
  // Start from the shared ParticipantPermission mapper so join-time
  // grants and realtime updateParticipant calls stay aligned for
  // publish/subscribe/data capabilities.
  const permissionRole: "viewer" | "participant" | "cohost" =
    role === "viewer"
      ? "viewer"
      : role === "cohost" || role === "host"
        ? "cohost"
        : "participant";

  const participantPerm = roleToParticipantPermission(permissionRole);

  const base = {
    roomJoin: true,
    canSubscribe: participantPerm.canSubscribe,
    canPublish: participantPerm.canPublish,
    canPublishData: participantPerm.canPublishData,
  } as const;

  if (role === "viewer") {
    return { ...base, roomAdmin: false, canUpdateMetadata: false };
  }

  // participant/host/cohost/viewer
  return { ...base, roomAdmin: false, canUpdateMetadata: false };
}

async function getPermissionsMode(uid?: string): Promise<"simple" | "advanced"> {
  // Advanced permissions have been removed; always operate in simple mode.
  return "simple";
}

type ResolvedRole = {
  grantRole: GrantRole;
  permissions: Record<string, boolean>;
  effectiveRoleKey: "viewer" | "participant" | "cohost" | "host";
  locked: boolean;
};

async function resolveRoleForInvite(opts: { uid?: string; requestedRole?: string }): Promise<{ ok: true; result: ResolvedRole } | { ok: false; error: any }> {
  const allowedSimpleRoles: Array<ResolvedRole["effectiveRoleKey"]> = ["participant", "cohost", "host"];
  const requested = String(opts.requestedRole || "participant").toLowerCase();
  const mode = await getPermissionsMode(opts.uid);
  if (mode === "simple") {
    const isAllowed = allowedSimpleRoles.includes(requested as any);
    const effectiveRoleKey = isAllowed
      ? (requested as ResolvedRole["effectiveRoleKey"])
      : "participant";

    if (!isAllowed && opts.requestedRole) {
      return {
        ok: false,
        error: {
          error: "simple_mode_locked",
          allowedRoles: allowedSimpleRoles,
          effectiveRoleKey,
          locked: true,
          note: "Viewer room tokens are disabled in simple mode; use watch links.",
        },
      };
    }

    const basePerms =
      effectiveRoleKey === "host"
        ? SIMPLE_ROLE_DEFAULTS.host
        : SIMPLE_ROLE_DEFAULTS[effectiveRoleKey as "participant" | "cohost"];

    const grantRole: GrantRole = effectiveRoleKey === "host"
      ? "host"
      : effectiveRoleKey === "cohost"
        ? "participant"
        : (effectiveRoleKey as GrantRole);

    const permissions = await intersectPermissionsWithEntitlements(basePerms, opts.uid);

    return {
      ok: true,
      result: {
        grantRole,
        permissions,
        effectiveRoleKey,
        locked: true,
      },
    };
  }

  // advanced: preserve existing behavior
  const allowedRoles: GrantRole[] = ["host", "participant", "viewer", "cohost"];
  const normalizedRole = (allowedRoles.includes(requested as GrantRole) ? (requested as GrantRole) : "participant") as GrantRole;
  const grantRole: GrantRole = normalizedRole === "cohost" ? "participant" : normalizedRole;
  const effectiveRoleKey: ResolvedRole["effectiveRoleKey"] = normalizedRole === "cohost" ? "cohost" : (normalizedRole as any);
  // Advanced mode currently does not hydrate custom profiles; keep existing grant mapping (moderation now host-only)
  const basePerms = { canStream: true, canRecord: true, canDestinations: true, canModerate: false, canLayout: true, canScreenShare: true, canInvite: true, canAnalytics: false };
  const permissions = await intersectPermissionsWithEntitlements(basePerms, opts.uid);
  return { ok: true, result: { grantRole, permissions, effectiveRoleKey, locked: false } };
}

async function getPlanLimit(uid: string, field: string): Promise<number | undefined> {
  const userSnap = await firestore.collection("users").doc(uid).get();
  const planId = String((userSnap.data() || {}).planId || "free");
  const planSnap = await firestore.collection("plans").doc(planId).get();
  if (!planSnap.exists) return undefined;
  const limits = (planSnap.data() || {}).limits || {};
  const raw = limits[field];
  if (raw === undefined || raw === null) return undefined;
  const num = Number(raw);
  return Number.isFinite(num) ? num : undefined;
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
      console.warn("[roomToken] Using JWT_SECRET fallback for ROOM_ACCESS_TOKEN_SECRET");
    }
  }

  return raw || "dev-secret";
}

function nowTs() {
  return FirebaseFirestore.Timestamp.now();
}

function addMinutes(ts: FirebaseFirestore.Timestamp, minutes: number) {
  const ms = ts.toMillis() + minutes * 60 * 1000;
  return FirebaseFirestore.Timestamp.fromMillis(ms);
}

async function getParticipantCount(roomName: string): Promise<number | null> {
  const serviceUrl = deriveServiceUrl();
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!serviceUrl || !apiKey || !apiSecret) return null;
  try {
    const RoomServiceClient = await getRoomServiceClient();
    const client = new RoomServiceClient(serviceUrl, apiKey, apiSecret);
    const participants = await client.listParticipants(roomName);
    return participants?.length ?? 0;
  } catch (err) {
    console.warn("[roomToken] participant count failed", (err as any)?.message || err);
    return null;
  }
}

const CAPACITY_LOCK_TTL_MS = 10_000;

function normalizePositiveCap(value: unknown): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.floor(num);
}

async function resolveMaxGuestsCap(ownerId: string | null): Promise<number | undefined> {
  if (!ownerId) return undefined;
  const planCap = normalizePositiveCap(await getPlanLimit(ownerId, "maxGuests"));
  if (planCap !== undefined) return planCap;
  return normalizePositiveCap(process.env.MAX_GUESTS_PER_ROOM || "0");
}

function capacityLockRef(roomId: string) {
  return firestore.collection("roomCapacityLocks").doc(roomId);
}

async function acquireCapacityLock(roomId: string): Promise<string | null> {
  const ref = capacityLockRef(roomId);
  const owner = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const nowMs = Date.now();
  const expiresAt = nowMs + CAPACITY_LOCK_TTL_MS;

  try {
    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() as any) : null;
      const lockedUntil = typeof data?.expiresAtMs === "number" ? data.expiresAtMs : 0;
      if (lockedUntil && lockedUntil > nowMs) {
        throw new Error("lock_busy");
      }

      tx.set(
        ref,
        {
          owner,
          acquiredAtMs: nowMs,
          expiresAtMs: expiresAt,
        },
        { merge: true },
      );
    });
    return owner;
  } catch {
    return null;
  }
}

async function releaseCapacityLock(roomId: string, owner: string | null) {
  if (!owner) return;
  try {
    const ref = capacityLockRef(roomId);
    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() as any;
      if (data?.owner !== owner) return;
      tx.delete(ref);
    });
  } catch {
    // best-effort
  }
}

const router = Router();

// Hard cutoff for legacy name-only joins (no roomId anywhere).
// After this date, requests that rely solely on roomName should be rejected.
export const LEGACY_ROOMNAME_JOIN_SUNSET = "2026-02-01";

function isLegacyJoinExpired() {
  const ts = Date.parse(LEGACY_ROOMNAME_JOIN_SUNSET);
  if (!Number.isFinite(ts)) return false;
  return Date.now() >= ts;
}

async function recordLegacyRoomNameJoin(ctx: {
  route: string;
  roomName: string;
  uid?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}) {
  try {
    console.warn("[metrics] legacy_roomname_join", {
      event: "legacy_roomname_join",
      route: ctx.route,
      roomName: ctx.roomName,
      uid: ctx.uid || null,
      ip: ctx.ip || null,
      userAgent: ctx.userAgent || null,
    });

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const ref = firestore
      .collection("metrics")
      .doc("legacyJoinEvents")
      .collection("days")
      .doc(today);

    await ref.set(
      {
        count: admin.firestore.FieldValue.increment(1),
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  } catch (err) {
    // Metrics should never break auth/token flows.
    console.warn("[metrics] failed to record legacy_roomname_join", err);
  }
}

async function createViewerInvite(roomId: string, opts: {
  createdBy?: string;
  maxUses?: number | null;
  passcode?: string | null;
  requireDisplayName?: boolean;
  allowAnonymous?: boolean;
  viewerGraceMinutes?: number;
}) {
  const docRef = firestore.collection("viewerInvites").doc();
  const payload: ViewerInvite = {
    roomId,
    roleProfileId: "viewer",
    expiresAt: null,
    expiresOnRoomEnd: true,
    viewerGraceMinutes: typeof opts.viewerGraceMinutes === "number" ? opts.viewerGraceMinutes : 10,
    maxUses: opts.maxUses ?? null,
    usedCount: 0,
    usedSessions: [],
    revokedAt: null,
    allowRejoin: true,
    requirePasscode: opts.passcode || null,
    requireDisplayName: opts.requireDisplayName ?? false,
    allowAnonymous: opts.allowAnonymous ?? true,
    createdAt: nowTs(),
    createdBy: opts.createdBy,
  };
  await docRef.set(payload, { merge: false });
  return { inviteId: docRef.id };
}

async function validateViewerInvite(inviteToken: string, roomId: string, sessionId: string, passcode?: string) {
  const doc = await firestore.collection("viewerInvites").doc(inviteToken).get();
  if (!doc.exists) return { ok: false, reason: "not_found" } as const;
  const data = doc.data() as ViewerInvite;
  if (data.roomId !== roomId) return { ok: false, reason: PERMISSION_ERRORS.ROOM_MISMATCH } as const;
  if (data.revokedAt) return { ok: false, reason: "revoked" } as const;

  // Expiry checks
  if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
    return { ok: false, reason: "expired" } as const;
  }

  // Grace-after-end: if we had room end timestamps we would enforce here; keeping placeholder for future.

  // Passcode check
  if (data.requirePasscode) {
    if (!passcode || passcode !== data.requirePasscode) {
      return { ok: false, reason: "passcode_required" } as const;
    }
  }

  // Uses check (count unique sessions)
  const usedSessions = Array.isArray(data.usedSessions) ? data.usedSessions : [];
  const alreadyUsed = usedSessions.includes(sessionId);
  const maxUses = data.maxUses ?? null;
  if (!alreadyUsed && maxUses !== null && maxUses > 0 && usedSessions.length >= maxUses) {
    return { ok: false, reason: "max_used" } as const;
  }

  // If new session, record it
  if (!alreadyUsed) {
    const nextSessions = usedSessions.concat(sessionId).slice(-1000);
    await doc.ref.update({
      usedSessions: nextSessions,
      usedCount: (data.usedCount || 0) + 1,
    });
  }

  return { ok: true, invite: data } as const;
}

router.post("/", requireAuthOrInvite, async (req, res) => {
  let capacityLockOwner: string | null = null;
  let capacityLockRoomId: string | null = null;
  try {
    const { roomName: rawRoomName, roomId: rawRoomId, identity: _ignoredIdentity, role: rawRole, displayName: rawDisplayName } = req.body as {
      roomName?: string;
      roomId?: string;
      identity?: string;
      inviteToken?: string;
      role?: string;
      displayName?: string;
    };
    const uid = (req as any).user?.uid as string | undefined;
    const invite = (req as any).invite as InviteClaims | undefined;

    // Default: RTC token issuance requires authentication.
    // Invite tokens may still be supplied for role/authorization context,
    // but do not allow anonymous token minting.
    if (!uid) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const trimmedRoomId = String(rawRoomId || "").trim();
    const trimmedRoomName = sanitizeDisplayName(String(rawRoomName || "")).trim();

    const userDisplayNameRaw = (req as any).user?.displayName as string | undefined;
    const bodyDisplayNameSanitized = sanitizeDisplayName(String(rawDisplayName || "")).trim();
    const userDisplayNameSanitized = sanitizeDisplayName(String(userDisplayNameRaw || "")).trim();
    const displayName =
      bodyDisplayNameSanitized || userDisplayNameSanitized || "Guest";

    // Host/control-plane contract: authenticated callers without an invite
    // must provide a canonical roomId. Name-only is rejected so we never
    // depend on roomName for host/control flows.
    if (uid && !invite && !trimmedRoomId) {
      return res.status(400).json({ error: "roomId_required_for_host" });
    }

    const inviteRoomId = String(invite?.roomId || "").trim();
    const inviteRoomName = String(invite?.roomName || invite?.room || "").trim();

    const isLegacyNameOnly = !trimmedRoomId && !inviteRoomId && !!trimmedRoomName;
    if (isLegacyNameOnly) {
      if (isLegacyJoinExpired()) {
        return res.status(410).json({ error: "legacy_roomname_join_disabled" });
      }
      await recordLegacyRoomNameJoin({
        route: "/api/roomToken",
        roomName: trimmedRoomName,
        uid,
        ip: (req as any).ip || null,
        userAgent: (req.headers["user-agent"] as string) || null,
      });
    }

    const resolvedRoom = await resolveRoomIdentity({
      roomId: trimmedRoomId || inviteRoomId || null,
      roomName: trimmedRoomName || inviteRoomName || null,
    });

    if (!resolvedRoom) return res.status(400).json({ error: LIMIT_ERRORS.FEATURE_NOT_ENTITLED }); // Canonical code for missing entitlement/feature
    const roomId = resolvedRoom.roomId;
    const roomName = resolvedRoom.roomName;

    if (invite) {
      if (inviteRoomId && inviteRoomId !== roomId) return res.status(403).json({ error: "invite_room_mismatch" });
      if (inviteRoomName && inviteRoomName !== roomName) return res.status(403).json({ error: "invite_room_mismatch" });
    }

    // Prefer role from invite claims when present; allow cohost/moderator if present.
    let requestedRole = rawRole;
    const inviteRoleRaw = (invite as any)?.role as string | undefined;
    if (inviteRoleRaw) {
      const v = String(inviteRoleRaw).toLowerCase();
      if (v === "guest" || v === "participant") requestedRole = "participant";
      else if (v === "cohost") requestedRole = "cohost";
      else if (v === "moderator") requestedRole = "moderator";
      else requestedRole = "participant";
    }

    let normalizedRequested = String(requestedRole || "participant").toLowerCase();
    const elevatedRequested = normalizedRequested === "cohost" || normalizedRequested === "moderator";

    const callerIsAdmin = !!uid && (await isAdmin(uid));

    // If an elevated role is requested but the caller is not authenticated,
    // reject even if an invite token is present.
    if (elevatedRequested && !uid) {
      return res.status(401).json({ error: "auth_required_for_elevated_role" });
    }

    // Safety: moderator tokens are admin-only unless an invite explicitly
    // authorizes it. If an authenticated user requests moderator without any
    // invite, require admin and otherwise downgrade.
    if (uid && !invite && normalizedRequested === "moderator") {
      if (!callerIsAdmin) requestedRole = "participant";
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      const missing: string[] = [];
      if (!apiKey) missing.push("LIVEKIT_API_KEY");
      if (!apiSecret) missing.push("LIVEKIT_API_SECRET");
      return res.status(500).json({ code: "misconfigured", error: "LiveKit keys missing", missing });
    }

    const inviteIdentity = invite?.identity || invite?.uid || invite?.sub || null;
    const tokenIdentity = uid || inviteIdentity || `invite-${roomId}`;
    if (!tokenIdentity || !String(tokenIdentity).trim()) {
      return res.status(500).json({ code: "internal_error", error: "invalid_identity" });
    }
    if (!roomName || !String(roomName).trim()) {
      return res.status(500).json({ code: "internal_error", error: "invalid_room_name" });
    }

    // Determine which account's entitlements and permission mode should apply.
    // We always scope entitlements to the room owner, never the caller.
    let entitlementsUid: string | null = null;
    let roomSnapExists: boolean | null = null;
    let roomPolicy: { ownerId: string | null; visibility: "public" | "unlisted" | "private"; requiresAuth: boolean; requiresPayment: boolean; roomType?: string | null } = {
      ownerId: null,
      visibility: "unlisted",
      requiresAuth: true,
      requiresPayment: false,
      roomType: null,
    };
    try {
      const roomRef = firestore.collection("rooms").doc(roomId);
      const roomSnap = await roomRef.get();
      roomSnapExists = roomSnap.exists;
      const roomData = (roomSnap.exists ? roomSnap.data() : null) as any;

      const visibilityRaw = String(roomData?.visibility || "").trim().toLowerCase();
      const visibility = (visibilityRaw === "public" || visibilityRaw === "unlisted" || visibilityRaw === "private")
        ? (visibilityRaw as any)
        : "unlisted";

      roomPolicy = {
        ownerId: typeof roomData?.ownerId === "string" && roomData.ownerId.trim() ? roomData.ownerId.trim() : null,
        visibility,
        requiresAuth: typeof roomData?.requiresAuth === "boolean" ? !!roomData.requiresAuth : true,
        requiresPayment: typeof roomData?.requiresPayment === "boolean" ? !!roomData.requiresPayment : false,
        roomType: typeof roomData?.roomType === "string" ? roomData.roomType : null,
      };

      // Role enforcement:
      // - Existing rooms: only the room owner may be treated as the host.
      // - Owner joins: always mint a host-scoped roomAccessToken so host tools
      //   (mute/remove/etc) work even if the client omitted role=host.
      // - Non-owner joins: never allow self-assigned host role.
      if (roomPolicy.ownerId) {
        const isOwner = !!uid && uid === roomPolicy.ownerId;
        if (isOwner) {
          requestedRole = "host";
          normalizedRequested = "host";
        } else if (callerIsAdmin) {
          // Internal admin override: allow host-level tooling in any room.
          requestedRole = "host";
          normalizedRequested = "host";
        } else if (normalizedRequested === "host") {
          requestedRole = "participant";
          normalizedRequested = "participant";
        }
      }

      // Room policy enforcement (server-side, before token issuance)
      if (roomPolicy.requiresAuth && !uid) {
        return res.status(401).json({ error: "Login required" });
      }
      if (!callerIsAdmin) {
        if (roomPolicy.visibility === "private" && roomPolicy.ownerId && uid !== roomPolicy.ownerId) {
          return res.status(403).json({ error: "Not allowed" });
        }
        if (roomPolicy.requiresPayment && roomPolicy.ownerId && uid !== roomPolicy.ownerId) {
          return res.status(402).json({ error: "payment_required" });
        }
      }
      if (roomPolicy.roomType && roomPolicy.roomType !== "rtc") {
        return res.status(400).json({ error: "room_not_rtc" });
      }

      if (roomData && typeof roomData.ownerId === "string" && roomData.ownerId.trim()) {
        entitlementsUid = roomData.ownerId.trim();
      } else if (uid && normalizedRequested === "host") {
        // Fallback: for freshly created rooms with no doc yet, treat the
        // authenticated host caller as the owner so joins still work.
        entitlementsUid = uid;
      }
    } catch (err) {
      console.error("[roomToken] failed to load room owner", err);
    }

    // Capacity enforcement (fail-closed): for non-owner joins, enforce the room owner's
    // maxGuests cap (plan-aware). This prevents bypassing guest caps via the authed token route.
    // Hold a short Firestore lock across the check + mint to reduce oversubscription races.
    const capacityBypass = !!callerIsAdmin || (!!uid && !!roomPolicy.ownerId && uid === roomPolicy.ownerId);
    if (!capacityBypass) {
      const cap = await resolveMaxGuestsCap(entitlementsUid || roomPolicy.ownerId);
      if (cap !== undefined) {
        capacityLockOwner = await acquireCapacityLock(roomId);
        capacityLockRoomId = roomId;
        if (!capacityLockOwner) {
          return res.status(503).json({ error: "capacity_check_busy" });
        }
        const participantCount = await getParticipantCount(roomName);
        if (participantCount === null) {
          return res.status(503).json({ error: "capacity_check_unavailable" });
        }
        if (participantCount >= cap) {
          return res.status(429).json({ error: "room_full" });
        }
      }
    }

    // Invariant: a host join with auth should always resolve an entitlementsUid.
    // If this ever fails, it indicates a broken room document or ownership state.
    if (normalizedRequested === "host" && uid && !entitlementsUid) {
      console.error("[roomToken] host join with no entitlementsUid", {
        roomId,
        uid,
        normalizedRequested,
        roomSnapExists,
      });
      return res.status(409).json({ error: "room_owner_missing" });
    }

    let effectiveEntitlementsPayload: any = null;
    let platformFlags: any = null;

    if (entitlementsUid) {
      try {
        await ensureRoomDoc({
          roomId,
          ownerId: entitlementsUid,
          // Store the canonical LiveKit room key; do not depend on
          // any future display-only roomName changes.
          livekitRoomName: roomName,
          roomType: "rtc",
          initialStatus: "live",
        });
      } catch (err) {
        console.error("[roomToken] ensureRoomDoc failed", err);
        return res.status(500).json({ error: "room_init_failed" });
      }

      try {
        const [entitlements, hlsUi, recordingUi, segmentedUiFlags] = await Promise.all([
          getEffectiveEntitlements(entitlementsUid),
          getHlsUiFlag(),
          getRecordingUiFlag(),
          getSegmentedUiFlags(),
        ]);

        const plan = entitlements.plan;
        const limits = entitlements.limits;
        const features = entitlements.features;
        const rawFeatures = ((plan.raw?.features || {}) as any) || {};

        const rtmpMultistreamEnabled = Boolean(
          rawFeatures.rtmpMultistream ??
            rawFeatures.multistream ??
            (plan.raw as any)?.multistreamEnabled ??
            features.multistream,
        );

        const canHls = Boolean(
          (features as any).hls ??
            (features as any).hlsEnabled ??
            (features as any).canHls ??
            rawFeatures.canHls ??
            rawFeatures.hls ??
            rawFeatures.hlsBroadcast,
        );

        const hlsCustomizationEnabled = (() => {
          const explicit = (features as any).hlsCustomizationEnabled;
          if (typeof explicit === "boolean") return explicit;
          const legacy = (rawFeatures as any).canCustomizeHlsPage;
          if (typeof legacy === "boolean") return legacy;
          return canHls;
        })();

        const rtmpDestinationsMax = resolveMaxDestinations(limits);

        // Keep plan-based entitlements and platform-level flags separate.
        // The client is responsible for combining them when gating UI.
        effectiveEntitlementsPayload = {
          planId: entitlements.planId,
          planName: plan.name || entitlements.planId,
          features: {
            recording: !!features.recording,
            rtmpMultistream: rtmpMultistreamEnabled,
            dualRecording: !!(rawFeatures.dualRecording ?? rawFeatures.dual_recording),
            watermark: !!(rawFeatures.watermarkRecordings ?? rawFeatures.watermark),
            canHls,
            hls: canHls,
            hlsEnabled: canHls,
            hlsCustomizationEnabled,
            canCustomizeHlsPage: hlsCustomizationEnabled,
          },
          limits: {
            rtmpDestinationsMax,
            maxDestinations: rtmpDestinationsMax,
            maxGuests: Number(limits.maxGuests || 0),
            participantMinutes: Number(
              (limits as any).monthlyMinutes || (limits as any).monthlyMinutesIncluded || 0,
            ),
            transcodeMinutes: Number((limits as any).transcodeMinutes || 0),
            maxRecordingMinutesPerClip: Number((limits as any).maxRecordingMinutesPerClip || 0),
          },
          caps: entitlements.caps || {},
        };

        const platformTranscodeEnabled = getPlatformTranscodeEnabled();
        platformFlags = {
          hlsEnabled: hlsUi.enabled,
          hlsSettingsTab: hlsUi.enabled,
          transcodeEnabled: platformTranscodeEnabled,
          recordingEnabled: recordingUi.enabled,
          ...segmentedUiFlags,
        };
      } catch (err) {
        console.error("[roomToken] failed to compute effectiveEntitlements", err);
      }
    }

    const resolved = await resolveRoleForInvite({ uid: entitlementsUid || uid || null, requestedRole });
    if (resolved.ok === false) {
      const payload = resolved.error;
      return res.status(400).json(payload);
    }
    const { grantRole, effectiveRoleKey, locked } = resolved.result;
    let permissions = { ...resolved.result.permissions };

    // Host invariants: the canonical host role should always retain full
    // streaming + moderation surface area, regardless of editable presets.
    // We key this strictly off the effective role so that any
    // downgrade logic in resolveRoleForInvite is respected.
    if (effectiveRoleKey === "host") {
      permissions = {
        ...permissions,
        canStream: true,
        canRecord: true,
        canDestinations: true,
        canLayout: true,
        canModerate: true,
        canMuteGuests: true,
        canRemoveGuests: true,
      };
    }
    const isViewer = grantRole === "viewer";

    if (process.env.AUTH_DEBUG === "1") {
      console.log("[invite-debug] mint room token", {
        roomName,
        uid,
        hasInvite: !!invite,
        requestedRole: rawRole || null,
        grantRole,
        effectiveRoleKey,
        permissions,
        locked,
      });
    }

    // Canonical LiveKit room key must never depend on display labels.
    // For now, our resolver only exposes a single roomName field which is
    // already derived from rooms.livekitRoomName || roomName || name || id.
    // Treat that as the canonical LiveKit key and carry it explicitly.
    const livekitRoomName = roomName;
    if (!livekitRoomName || !String(livekitRoomName).trim()) {
      return res.status(500).json({ code: "internal_error", error: "invalid_livekit_room_name" });
    }

    const AccessToken = await getAccessTokenCtor();
    const at = new AccessToken(apiKey, apiSecret, { identity: tokenIdentity, name: displayName });
    at.addGrant({
      room: livekitRoomName,
      ...roleToGrant(grantRole),
    });
    const lkJwt = await at.toJwt();
    console.log("✅ roomToken jwt typeof:", typeof lkJwt, "len:", lkJwt.length);

    const serverUrl = getLiveKitServerUrlForClient();
    if (!serverUrl) {
      return res.status(500).json({
        code: "misconfigured",
        error: "LIVEKIT_URL missing",
        missing: ["LIVEKIT_URL"],
      });
    }

    const roomAccessPayload = {
      roomId,
      // Optional human/display label for the room; safe for UI.
      roomName,
      // Required canonical LiveKit room key for all LK APIs.
      livekitRoomName,
      role: effectiveRoleKey,
      permissions,
      identity: tokenIdentity,
      adminOverride: callerIsAdmin && !!roomPolicy.ownerId && !!uid && uid !== roomPolicy.ownerId,
    } as const;

    const roomAccessToken = jwt.sign(roomAccessPayload, getRoomAccessSecret(), {
      expiresIn: "12h",
    });

    // Optional audit trail for token issuance (do NOT store tokens).
    if (process.env.AUDIT_ROOM_TOKENS === "1") {
      firestore
        .collection("roomTokenAudit")
        .add({
          route: "/api/roomToken",
          uid,
          roomId,
          roomName,
          identity: tokenIdentity,
          grantRole,
          effectiveRoleKey,
          usedInvite: !!invite,
          ip: (req as any).ip || null,
          userAgent: (req.headers["user-agent"] as string) || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        .catch((err) => console.error("[roomToken] audit write failed", err));
    }

    return res.status(200).json({
      token: lkJwt,
      serverUrl,
      role: grantRole,
      isViewer,
      permissions,
      effectiveRoleKey,
      locked,
      roomId,
      roomName,
      roomAccessToken,
      adminOverride: callerIsAdmin && !!roomPolicy.ownerId && !!uid && uid !== roomPolicy.ownerId,
      effectiveEntitlements: effectiveEntitlementsPayload,
      platformFlags,
    });
  } catch (err: any) {
    console.error("[roomToken] Critical error during token creation for room:", req.params.roomId);
    console.error("[roomToken] Error Object:", err);
    console.error("[roomToken] Error Message:", err.message);
    console.error("[roomToken] Stack Trace:", err.stack);

    return res.status(500).json({
      code: "internal_error",
      error: "Failed to create room token",
      // For client-side debugging, include the room ID
      roomId: req.params.roomId,
    });
  } finally {
    await releaseCapacityLock(capacityLockRoomId || "", capacityLockOwner);
  }
});

// Public guest token: subscribe only (downgraded to viewer when over cap)
router.post("/guest", requireAuth as any, async (req: any, res) => {
  let capacityLockOwner: string | null = null;
  let capacityLockRoomId: string | null = null;
  try {
    const { roomName: rawRoomName, roomId: rawRoomId, displayName, guestId, inviteToken } = req.body as {
      roomName?: string;
      roomId?: string;
      displayName?: string;
      guestId?: string;
      inviteToken?: string;
    };

    // Default: RTC token issuance requires authentication.
    const uid = req.user?.uid as string | undefined;
    if (!uid) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if ((!rawRoomName || !rawRoomName.trim()) && (!rawRoomId || !rawRoomId.trim()) && !inviteToken) {
      return res.status(400).json({ error: "roomId_or_roomName_required" });
    }
    const sanitizedDisplayName = sanitizeDisplayName(displayName).trim();
    if (!sanitizedDisplayName) {
      return res.status(400).json({ error: "invalid_display_name" });
    }

    let inviteClaims: InviteClaims | undefined;
    if (inviteToken) {
      try {
        inviteClaims = verifyInviteToken(inviteToken);
      } catch (err) {
        console.error("guest invite verify failed", (err as any)?.message || err);
        return res.status(401).json({ error: "invalid_invite" });
      }
    }

    const inputRoomId = String(rawRoomId || "").trim();
    const inputRoomName = sanitizeDisplayName(String(rawRoomName || "")).trim();
    const inviteRoomId = String(inviteClaims?.roomId || "").trim();
    const inviteRoomName = String((inviteClaims as any)?.roomName || (inviteClaims as any)?.room || "").trim();

    const isLegacyNameOnly = !inputRoomId && !inviteRoomId && !!inputRoomName;
    if (isLegacyNameOnly) {
      if (isLegacyJoinExpired()) {
        return res.status(410).json({ error: "legacy_roomname_join_disabled" });
      }
      await recordLegacyRoomNameJoin({
        route: "/api/roomToken/guest",
        roomName: inputRoomName,
        uid: (req.body as any)?.hostUid || null,
        ip: (req as any).ip || null,
        userAgent: (req.headers["user-agent"] as string) || null,
      });
    }

    const resolvedRoom = await resolveRoomIdentity({
      roomId: inputRoomId || inviteRoomId || null,
      roomName: inputRoomName || inviteRoomName || null,
    });
    if (!resolvedRoom) return res.status(400).json({ error: "roomId_or_roomName_required" });
    const roomId = resolvedRoom.roomId;
    const roomName = resolvedRoom.roomName;

    if (inviteClaims) {
      const inviteRoomId = String(inviteClaims.roomId || "").trim();
      const inviteRoomName = String(inviteClaims.roomName || inviteClaims.room || "").trim();
      if (inviteRoomId && inviteRoomId !== roomId) return res.status(403).json({ error: "invite_room_mismatch" });
      if (inviteRoomName && inviteRoomName !== roomName) return res.status(403).json({ error: "invite_room_mismatch" });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      const missing: string[] = [];
      if (!apiKey) missing.push("LIVEKIT_API_KEY");
      if (!apiSecret) missing.push("LIVEKIT_API_SECRET");
      return res.status(500).json({ code: "misconfigured", error: "LiveKit keys missing", missing });
    }

    // Load room policy + owner (do not trust hostUid from the client).
    let ownerId: string | null = null;
    let visibility: "public" | "unlisted" | "private" = "unlisted";
    let requiresAuth = true;
    let requiresPayment = false;
    let roomType: string | null = null;
    try {
      const roomSnap = await firestore.collection("rooms").doc(roomId).get();
      const roomData = roomSnap.exists ? ((roomSnap.data() as any) || {}) : {};
      ownerId = typeof roomData.ownerId === "string" && roomData.ownerId.trim() ? roomData.ownerId.trim() : null;
      const visibilityRaw = String(roomData.visibility || "").trim().toLowerCase();
      if (visibilityRaw === "public" || visibilityRaw === "unlisted" || visibilityRaw === "private") {
        visibility = visibilityRaw as any;
      }
      requiresAuth = typeof roomData.requiresAuth === "boolean" ? !!roomData.requiresAuth : true;
      requiresPayment = typeof roomData.requiresPayment === "boolean" ? !!roomData.requiresPayment : false;
      roomType = typeof roomData.roomType === "string" ? roomData.roomType : null;
    } catch (err) {
      console.error("[roomToken/guest] failed to load room policy", err);
    }

    if (requiresAuth && !uid) {
      return res.status(401).json({ error: "Login required" });
    }
    if (visibility === "private" && ownerId && uid !== ownerId) {
      return res.status(403).json({ error: "Not allowed" });
    }
    if (requiresPayment && ownerId && uid !== ownerId) {
      return res.status(402).json({ error: "payment_required" });
    }
    if (roomType && roomType !== "rtc") {
      return res.status(400).json({ error: "room_not_rtc" });
    }

    // Guest cap check (plan-aware via owner, fallback to env).
    // Fail-closed on capacity check failures so outages/misconfig don't become "no cap".
    const hostUid = ownerId || (inviteClaims as any)?.uid || (inviteClaims as any)?.sub || uid;
    const cap = await resolveMaxGuestsCap(hostUid || null);
    if (cap !== undefined) {
      capacityLockOwner = await acquireCapacityLock(roomId);
      capacityLockRoomId = roomId;
      if (!capacityLockOwner) {
        return res.status(503).json({ error: "capacity_check_busy" });
      }
      const participantCount = await getParticipantCount(roomName);
      if (participantCount === null) {
        return res.status(503).json({ error: "capacity_check_unavailable" });
      }
      if (participantCount >= cap) {
        return res.status(429).json({ error: "room_full" });
      }
    }

    const identity = (guestId && guestId.trim()) || uid;
    if (!identity || !String(identity).trim()) {
      return res.status(500).json({ code: "internal_error", error: "invalid_identity" });
    }
    if (!roomName || !String(roomName).trim()) {
      return res.status(500).json({ code: "internal_error", error: "invalid_room_name" });
    }
    const resolved = await resolveRoleForInvite({ uid: hostUid, requestedRole: "participant" });
    if (resolved.ok === false) {
      const payload = resolved.error;
      return res.status(400).json(payload);
    }

    const AccessToken = await getAccessTokenCtor();
    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      // Use the provided display name for the LiveKit participant name
      name: sanitizedDisplayName,
    });
    at.addGrant({
      room: roomName,
      ...roleToGrant(resolved.result.grantRole),
    });
    const lkJwt = await at.toJwt();
    const serverUrl = getLiveKitServerUrlForClient();
    if (!serverUrl) {
      return res.status(500).json({
        code: "misconfigured",
        error: "LIVEKIT_URL missing",
        missing: ["LIVEKIT_URL"],
      });
    }
    if (process.env.AUTH_DEBUG === "1") {
      console.log("[invite-debug] mint guest room token", {
        roomName,
        hostUid,
        grantRole: resolved.result.grantRole,
        effectiveRoleKey: resolved.result.effectiveRoleKey,
        permissions: resolved.result.permissions,
        locked: resolved.result.locked,
      });
    }

    const roomAccessPayload = {
      roomId,
      roomName,
      livekitRoomName: roomName,
      role: resolved.result.effectiveRoleKey,
      permissions: resolved.result.permissions,
      identity,
    } as const;

    const roomAccessToken = jwt.sign(roomAccessPayload, getRoomAccessSecret(), {
      expiresIn: "12h",
    });

    // Optional audit trail for token issuance (do NOT store tokens).
    if (process.env.AUDIT_ROOM_TOKENS === "1") {
      firestore
        .collection("roomTokenAudit")
        .add({
          route: "/api/roomToken/guest",
          uid,
          roomId,
          roomName,
          identity,
          grantRole: resolved.result.grantRole,
          effectiveRoleKey: resolved.result.effectiveRoleKey,
          usedInvite: !!inviteClaims,
          ip: (req as any).ip || null,
          userAgent: (req.headers["user-agent"] as string) || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        .catch((err) => console.error("[roomToken/guest] audit write failed", err));
    }

    return res.status(200).json({
      token: lkJwt,
      serverUrl,
      identity,
      role: resolved.result.grantRole,
      isViewer: false,
      permissions: resolved.result.permissions,
      effectiveRoleKey: resolved.result.effectiveRoleKey,
      locked: resolved.result.locked,
      roomId,
      roomName,
      roomAccessToken,
    });
  } catch (err: any) {
    console.error("roomToken guest error:", err);
    return res.status(500).json({
      code: "internal_error",
      error: "Failed to create guest token",
      message: process.env.AUTH_DEBUG === "1" ? String(err?.message || err) : undefined,
    });
  } finally {
    await releaseCapacityLock(capacityLockRoomId || "", capacityLockOwner);
  }
});

export default router;
