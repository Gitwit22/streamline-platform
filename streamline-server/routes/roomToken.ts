
import { Router } from "express";
import crypto from "crypto";
import { InviteClaims, requireAuthOrInvite, verifyInviteToken } from "../middleware/requireAuth";
import { firestore } from "../firebaseAdmin";
import { isAdmin } from "../middleware/adminAuth";
import { SIMPLE_ROLE_DEFAULTS } from "./account";

// Dynamic import for AccessToken constructor
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

type GrantRole = "viewer" | "participant" | "host" | "moderator" | "cohost";

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
  const base = {
    roomJoin: true,
    canSubscribe: true,
  } as any;

  if (role === "viewer") {
    return { ...base, canPublish: false, canPublishData: false, canUpdateMetadata: false, roomAdmin: false };
  }

  if (role === "moderator") {
    return { ...base, canPublish: true, canPublishData: true, canUpdateMetadata: true, roomAdmin: true };
  }

  // participant/host/cohost
  return { ...base, canPublish: true, canPublishData: true, canUpdateMetadata: false, roomAdmin: false };
}

async function getAdvancedPermissionsEnabled(uid: string) {
  const userSnap = await firestore.collection("users").doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const planId = String((userData as any).planId || (userData as any).plan || "free");
  const planSnap = await firestore.collection("plans").doc(planId).get();
  const planFeatures = planSnap.exists ? ((planSnap.data() as any)?.features || {}) : {};
  const planFlag = !!planFeatures.advancedPermissions;
  const override = (userData as any).advancedPermissionsOverride === true;
  const force = await firestore.collection("featureFlags").doc("forceSimpleMode").get();
  const globalLock = force.exists ? !!(force.data() as any)?.enabled : false;
  return { enabled: !globalLock && (planFlag || override), planFlag, override, globalLock };
}

async function getPermissionsMode(uid?: string): Promise<"simple" | "advanced"> {
  if (!uid) return "simple";
  const snap = await firestore.collection("users").doc(uid).get();
  const prefs = (snap.data() as any)?.mediaPrefs;
  const mode = prefs?.permissionsMode;
  const advanced = await getAdvancedPermissionsEnabled(uid);
  if (!advanced.enabled) return "simple";
  return mode === "advanced" ? "advanced" : "simple";
}

type ResolvedRole = {
  grantRole: GrantRole;
  permissions: Record<string, boolean>;
  effectiveRoleKey: "viewer" | "participant" | "cohost" | "moderator" | "host";
  locked: boolean;
};

async function resolveRoleForInvite(opts: { uid?: string; requestedRole?: string }): Promise<{ ok: true; result: ResolvedRole } | { ok: false; error: any }> {
  const allowedSimpleRoles: Array<ResolvedRole["effectiveRoleKey"]> = ["participant", "moderator", "cohost", "host"];
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

    const perms = effectiveRoleKey === "host" || effectiveRoleKey === "moderator"
      ? SIMPLE_ROLE_DEFAULTS.moderator
      : SIMPLE_ROLE_DEFAULTS[effectiveRoleKey];

    const grantRole: GrantRole = effectiveRoleKey === "moderator" || effectiveRoleKey === "host"
      ? "moderator"
      : effectiveRoleKey === "cohost"
        ? "participant"
        : (effectiveRoleKey as GrantRole);

    return {
      ok: true,
      result: {
        grantRole,
        permissions: perms,
        effectiveRoleKey,
        locked: true,
      },
    };
  }

  // advanced: preserve existing behavior
  const allowedRoles: GrantRole[] = ["host", "participant", "moderator", "viewer", "cohost"];
  const normalizedRole = (allowedRoles.includes(requested as GrantRole) ? (requested as GrantRole) : "participant") as GrantRole;
  const wantsModerator = normalizedRole === "moderator";
  const grantRole: GrantRole = wantsModerator ? "moderator" : normalizedRole === "cohost" ? "participant" : normalizedRole;
  const effectiveRoleKey: ResolvedRole["effectiveRoleKey"] = normalizedRole === "cohost" ? "cohost" : (normalizedRole as any);
  // Advanced mode currently does not hydrate custom profiles; keep existing grant mapping
  const permissions = { canStream: true, canRecord: true, canDestinations: true, canModerate: grantRole === "moderator", canLayout: true, canScreenShare: true, canInvite: true, canAnalytics: grantRole === "moderator" };
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

