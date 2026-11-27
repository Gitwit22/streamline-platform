import { Router } from "express";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { requireRoomAccessToken, type RoomAccessClaims } from "../middleware/roomAccessToken";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { actorMay } from "../lib/roomModerationPolicy";
import { isValidWaitingEntryId, isWaitingRoomEnabled } from "../lib/waitingRoomPure";
import { admitAllWaiting, decideWaitingEntry, listWaiting } from "../lib/waitingRoom";

/**
 * Host side of the waiting room (see lib/waitingRoomPure.ts). Mounted at
 * /api/rooms. Same authority as changing the room's policy: the room access
 * token for this room with canModerate (host, or a producer/cohost holding it).
 */
const router = Router();

function moderatorFor(req: any, res: any): RoomAccessClaims | null {
  const roomId = String(req.params.roomId || "").trim();
  const access = req.roomAccess as RoomAccessClaims | undefined;
  if (!roomId) {
    res.status(400).json({ error: "roomId_required" });
    return null;
  }
  if (!access || !access.roomId) {
    res.status(401).json({ error: PERMISSION_ERRORS.ROOM_TOKEN_REQUIRED });
    return null;
  }
  if (access.roomId !== roomId) {
    res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
    return null;
  }
  if (!actorMay(access, access.permissions, "canModerate")) {
    res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    return null;
  }
  return access;
}

// GET /api/rooms/:roomId/waiting-room -> { enabled, entries: [{ id, displayName, waitingSince }] }
router.get("/:roomId/waiting-room", requireRoomAccessToken as any, async (req: any, res) => {
  if (!moderatorFor(req, res)) return;
  const roomId = String(req.params.roomId).trim();
  try {
    const snap = await db.collection("rooms").doc(roomId).get();
    if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    const enabled = isWaitingRoomEnabled((snap.data() as any) || {});
    // Listed even when off, so people still queued when it was switched off
    // can be seen (they get in on their next poll anyway).
    const entries = await listWaiting(roomId);
    return res.json({ ok: true, enabled, entries });
  } catch (err: any) {
    console.error("[waitingRoom] list failed", { roomId, error: err?.message || err });
    return res.status(500).json({ error: "waiting_room_unavailable" });
  }
});

function decisionHandler(decision: "admitted" | "denied") {
  return async (req: any, res: any) => {
    const access = moderatorFor(req, res);
    if (!access) return;
    const roomId = String(req.params.roomId).trim();
    const entryId = req.params.entryId;
    if (!isValidWaitingEntryId(entryId)) return res.status(400).json({ error: "invalid_entry" });
    const uid = req.user?.uid as string | undefined;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    try {
      const found = await decideWaitingEntry(roomId, entryId, decision, uid);
      if (!found) return res.status(404).json({ error: "entry_not_found" });
      return res.json({ ok: true, id: entryId, status: decision });
    } catch (err: any) {
      console.error("[waitingRoom] decision failed", { roomId, decision, error: err?.message || err });
      return res.status(500).json({ error: "waiting_room_unavailable" });
    }
  };
}

router.post("/:roomId/waiting-room/:entryId/admit", requireAuth as any, requireRoomAccessToken as any, decisionHandler("admitted"));
router.post("/:roomId/waiting-room/:entryId/deny", requireAuth as any, requireRoomAccessToken as any, decisionHandler("denied"));

// POST /api/rooms/:roomId/waiting-room/admit-all -> { ok, admitted }
router.post("/:roomId/waiting-room/admit-all", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  if (!moderatorFor(req, res)) return;
  const roomId = String(req.params.roomId).trim();
  const uid = req.user?.uid as string | undefined;
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
  try {
    const admitted = await admitAllWaiting(roomId, uid);
    return res.json({ ok: true, admitted });
  } catch (err: any) {
    console.error("[waitingRoom] admit-all failed", { roomId, error: err?.message || err });
    return res.status(500).json({ error: "waiting_room_unavailable" });
  }
});

export default router;
