import { Router } from "express";
import admin from "firebase-admin";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { requireRoomAccessToken, type RoomAccessClaims } from "../middleware/roomAccessToken";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { normalizeRoomLayout, resolveCompositeLayoutFromRoom } from "../lib/roomLayout";

const router = Router();

function isHost(role?: string): boolean {
  return String(role || "").toLowerCase() === "host";
}

// GET /api/rooms/:roomId/layout
// Auth: roomAccessToken (header/query). No Firebase auth required.
router.get("/:roomId/layout", requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: PERMISSION_ERRORS.ROOM_TOKEN_REQUIRED });
  if (access.roomId !== roomId) return res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });

  const snap = await db.collection("rooms").doc(roomId).get();
  const data = snap.exists ? ((snap.data() as any) || {}) : {};

  const roomLayout = normalizeRoomLayout(data.roomLayout) || null;
  const resolved = resolveCompositeLayoutFromRoom({ roomDoc: data });

  return res.json({
    ok: true,
    roomId,
    roomLayout,
    effectiveLayoutMode: resolved.mode,
    effectiveLayoutSource: resolved.source,
  });
});

// PATCH /api/rooms/:roomId/layout
// Auth: Firebase auth + roomAccessToken, host-only.
router.patch("/:roomId/layout", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
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
  const normalized = normalizeRoomLayout(body?.roomLayout ?? body);
  if (!normalized) {
    return res.status(400).json({
      error: "invalid_room_layout",
      allowedModes: ["grid", "speaker", "carousel", "pip"],
    });
  }

  const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
  await db
    .collection("rooms")
    .doc(roomId)
    .set({ roomLayout: normalized, updatedAt: serverTimestamp } as any, { merge: true });

  return res.json({ ok: true, roomId, roomLayout: normalized });
});

export default router;
