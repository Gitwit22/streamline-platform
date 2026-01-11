"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const requireAuth_1 = require("../middleware/requireAuth");
const firebaseAdmin_1 = require("../firebaseAdmin");
const account_1 = require("./account");
// Dynamic import for AccessToken constructor
async function getAccessTokenCtor() {
    const mod = await import("livekit-server-sdk");
    return mod.AccessToken;
}
async function getRoomServiceClient() {
    const mod = await import("livekit-server-sdk");
    return mod.RoomServiceClient;
}
function deriveServiceUrl() {
    const raw = process.env.LIVEKIT_URL || "";
    if (!raw)
        return null;
    // Convert wss://host to https://host for RoomServiceClient
    return raw.replace(/^wss?:\/\//i, (m) => (m.toLowerCase() === "ws://" ? "http://" : "https://"));
}
function roleToGrant(role) {
    const base = {
        roomJoin: true,
        canSubscribe: true,
    };
    if (role === "viewer") {
        return { ...base, canPublish: false, canPublishData: false, canUpdateMetadata: false, roomAdmin: false };
    }
    if (role === "moderator") {
        return { ...base, canPublish: true, canPublishData: true, canUpdateMetadata: true, roomAdmin: true };
    }
    // participant/host/cohost
    return { ...base, canPublish: true, canPublishData: true, canUpdateMetadata: false, roomAdmin: false };
}
async function getAdvancedPermissionsEnabled(uid) {
    const userSnap = await firebaseAdmin_1.firestore.collection("users").doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const planId = String(userData.planId || userData.plan || "free");
    const planSnap = await firebaseAdmin_1.firestore.collection("plans").doc(planId).get();
    const planFeatures = planSnap.exists ? (planSnap.data()?.features || {}) : {};
    const planFlag = !!planFeatures.advancedPermissions;
    const override = userData.advancedPermissionsOverride === true;
    const force = await firebaseAdmin_1.firestore.collection("featureFlags").doc("forceSimpleMode").get();
    const globalLock = force.exists ? !!force.data()?.enabled : false;
    return { enabled: !globalLock && (planFlag || override), planFlag, override, globalLock };
}
async function getPermissionsMode(uid) {
    if (!uid)
        return "simple";
    const snap = await firebaseAdmin_1.firestore.collection("users").doc(uid).get();
    const prefs = snap.data()?.mediaPrefs;
    const mode = prefs?.permissionsMode;
    const advanced = await getAdvancedPermissionsEnabled(uid);
    if (!advanced.enabled)
        return "simple";
    return mode === "advanced" ? "advanced" : "simple";
}
async function resolveRoleForInvite(opts) {
    const allowedSimpleRoles = ["participant", "moderator", "cohost", "host"];
    const requested = String(opts.requestedRole || "participant").toLowerCase();
    const mode = await getPermissionsMode(opts.uid);
    if (mode === "simple") {
        const isAllowed = allowedSimpleRoles.includes(requested);
        const effectiveRoleKey = isAllowed
            ? requested
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
            ? account_1.SIMPLE_ROLE_DEFAULTS.moderator
            : account_1.SIMPLE_ROLE_DEFAULTS[effectiveRoleKey];
        const grantRole = effectiveRoleKey === "moderator" || effectiveRoleKey === "host"
            ? "moderator"
            : effectiveRoleKey === "cohost"
                ? "participant"
                : effectiveRoleKey;
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
    const allowedRoles = ["host", "participant", "moderator", "viewer", "cohost"];
    const normalizedRole = (allowedRoles.includes(requested) ? requested : "participant");
    const wantsModerator = normalizedRole === "moderator";
    const grantRole = wantsModerator ? "moderator" : normalizedRole === "cohost" ? "participant" : normalizedRole;
    const effectiveRoleKey = normalizedRole === "cohost" ? "cohost" : normalizedRole;
    // Advanced mode currently does not hydrate custom profiles; keep existing grant mapping
    const permissions = { canStream: true, canRecord: true, canDestinations: true, canModerate: grantRole === "moderator", canLayout: true, canScreenShare: true, canInvite: true, canAnalytics: grantRole === "moderator" };
    return { ok: true, result: { grantRole, permissions, effectiveRoleKey, locked: false } };
}
async function getPlanLimit(uid, field) {
    const userSnap = await firebaseAdmin_1.firestore.collection("users").doc(uid).get();
    const planId = String((userSnap.data() || {}).planId || "free");
    const planSnap = await firebaseAdmin_1.firestore.collection("plans").doc(planId).get();
    if (!planSnap.exists)
        return undefined;
    const limits = (planSnap.data() || {}).limits || {};
    const raw = limits[field];
    if (raw === undefined || raw === null)
        return undefined;
    const num = Number(raw);
    return Number.isFinite(num) ? num : undefined;
}
function nowTs() {
    return FirebaseFirestore.Timestamp.now();
}
function addMinutes(ts, minutes) {
    const ms = ts.toMillis() + minutes * 60 * 1000;
    return FirebaseFirestore.Timestamp.fromMillis(ms);
}
async function getParticipantCount(roomName) {
    const serviceUrl = deriveServiceUrl();
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!serviceUrl || !apiKey || !apiSecret)
        return null;
    try {
        const RoomServiceClient = await getRoomServiceClient();
        const client = new RoomServiceClient(serviceUrl, apiKey, apiSecret);
        const participants = await client.listParticipants(roomName);
        return participants?.length ?? 0;
    }
    catch (err) {
        console.warn("[roomToken] participant count failed", err?.message || err);
        return null;
    }
}
const router = (0, express_1.Router)();
async function createViewerInvite(roomId, opts) {
    const docRef = firebaseAdmin_1.firestore.collection("viewerInvites").doc();
    const payload = {
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
async function validateViewerInvite(inviteToken, roomName, sessionId, passcode) {
    const doc = await firebaseAdmin_1.firestore.collection("viewerInvites").doc(inviteToken).get();
    if (!doc.exists)
        return { ok: false, reason: "not_found" };
    const data = doc.data();
    if (data.roomId !== roomName)
        return { ok: false, reason: "room_mismatch" };
    if (data.revokedAt)
        return { ok: false, reason: "revoked" };
    // Expiry checks
    if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
        return { ok: false, reason: "expired" };
    }
    // Grace-after-end: if we had room end timestamps we would enforce here; keeping placeholder for future.
    // Passcode check
    if (data.requirePasscode) {
        if (!passcode || passcode !== data.requirePasscode) {
            return { ok: false, reason: "passcode_required" };
        }
    }
    // Uses check (count unique sessions)
    const usedSessions = Array.isArray(data.usedSessions) ? data.usedSessions : [];
    const alreadyUsed = usedSessions.includes(sessionId);
    const maxUses = data.maxUses ?? null;
    if (!alreadyUsed && maxUses !== null && maxUses > 0 && usedSessions.length >= maxUses) {
        return { ok: false, reason: "max_used" };
    }
    // If new session, record it
    if (!alreadyUsed) {
        const nextSessions = usedSessions.concat(sessionId).slice(-1000);
        await doc.ref.update({
            usedSessions: nextSessions,
            usedCount: (data.usedCount || 0) + 1,
        });
    }
    return { ok: true, invite: data };
}
router.post("/", requireAuth_1.requireAuthOrInvite, async (req, res) => {
    try {
        const { roomName, identity, role: rawRole } = req.body;
        const uid = req.user?.uid;
        const invite = req.invite;
        if (!uid && !invite)
            return res.status(401).json({ error: "Unauthorized" });
        if (!roomName || !roomName.trim())
            return res.status(400).json({ error: "roomName is required" });
        if (invite) {
            const inviteRoom = invite.roomName || invite.room;
            if (!inviteRoom)
                return res.status(400).json({ error: "invite_token_missing_room" });
            if (inviteRoom !== roomName)
                return res.status(403).json({ error: "invite_room_mismatch" });
        }
        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;
        if (!apiKey || !apiSecret) {
            return res.status(500).json({ error: "LiveKit keys missing in env" });
        }
        const inviteIdentity = invite?.identity || invite?.uid || invite?.sub || null;
        const tokenIdentity = (identity && identity.trim()) || uid || inviteIdentity || `invite-${roomName}`; // prefer provided identity, fallback to auth/ invite
        const resolved = await resolveRoleForInvite({ uid, requestedRole: rawRole });
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
    }
    catch (err) {
        console.error("roomToken error:", err);
        return res.status(500).json({ error: "Failed to create room token" });
    }
});
// Public guest token: subscribe only (downgraded to viewer when over cap)
router.post("/guest", async (req, res) => {
    try {
        const { roomName, displayName, guestId, inviteToken } = req.body;
        if (!roomName || !roomName.trim())
            return res.status(400).json({ error: "roomName is required" });
        if (!displayName || !displayName.trim())
            return res.status(400).json({ error: "displayName is required" });
        if (inviteToken) {
            try {
                const claims = (0, requireAuth_1.verifyInviteToken)(inviteToken);
                const inviteRoom = claims.roomName || claims.room;
                if (inviteRoom && inviteRoom !== roomName) {
                    return res.status(403).json({ error: "invite_room_mismatch" });
                }
            }
            catch (err) {
                console.error("guest invite verify failed", err?.message || err);
                return res.status(401).json({ error: "invalid_invite" });
            }
        }
        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;
        if (!apiKey || !apiSecret) {
            return res.status(500).json({ error: "LiveKit keys missing in env" });
        }
        // Guest cap check (plan-aware via host, fallback to env)
        let inviteClaims;
        if (inviteToken) {
            try {
                inviteClaims = (0, requireAuth_1.verifyInviteToken)(inviteToken);
            }
            catch (err) {
                console.error("guest invite verify failed", err?.message || err);
                return res.status(401).json({ error: "invalid_invite" });
            }
        }
        const hostUid = inviteClaims?.uid || inviteClaims?.sub || req.body?.hostUid;
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
        const identity = (guestId && guestId.trim()) || crypto_1.default.randomUUID();
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
    }
    catch (err) {
        console.error("roomToken guest error:", err);
        return res.status(500).json({ error: "Failed to create guest token" });
    }
});
exports.default = router;
