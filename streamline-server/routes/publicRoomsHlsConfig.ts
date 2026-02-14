import { Router } from "express";
import { getRoom, DEFAULT_ROOM_HLS_CONFIG, type RoomHlsConfig } from "../services/rooms";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = Router();

function normalizeRoomId(raw: string | undefined): string {
  return String(raw || "").trim();
}

// Public viewer-safe endpoint for persistent HLS viewer configuration.
// This exposes only roomId and hlsConfig (no owner, billing, or internal flags).
// GET /api/public/rooms/:roomId/hls-config -> { roomId, hlsConfig }
router.get("/:roomId/hls-config", async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: "invalid_room_id" });
  }
  // Reject obviously name-like ids if they contain spaces, en-dash, or '#',
  // mirroring other HLS routes.
  if (/[ \u2013#]/.test(roomId)) {
    return res.status(400).json({ error: "invalid_room_id" });
  }

  try {
    const { data: room } = await getRoom(roomId);
    const raw = (room as any).hlsConfig as RoomHlsConfig | undefined;
    const hlsConfig: RoomHlsConfig = raw && typeof raw === "object" ? raw : DEFAULT_ROOM_HLS_CONFIG;

    return res.json({
      roomId,
      hlsConfig,
    });
  } catch (e: any) {
    if (e?.message === PERMISSION_ERRORS.ROOM_NOT_FOUND) {
      return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    }
    console.error("GET /api/public/rooms/:roomId/hls-config error", e);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
