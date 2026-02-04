import { Router } from "express";
import jwt from "jsonwebtoken";
import { firestore } from "../firebaseAdmin";
import { requireAuth, tryGetAuthUser, verifyInviteToken } from "../middleware/requireAuth";
import { resolveRoomIdentity } from "../lib/roomIdentity";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

type InviteRole = "guest" | "cohost";

type InviteTokenClaims = {
  roomId: string;
  roomName: string;
  role: InviteRole;
  createdByUid?: string;
};

function getInviteSecret(): string {
  return process.env.INVITE_TOKEN_SECRET || process.env.JWT_SECRET || "dev-secret";
}

function requiresAuthForRole(role: InviteRole): boolean {
  return role === "cohost";
}

function normalizeRole(raw: unknown): InviteRole | null {
  const v = String(raw || "").toLowerCase();
  if (v === "guest" || v === "participant") return "guest";
  if (v === "cohost") return "cohost";
  // Legacy moderator invites are treated as co-host for capabilities,
  // but the UI no longer exposes a distinct moderator role.
  if (v === "moderator") return "cohost";
  return null;
}

function normalizeRoomName(raw: unknown): string | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  if (v.length > 200) return null;
  return v;
}

function normalizeRoomId(raw: unknown): string | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  if (v.length > 200) return null;
  return v;
}

const router = Router();

// NOTE: New invite model (Firestore roomInvites + HttpOnly sl_guest cookie)
// is implemented in routes/roomGuestAccess.ts at:
//   POST /api/invites/:inviteId/redeem
// Keeping this router for legacy JWT invite tokens.

/**
 * POST /api/invites/create
 * Body: { roomId, role }
 * Auth: required (host/streamer)
 * Returns: { inviteToken, url }
 */
