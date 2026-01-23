
import { Router } from "express";
import crypto from "crypto";
import { InviteClaims, requireAuthOrInvite, verifyInviteToken } from "../middleware/requireAuth";
import { firestore } from "../firebaseAdmin";
import admin from "firebase-admin";
import { ensureRoomDoc } from "../services/rooms";
import { isAdmin } from "../middleware/adminAuth";
import { SIMPLE_ROLE_DEFAULTS } from "./account";
import { intersectPermissionsWithEntitlements } from "../lib/rolePermissions";
import { resolveRoomIdentity } from "../lib/roomIdentity";
import { sanitizeDisplayName } from "../lib/sanitizeDisplayName";
import { roleToParticipantPermission } from "../lib/livekitPermissions";
import { TrackSource } from "livekit-server-sdk";
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

function deriveServiceUrl(): string | null {
  const raw = process.env.LIVEKIT_URL || "";
  if (!raw) return null;
  // Convert wss://host to https://host for RoomServiceClient
  return raw.replace(/^wss?:\/\//i, (m) => (m.toLowerCase() === "ws://" ? "http://" : "https://"));
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

  let canPublishSources: TrackSource[] = [];
  if (permissionRole === "viewer") {
    canPublishSources = [];
  } else if (permissionRole === "cohost") {
    canPublishSources = [
      TrackSource.MICROPHONE,
      TrackSource.CAMERA,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ];
  } else {
    // participant + moderator
    canPublishSources = [TrackSource.MICROPHONE, TrackSource.CAMERA];
  }

  const base = {
    roomJoin: true,
    canSubscribe: participantPerm.canSubscribe,
    canPublish: participantPerm.canPublish,
    canPublishData: participantPerm.canPublishData,
    canPublishSources,
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
  const raw = process.env.ROOM_ACCESS_TOKEN_SECRET || process.env.JWT_SECRET || "";
  if ((env === "production" || env === "staging") && (!process.env.ROOM_ACCESS_TOKEN_SECRET || raw === "dev-secret")) {
    throw new Error("ROOM_ACCESS_TOKEN_SECRET must be set (no dev-secret in production)");
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
  if (data.roomId !== roomId) return { ok: false, reason: "room_mismatch" } as const;
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

    if (!uid && !invite) return res.status(401).json({ error: "Unauthorized" });

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

    if (!resolvedRoom) return res.status(400).json({ error: "roomId_or_roomName_required" });
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

    const normalizedRequested = String(requestedRole || "participant").toLowerCase();
    const elevatedRequested = normalizedRequested === "cohost" || normalizedRequested === "moderator";

    // If an elevated role is requested but the caller is not authenticated,
    // reject even if an invite token is present.
    if (elevatedRequested && !uid) {
      return res.status(401).json({ error: "auth_required_for_elevated_role" });
    }

    // Safety: moderator tokens are admin-only unless an invite explicitly
    // authorizes it. If an authenticated user requests moderator without any
    // invite, require admin and otherwise downgrade.
    if (uid && !invite && normalizedRequested === "moderator") {
      const ok = await isAdmin(uid);
      if (!ok) requestedRole = "participant";
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      return res.status(500).json({ error: "LiveKit keys missing in env" });
    }

    const inviteIdentity = invite?.identity || invite?.uid || invite?.sub || null;
    const tokenIdentity = uid || inviteIdentity || `invite-${roomId}`;

    // Determine which account's entitlements and permission mode should apply.
    // We always scope entitlements to the room owner, never the caller.
    let entitlementsUid: string | null = null;
    let roomSnapExists: boolean | null = null;
    try {
      const roomRef = firestore.collection("rooms").doc(roomId);
      const roomSnap = await roomRef.get();
      roomSnapExists = roomSnap.exists;
      const roomData = (roomSnap.exists ? roomSnap.data() : null) as any;
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
        const [entitlements, hlsUi, recordingUi] = await Promise.all([
          getEffectiveEntitlements(entitlementsUid),
          getHlsUiFlag(),
          getRecordingUiFlag(),
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

    const AccessToken = await getAccessTokenCtor();
    const at = new AccessToken(apiKey, apiSecret, { identity: tokenIdentity, name: displayName });
    at.addGrant({
      room: livekitRoomName,
      ...roleToGrant(grantRole),
    });
    const lkJwt = await at.toJwt();
    console.log("✅ roomToken jwt typeof:", typeof lkJwt, "len:", lkJwt.length);

    const serverUrl = process.env.LIVEKIT_URL || null;

    const roomAccessPayload = {
      roomId,
      // Optional human/display label for the room; safe for UI.
      roomName,
      // Required canonical LiveKit room key for all LK APIs.
      livekitRoomName,
      role: effectiveRoleKey,
      permissions,
      identity: tokenIdentity,
    } as const;

    const roomAccessToken = jwt.sign(roomAccessPayload, getRoomAccessSecret(), {
      expiresIn: "12h",
    });

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
      effectiveEntitlements: effectiveEntitlementsPayload,
      platformFlags,
    });
  } catch (err: any) {
    console.error("roomToken error:", err);
    return res.status(500).json({ error: "Failed to create room token" });
  }
});

// Public guest token: subscribe only (downgraded to viewer when over cap)
router.post("/guest", async (req, res) => {
  try {
    const { roomName: rawRoomName, roomId: rawRoomId, displayName, guestId, inviteToken } = req.body as {
      roomName?: string;
      roomId?: string;
      displayName?: string;
      guestId?: string;
      inviteToken?: string;
    };

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
      return res.status(500).json({ error: "LiveKit keys missing in env" });
    }

    // Guest cap check (plan-aware via host, fallback to env)
    const hostUid = (inviteClaims as any)?.uid || (inviteClaims as any)?.sub || (req.body as any)?.hostUid;
    const maxGuestsPlan = hostUid ? await getPlanLimit(hostUid, "maxGuests") : undefined;
    const maxGuestsEnv = Number(process.env.MAX_GUESTS_PER_ROOM || "0");
    const envCap = Number.isFinite(maxGuestsEnv) && maxGuestsEnv > 0 ? maxGuestsEnv : undefined;
    const maxGuests = maxGuestsPlan !== undefined ? maxGuestsPlan : envCap;
    let overCap = false;
    if (maxGuests !== undefined) {
      const participantCount = await getParticipantCount(roomName);
      if (participantCount !== null && participantCount >= maxGuests) {
        overCap = true;
      }
    }

    if (overCap) {
      return res.status(429).json({ error: "room_full" });
    }

    const identity = (guestId && guestId.trim()) || crypto.randomUUID();
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
    const serverUrl = process.env.LIVEKIT_URL || null;
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
    return res.status(500).json({ error: "Failed to create guest token" });
  }
});

export default router;
