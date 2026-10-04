import { Router } from "express";
import { getRoom } from "../services/rooms";
import { getCurrentViewers } from "../lib/viewerStats";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { roomHasActivePaidEvent } from "../lib/monetization";

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

    // Paywalled rooms: never expose the playlist publicly. Viewers get it from
    // POST /api/monetization/enter once their device has a claimed code.
    // Fail closed if the lookup errors.
    let paywalled = false;
    if (isLive) {
      try {
        paywalled = await roomHasActivePaidEvent(roomId);
      } catch (err: any) {
        console.warn("[publicHls] paywall lookup failed", err?.message || err);
        paywalled = true;
      }
    }

    return res.json({
      status: isLive ? "live" : "idle",
      playlistUrl: isLive && !paywalled ? hls.playlistUrl : null,
      paywalled: paywalled || undefined,
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
