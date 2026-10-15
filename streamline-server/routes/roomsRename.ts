import { Router } from "express";
import admin from "firebase-admin";
import { requireAuth } from "../middleware/requireAuth";
import { firestore as db } from "../firebaseAdmin";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import { parseDisplayNameInput, roomDisplayName } from "../lib/roomDisplayPure";

/**
 * PUT /api/rooms/:roomId/display-name { displayName: string | null }
 * Renames a room for display only (rooms/{id}.displayName). Owner or
 * platform admin only. Identity fields (roomName, livekitRoomName) are never
 * touched, so live sessions, invites and tokens keep working.
 */
const router = Router();

router.put("/:roomId/display-name", requireAuth as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });
  const parsed = parseDisplayNameInput(req.body?.displayName);
  if (!parsed.ok) return res.status(400).json({ error: "invalid_input", field: "displayName", details: parsed.details });
  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      return res.status(403).json({ error: "rename_owner_only" });
    }
    const value = parsed.value ? parsed.value : admin.firestore.FieldValue.delete();
    await db.collection("rooms").doc(ctx.roomId).set({ displayName: value }, { merge: true });
    const next = { ...(ctx.room as any), displayName: parsed.value || undefined };
    return res.json({ roomId: ctx.roomId, displayName: roomDisplayName(next, ctx.roomId), custom: !!parsed.value });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) return res.status(err.status).json({ error: err.code });
    console.error("PUT /api/rooms/:roomId/display-name error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
