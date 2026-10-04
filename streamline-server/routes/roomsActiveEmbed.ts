import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";

const router = Router();

function normalizeId(raw: string | undefined): string {
  return String(raw || "").trim();
}

// GET /api/rooms/:roomId/active-embed -> { roomId, activeEmbedId, activeEmbedRoomId, savedEmbedId }
router.get("/:roomId/active-embed", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: "invalid_room_id" });
  }

  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canStream");

    return res.json({
      roomId: ctx.roomId,
      activeEmbedId: typeof (ctx.room as any).activeEmbedId === "string" ? (ctx.room as any).activeEmbedId : null,
      activeEmbedRoomId:
        typeof (ctx.room as any).activeEmbedRoomId === "string" ? (ctx.room as any).activeEmbedRoomId : null,
      savedEmbedId: typeof (ctx.room as any).savedEmbedId === "string" ? (ctx.room as any).savedEmbedId : null,
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    console.error("GET /api/rooms/:roomId/active-embed error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
