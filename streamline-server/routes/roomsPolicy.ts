import { Router } from "express";
import admin from "firebase-admin";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { requireRoomAccessToken, type RoomAccessClaims } from "../middleware/roomAccessToken";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = Router();

function isHost(role?: string): boolean {
  return String(role || "").toLowerCase() === "host";
}

// GET /api/rooms/:roomId/policy
// Auth: roomAccessToken (header/query). No Firebase auth required.
router.get("/:roomId/policy", requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: PERMISSION_ERRORS.ROOM_TOKEN_REQUIRED });
  if (access.roomId !== roomId) return res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });

  const snap = await db.collection("rooms").doc(roomId).get();
  if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

  const room = (snap.data() as any) || {};

  const visibilityRaw = typeof room.visibility === "string" ? room.visibility.trim().toLowerCase() : "";
  const visibility: "public" | "unlisted" | "private" =
    visibilityRaw === "public" || visibilityRaw === "unlisted" || visibilityRaw === "private"
      ? (visibilityRaw as any)
      : "unlisted";

  const requiresAuth = typeof room.requiresAuth === "boolean" ? !!room.requiresAuth : true;
  const requiresPayment = typeof room.requiresPayment === "boolean" ? !!room.requiresPayment : false;
  const allowGuests = typeof room.allowGuests === "boolean" ? !!room.allowGuests : null;

  return res.json({
    ok: true,
    roomId,
    visibility,
    requiresAuth,
    requiresPayment,
    allowGuests,
  });
});

// PATCH /api/rooms/:roomId/policy
// Auth: Firebase auth + roomAccessToken, host-only.
router.patch("/:roomId/policy", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: PERMISSION_ERRORS.ROOM_TOKEN_REQUIRED });
  if (access.roomId !== roomId) return res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
  if (!isHost(access.role)) {
    return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
  }

  const uid = (req as any).user?.uid as string | undefined;
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  const body = (req.body || {}) as any;
  const allowGuests = typeof body.allowGuests === "boolean" ? body.allowGuests : undefined;

  if (typeof allowGuests !== "boolean") {
    return res.status(400).json({ error: "invalid_policy_patch" });
  }

  const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
  await db
    .collection("rooms")
    .doc(roomId)
    .set({ allowGuests, updatedAt: serverTimestamp } as any, { merge: true });

  return res.json({ ok: true, roomId, allowGuests });
});

export default router;