router.post("/create", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as { uid: string } | undefined;
    if (!user?.uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const requestedRoomId = normalizeRoomId((req.body as any)?.roomId);
    const role = normalizeRole((req.body as any)?.role);

    if (!requestedRoomId) return res.status(400).json({ error: "roomId_required" });
    if (!role) return res.status(400).json({ error: "role_disabled" });

    // Enforce that caller owns the room or has canInvite for this room.
    let roomName: string = requestedRoomId;
    try {
      const ctx = await assertRoomPerm(req as any, requestedRoomId, "canInvite");
      const roomDoc = ctx.room as any;
      roomName = normalizeRoomName(roomDoc?.roomName || roomDoc?.name || ctx.roomId) || ctx.roomId;
    } catch (err: any) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ error: err.code });
      }
      throw err;
    }

    const roomId = requestedRoomId;

    const claims: InviteTokenClaims = {
      roomId,
      roomName,
      role,
      createdByUid: user.uid,
    };

    const expiresIn = "30d";
    const inviteToken = jwt.sign(claims, getInviteSecret(), { expiresIn });

    // New canonical format: /join?t=<inviteToken>
    // Room pages should prefer /room/<roomId>?t=<inviteToken> when navigating
    // internally after resolving the invite.
    return res.json({
      inviteToken,
      url: `/join?t=${encodeURIComponent(inviteToken)}`,
      legacyUrl: `/i/${encodeURIComponent(inviteToken)}`,
      role,
      roomId,
      roomName,
      requiresAuth: false,
    });
  } catch (err: any) {
    console.error("/api/invites/create error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /api/invites/resolve
 * Body: { inviteToken }
 * Auth: none
 * Returns: { roomName, role, requiresAuth }
 */
router.post("/resolve", async (req, res) => {
  try {
    const inviteToken = String((req.body as any)?.inviteToken || "").trim();
    if (!inviteToken) return res.status(400).json({ error: "inviteToken_required" });

    const claims = verifyInviteToken(inviteToken) as any;
    const roomId = normalizeRoomId(claims?.roomId);
    const roomName = normalizeRoomName(claims?.roomName || claims?.room);
    const role = normalizeRole(claims?.role || "guest") || "guest";

    if (!roomId && !roomName) return res.status(400).json({ error: "invite_room_missing" });

    const resolved = await resolveRoomIdentity({ roomId, roomName });
    if (!resolved) return res.status(400).json({ error: "invite_room_missing" });

    const requiresAuth = role === "cohost";

    return res.json({
      roomId: resolved.roomId,
      roomName: resolved.roomName,
      role,
      requiresAuth,
    });
  } catch (err: any) {
    console.error("/api/invites/resolve error", err?.message || err);
    return res.status(401).json({ error: "invalid_invite" });
  }
});

/**
 * POST /api/invites/accept
 * Body: { inviteToken }
 * Auth: required for cohost; guest does not require auth
 * Returns: { roomName, role, requiresAuth }
 */
router.post("/accept", async (req, res) => {
  try {
    const inviteToken = String((req.body as any)?.inviteToken || "").trim();
    if (!inviteToken) return res.status(400).json({ error: "inviteToken_required" });

    const claims = verifyInviteToken(inviteToken) as any;
    const roomId = normalizeRoomId(claims?.roomId);
    const roomName = normalizeRoomName(claims?.roomName || claims?.room);
    const role = normalizeRole(claims?.role || "guest") || "guest";

    if (!roomId && !roomName) return res.status(400).json({ error: "invite_room_missing" });

    const resolved = await resolveRoomIdentity({ roomId, roomName });
    if (!resolved) return res.status(400).json({ error: "invite_room_missing" });

    const user = tryGetAuthUser(req);

    if (user) {
      const docId = `${user.uid}_${Buffer.from(inviteToken).toString("base64url").slice(0, 40)}`;
      await firestore.collection("inviteAcceptances").doc(docId).set(
        {
          uid: user.uid,
          roomId: resolved.roomId,
          roomName: resolved.roomName,
          role,
          createdByUid: claims?.createdByUid || null,
          acceptedAt: new Date(),
        },
        { merge: true }
      );
    }

    const requiresAuth = role === "cohost";

    return res.json({
      roomId: resolved.roomId,
      roomName: resolved.roomName,
      role,
      requiresAuth,
    });
  } catch (err: any) {
    console.error("/api/invites/accept error", err?.message || err);
    return res.status(401).json({ error: "invalid_invite" });
  }
});

/**
 * Lightweight tracking so hosts can see when a guest has opened
 * the join page and when they've clicked "Enter Room".
 *
 * POST /api/invites/track-landing
 * Body: { inviteToken, stage: "join_page" | "entered_room" }
 */
router.post("/track-landing", async (req, res) => {
  try {
    const inviteToken = String((req.body as any)?.inviteToken || "").trim();
    const stageRaw = String((req.body as any)?.stage || "").trim();
    if (!inviteToken) return res.status(400).json({ error: "inviteToken_required" });

    const stage = stageRaw === "entered_room" ? "entered_room" : stageRaw === "join_page" ? "join_page" : null;
    if (!stage) return res.status(400).json({ error: "stage_invalid" });

    const claims = verifyInviteToken(inviteToken) as any;
    const roomId = normalizeRoomId(claims?.roomId);
    const roomName = normalizeRoomName(claims?.roomName || claims?.room);
    const role = normalizeRole(claims?.role || "guest") || "guest";

    if (!roomId && !roomName) return res.status(400).json({ error: "invite_room_missing" });

    const resolved = await resolveRoomIdentity({ roomId, roomName });
    if (!resolved) return res.status(400).json({ error: "invite_room_missing" });

    const inviteHash = Buffer.from(inviteToken).toString("base64url").slice(0, 40);
    const docId = `${resolved.roomId}_${inviteHash}`;

    await firestore.collection("inviteLandings").doc(docId).set(
      {
        roomId: resolved.roomId,
        roomName: resolved.roomName,
        role,
        stage,
        lastSeenAt: new Date(),
      },
      { merge: true },
    );

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("/api/invites/track-landing error", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /api/invites/room-status?roomId=...
 * Returns a coarse signal for hosts about recent invite activity.
 * Response: { roomId, hasJoinPageView, hasEnteredRoom }
 */
router.get("/room-status", async (req, res) => {
  try {
    const roomId = normalizeRoomId((req.query as any)?.roomId);
    if (!roomId) return res.status(400).json({ error: "roomId_required" });

    const snap = await firestore
      .collection("inviteLandings")
      .where("roomId", "==", roomId)
      .get();

    const cutoff = Date.now() - 15 * 60 * 1000; // last 15 minutes
    let hasJoinPageView = false;
    let hasEnteredRoom = false;

    snap.forEach((doc) => {
      const data = doc.data() as any;
      const ts = (data?.lastSeenAt as any)?.toMillis?.() ?? (data?.lastSeenAt instanceof Date ? data.lastSeenAt.getTime() : 0);
      if (!ts || ts < cutoff) return;
      if (data?.stage === "join_page") hasJoinPageView = true;
      if (data?.stage === "entered_room") hasEnteredRoom = true;
    });

    return res.json({ roomId, hasJoinPageView, hasEnteredRoom });
  } catch (err: any) {
    console.error("/api/invites/room-status error", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
