import { Router } from "express";
import admin from "firebase-admin";
import { requireAuth } from "../middleware/requireAuth";
import { firestore } from "../firebaseAdmin";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

type RoomInviteDoc = {
  roomId: string;
  mode: "guest";
  role: "guest"; // RTC guest with mic+cam (invite-based join)
  expiresAt: FirebaseFirestore.Timestamp | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: FirebaseFirestore.Timestamp | null;
  createdAt: FirebaseFirestore.FieldValue;
  createdByUid: string;
};

const router = Router();

/**
 * POST /api/rooms/:roomId/invites
 * Auth: required (host/cohost)
 * Returns: { inviteId, url }
 */
router.post("/:roomId/invites", requireAuth as any, async (req: any, res) => {
  try {
    const uid = req.user?.uid as string | undefined;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const roomId = String(req.params.roomId || "").trim();
    if (!roomId) return res.status(400).json({ error: "roomId_required" });

    const roomSnap = await firestore.collection("rooms").doc(roomId).get();
    if (!roomSnap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

    const room = (roomSnap.data() as any) || {};
    const ownerId = typeof room.ownerId === "string" ? room.ownerId.trim() : "";
    if (!ownerId) return res.status(409).json({ error: "room_owner_missing" });

    // Minimal: only the room owner can create guest invites.
    // (Cohost invite creation can be added later via canInvite permission.)
    if (uid !== ownerId) return res.status(403).json({ error: "not_allowed" });

    const expiresAtRaw = (req.body as any)?.expiresAt;
    const maxUsesRaw = (req.body as any)?.maxUses;

    const expiresAt =
      typeof expiresAtRaw === "string" && expiresAtRaw
        ? admin.firestore.Timestamp.fromMillis(Date.parse(expiresAtRaw))
        : null;

    const maxUses = maxUsesRaw === null || maxUsesRaw === undefined
      ? null
      : Number.isFinite(Number(maxUsesRaw)) && Number(maxUsesRaw) > 0
        ? Number(maxUsesRaw)
        : null;

    const ref = firestore.collection("roomInvites").doc();
    const doc: RoomInviteDoc = {
      roomId,
      mode: "guest",
      role: "guest", // RTC guest with mic+cam (invite-based join)
      expiresAt: expiresAt && Number.isFinite(expiresAt.toMillis()) ? expiresAt : null,
      maxUses,
      useCount: 0,
      revokedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdByUid: uid,
    };

    await ref.set(doc as any, { merge: false });

    return res.status(201).json({
      inviteId: ref.id,
      url: `/invite/${encodeURIComponent(ref.id)}`,
    });
  } catch (err) {
    console.error("/api/rooms/:roomId/invites error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
