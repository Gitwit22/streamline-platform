import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { firestore as db } from "../firebaseAdmin";
import { ensureRoomDoc } from "../services/rooms";
import { sanitizeDisplayName } from "../lib/sanitizeDisplayName";

const router = Router();

/**
 * POST /api/rooms/create
 * Creates a new Firestore room document and returns its id.
 * Body: { livekitRoomName?: string, roomType?: "rtc" | "hls" }
 *
 * roomId is generated from Firestore (roomsRef.doc().id).
 */
router.post("/create", requireAuth as any, async (req: any, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  const roomType = (req.body?.roomType || "rtc") as "rtc" | "hls";
  const rawNameInput = String(req.body?.livekitRoomName || req.body?.roomName || "");
  const rawName = sanitizeDisplayName(rawNameInput).trim();

  // Optional: bind this room to an existing Saved Embed so HLS can
  // automatically keep viewer pages in sync. This is set from the Join
  // page when a host chooses "Join Saved Room".
  const savedEmbedIdRaw = req.body?.savedEmbedId;
  const savedEmbedId = typeof savedEmbedIdRaw === "string" ? savedEmbedIdRaw.trim() : "";

  // Generate a new Firestore document id for the room.
  const roomId = db.collection("rooms").doc().id;

  const livekitRoomName = rawName || roomId;

  try {
    const { data } = await ensureRoomDoc({
      roomId,
      ownerId: uid,
      livekitRoomName,
      roomType,
      initialStatus: "idle",
      savedEmbedId: savedEmbedId || undefined,
    });

    return res.status(201).json({
      roomId,
      livekitRoomName: data.livekitRoomName || livekitRoomName,
      roomType: data.roomType || roomType,
    });
  } catch (err) {
    console.error("/api/rooms/create ensureRoomDoc failed", err);
    return res.status(500).json({ error: "room_init_failed" });
  }
});

export default router;