async function validateViewerInvite(inviteToken: string, roomName: string, sessionId: string, passcode?: string) {
  const doc = await firestore.collection("viewerInvites").doc(inviteToken).get();
  if (!doc.exists) return { ok: false, reason: "not_found" } as const;
  const data = doc.data() as ViewerInvite;
  if (data.roomId !== roomName) return { ok: false, reason: "room_mismatch" } as const;
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
    const { roomName, identity, role: rawRole } = req.body as { roomName?: string; identity?: string; inviteToken?: string; role?: string };
    const uid = (req as any).user?.uid as string | undefined;
    const invite = (req as any).invite as InviteClaims | undefined;

    if (!uid && !invite) return res.status(401).json({ error: "Unauthorized" });
    if (!roomName || !roomName.trim()) return res.status(400).json({ error: "roomName is required" });

    if (invite) {
      const inviteRoom = invite.roomName || invite.room;
      if (!inviteRoom) return res.status(400).json({ error: "invite_token_missing_room" });
      if (inviteRoom !== roomName) return res.status(403).json({ error: "invite_room_mismatch" });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      return res.status(500).json({ error: "LiveKit keys missing in env" });
    }

    const inviteIdentity = invite?.identity || invite?.uid || invite?.sub || null;
    const tokenIdentity = (identity && identity.trim()) || uid || inviteIdentity || `invite-${roomName}`; // prefer provided identity, fallback to auth/ invite

    // Safety: moderator tokens are admin-only.
    // If a non-admin requests moderator (e.g. via invite link role param), downgrade to participant.
    let requestedRole = rawRole;
    if (uid && String(rawRole || "").toLowerCase() === "moderator") {
      const ok = await isAdmin(uid);
      if (!ok) requestedRole = "participant";
    }

    const resolved = await resolveRoleForInvite({ uid, requestedRole });
    if (resolved.ok === false) {
      const payload = resolved.error;
      return res.status(400).json(payload);
    }
    const { grantRole, permissions, effectiveRoleKey, locked } = resolved.result;
    const isViewer = grantRole === "viewer";

    const AccessToken = await getAccessTokenCtor();
    const at = new AccessToken(apiKey, apiSecret, { identity: tokenIdentity });
    at.addGrant({
      room: roomName,
      ...roleToGrant(grantRole),
    });
    const jwt = await at.toJwt();
    console.log("✅ roomToken jwt typeof:", typeof jwt, "len:", jwt.length);
    const serverUrl = process.env.LIVEKIT_URL || null;
    return res.status(200).json({ token: jwt, serverUrl, role: grantRole, isViewer, permissions, effectiveRoleKey, locked });
  } catch (err: any) {
    console.error("roomToken error:", err);
    return res.status(500).json({ error: "Failed to create room token" });
  }
});

// Public guest token: subscribe only (downgraded to viewer when over cap)
router.post("/guest", async (req, res) => {
  try {
    const { roomName, displayName, guestId, inviteToken } = req.body as {
      roomName?: string;
      displayName?: string;
      guestId?: string;
      inviteToken?: string;
    };

    if (!roomName || !roomName.trim()) return res.status(400).json({ error: "roomName is required" });
    if (!displayName || !displayName.trim()) return res.status(400).json({ error: "displayName is required" });

    if (inviteToken) {
      try {
        const claims = verifyInviteToken(inviteToken);
        const inviteRoom = claims.roomName || claims.room;
        if (inviteRoom && inviteRoom !== roomName) {
          return res.status(403).json({ error: "invite_room_mismatch" });
        }
      } catch (err) {
        console.error("guest invite verify failed", (err as any)?.message || err);
        return res.status(401).json({ error: "invalid_invite" });
      }
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      return res.status(500).json({ error: "LiveKit keys missing in env" });
    }

    // Guest cap check (plan-aware via host, fallback to env)
    let inviteClaims: InviteClaims | undefined;
    if (inviteToken) {
      try {
        inviteClaims = verifyInviteToken(inviteToken);
      } catch (err) {
        console.error("guest invite verify failed", (err as any)?.message || err);
        return res.status(401).json({ error: "invalid_invite" });
      }
    }

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
    const at = new AccessToken(apiKey, apiSecret, { identity });
    at.addGrant({
      room: roomName,
      ...roleToGrant(resolved.result.grantRole),
    });
    const jwt = await at.toJwt();
    const serverUrl = process.env.LIVEKIT_URL || null;
    return res.status(200).json({ token: jwt, serverUrl, identity, role: resolved.result.grantRole, isViewer: false, permissions: resolved.result.permissions, effectiveRoleKey: resolved.result.effectiveRoleKey, locked: resolved.result.locked });
  } catch (err: any) {
    console.error("roomToken guest error:", err);
    return res.status(500).json({ error: "Failed to create guest token" });
  }
});

export default router;
