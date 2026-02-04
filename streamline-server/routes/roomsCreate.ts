import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { firestore as db } from "../firebaseAdmin";
import { ensureRoomDoc } from "../services/rooms";
import { sanitizeDisplayName } from "../lib/sanitizeDisplayName";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { normalizeRoomLayout, type RoomLayout } from "../lib/roomLayout";

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
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  const roomType = (req.body?.roomType || "rtc") as "rtc" | "hls";

  // Optional room access policy (secure defaults are applied in ensureRoomDoc).
  const visibilityRaw = String(req.body?.visibility || "").trim().toLowerCase();
  const visibility = (visibilityRaw === "public" || visibilityRaw === "unlisted" || visibilityRaw === "private")
    ? (visibilityRaw as "public" | "unlisted" | "private")
    : undefined;
  const requiresAuth = typeof req.body?.requiresAuth === "boolean" ? req.body.requiresAuth : undefined;
  const requiresPayment = typeof req.body?.requiresPayment === "boolean" ? req.body.requiresPayment : undefined;
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

  // Seed roomLayout from account defaults (users/{uid}.mediaPrefs.defaultRoomLayout)
  // so new rooms inherit the user's preferred layout without requiring per-room setup.
  let initialRoomLayout: RoomLayout | undefined = undefined;
  try {
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.exists ? (userSnap.data() as any) || {} : {};
    const mediaPrefs = (userData as any)?.mediaPrefs || {};
    initialRoomLayout =
      normalizeRoomLayout(mediaPrefs.defaultRoomLayout) ||
      normalizeRoomLayout({ mode: mediaPrefs.defaultLayout }) ||
      undefined;
  } catch (err) {
    console.warn("/api/rooms/create failed to read mediaPrefs for initialRoomLayout", err);
  }

  try {
    const { data } = await ensureRoomDoc({
      roomId,
      ownerId: uid,
      livekitRoomName,
      roomType,
      initialStatus: "idle",
      initialRoomLayout,
      savedEmbedId: savedEmbedId || undefined,
      visibility,
      requiresAuth,
      requiresPayment,
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
