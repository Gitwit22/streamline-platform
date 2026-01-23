import { Router } from "express";
import { getRoom } from "../services/rooms";
import { getLiveKitSdk } from "../lib/livekit";

const router = Router();

function deriveServiceUrl(): string | null {
  const raw = process.env.LIVEKIT_URL || "";
  if (!raw) return null;
  // Convert wss://host to https://host for RoomServiceClient
  return raw.replace(/^wss?:\/\//i, (m) => (m.toLowerCase() === "ws://" ? "http://" : "https://"));
}

async function getParticipantCount(livekitRoomName: string | undefined | null): Promise<number | null> {
  const roomName = String(livekitRoomName || "").trim();
  if (!roomName) return null;

  const serviceUrl = deriveServiceUrl();
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!serviceUrl || !apiKey || !apiSecret) return null;

  try {
    const { RoomServiceClient } = await getLiveKitSdk();
    const client = new RoomServiceClient(serviceUrl, apiKey, apiSecret);
    const participants = await client.listParticipants(roomName);
    return participants?.length ?? 0;
  } catch (err) {
    const anyErr = err as any;
    const message: string = typeof anyErr?.message === "string" ? anyErr.message : String(anyErr ?? "");
    const statusCode = (typeof anyErr?.status === "number" && anyErr.status) || (typeof anyErr?.code === "number" && anyErr.code) || undefined;

    // LiveKit returns 404 when a room does not exist yet or has already ended.
    // Treat that as "no viewers" without spamming logs.
    if (statusCode === 404 || message.includes("404")) {
      return null;
    }

    console.warn("[publicHls] participant count failed", message || anyErr);
    return null;
  }
}

// Public viewer-safe endpoint: no auth, tiny payload.
// GET /api/public/hls/:roomId -> { status, playlistUrl, viewerCount? }
router.get("/:roomId", async (req: any, res) => {
  const roomId = req.params.roomId;
  try {
    const { data: room } = await getRoom(roomId);
    const hls = room.hls || {};

    const isLive = hls.status === "live" && !!(hls.playlistUrl && String(hls.playlistUrl).trim());

    let viewerCount: number | null = null;
    if (isLive) {
      try {
        // Use the LiveKit room name when available; fall back to roomId.
        viewerCount = await getParticipantCount((room as any).livekitRoomName || roomId);
      } catch {
        viewerCount = null;
      }
    }

    return res.json({
      status: isLive ? "live" : "idle",
      playlistUrl: isLive ? hls.playlistUrl : null,
      viewerCount: viewerCount ?? undefined,
    });
  } catch (e: any) {
    if (e?.message === "room_not_found") {
      return res.status(404).json({ error: "room_not_found" });
    }
    console.error("Public HLS status error", e);
    return res.status(500).json({ error: "Failed to fetch HLS status" });
  }
});

export default router;
