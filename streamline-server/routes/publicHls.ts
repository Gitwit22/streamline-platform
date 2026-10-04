import { Router } from "express";
import { getRoom } from "../services/rooms";
import { getCurrentViewers } from "../lib/viewerStats";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { resolveRoomViewerAccess } from "../lib/viewerAccessStore";
import { hlsProxyAll } from "../lib/hlsPlayback";

const router = Router();

// Public viewer-safe endpoint: no auth, tiny payload.
// GET /api/public/hls/:roomId -> { status, playlistUrl, viewerCount? }
// viewerCount = current viewers (HLS heartbeats + RTC audience).
router.get("/:roomId", async (req: any, res) => {
  const roomId = req.params.roomId;
  try {
    const { data: room } = await getRoom(roomId);
    const hls = room.hls || {};

    const isLive = hls.status === "live" && !!(hls.playlistUrl && String(hls.playlistUrl).trim());

    let viewerCount: number | null = null;
    if (isLive) {
      try {
        // Current viewers = HLS viewers heartbeating + RTC audience (not the
        // raw LiveKit participant count, which includes hosts and egress).
        viewerCount = (await getCurrentViewers(roomId, { room })).total;
      } catch {
        viewerCount = null;
      }
    }

    // Non-public channels (registered / subscriber / pay-per-view / private):
    // never expose the playlist publicly. Authorized viewers get a signed
    // playback URL from POST /api/public/{channels|rooms}/:id/playback.
    // The mode is reported even while offline so viewer pages can show the
    // paywall / sign-in prompt ahead of the stream. Fail closed on errors.
    let accessMode: string = "public";
    try {
      accessMode = (await resolveRoomViewerAccess(roomId, { room })).access.mode;
    } catch (err: any) {
      console.warn("[publicHls] access lookup failed", err?.message || err);
      accessMode = "private";
    }
    const paywalled = accessMode !== "public" || (isLive && hlsProxyAll());

    return res.json({
      status: isLive ? "live" : "idle",
      playlistUrl: isLive && !paywalled ? hls.playlistUrl : null,
      paywalled: paywalled || undefined,
      accessMode,
      viewerCount: viewerCount ?? undefined,
    });
  } catch (e: any) {
    if (e?.message === PERMISSION_ERRORS.ROOM_NOT_FOUND) {
      return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    }
    console.error("Public HLS status error", e);
    return res.status(500).json({ error: "Failed to fetch HLS status" });
  }
});

export default router;
