import { Router } from "express";
import admin from "firebase-admin";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { requireRoomAccessToken, type RoomAccessClaims } from "../middleware/roomAccessToken";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { normalizeStudioLayout } from "../lib/studioLayout";

const router = Router();

function isHostOrCohost(role?: string): boolean {
  const r = String(role || "").toLowerCase();
  return r === "host" || r === "cohost";
}

// ---------------------------------------------------------------------------
// GET /api/rooms/:roomId/studio-layout
// Auth: roomAccessToken (header/query). Any room member can read.
// ---------------------------------------------------------------------------
router.get("/:roomId/studio-layout", requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: PERMISSION_ERRORS.ROOM_TOKEN_REQUIRED });
  if (access.roomId !== roomId) return res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });

  try {
    const snap = await db.collection("rooms").doc(roomId).get();
    const data = snap.exists ? ((snap.data() as any) || {}) : {};

    const studioLayout = normalizeStudioLayout(data.studioLayout) || null;

    return res.json({ ok: true, roomId, studioLayout });
  } catch (err) {
    console.error("[roomsStudioLayout] GET error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/rooms/:roomId/studio-layout
// Auth: Firebase auth + roomAccessToken, host or cohost with canChangeLayoutScene.
// ---------------------------------------------------------------------------
router.patch("/:roomId/studio-layout", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: PERMISSION_ERRORS.ROOM_TOKEN_REQUIRED });
  if (access.roomId !== roomId) return res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
  if (!isHostOrCohost(access.role)) {
    return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
  }

  const uid = (req as any).user?.uid as string | undefined;
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  const body = (req.body || {}) as any;
  const normalized = normalizeStudioLayout(body?.studioLayout ?? body);
  if (!normalized) {
    return res.status(400).json({ error: "invalid_studio_layout" });
  }

  try {
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
    await db
      .collection("rooms")
      .doc(roomId)
      .set({ studioLayout: normalized, updatedAt: serverTimestamp } as any, { merge: true });

    return res.json({ ok: true, roomId, studioLayout: normalized });
  } catch (err) {
    console.error("[roomsStudioLayout] PATCH error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
