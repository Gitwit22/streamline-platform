/**
 * Authorized HLS playlist proxy.
 *
 *   GET /api/hls/play/:roomId/<path>.m3u8?token=<playback token>
 *
 * The token (lib/playbackToken.ts) is bound to the room and its current HLS
 * run, expires, and — when it was granted by a viewer entitlement — is
 * re-checked for revocation (refund/dispute) at most every 30s. Segments are
 * served straight from R2 via presigned URLs written into the playlist.
 */
import { Router } from "express";
import { firestore as db } from "../firebaseAdmin";
import { verifyPlaybackToken, getPlaybackSecret } from "../lib/playbackToken";
import { isSafePlaylistPath } from "../lib/hlsPlaylistRewrite";
import { buildAuthorizedPlaylist, hlsPrefixFor } from "../lib/hlsPlayback";
import { isEntitlementStillActive } from "../lib/viewerEntitlements";
import { SlidingWindowLimiter, clientIp, rateLimit } from "../lib/rateLimit";

const router = Router();

// Room HLS state is read on every playlist fetch (every segment duration per
// viewer); cache it briefly so N viewers cost ~1 read per window.
const ROOM_CACHE_MS = 3_000;
const roomHlsCache = new Map<string, { at: number; hls: any | null }>();

async function getRoomHls(roomId: string): Promise<any | null> {
  const hit = roomHlsCache.get(roomId);
  const now = Date.now();
  if (hit && now - hit.at < ROOM_CACHE_MS) return hit.hls;
  const snap = await db.collection("rooms").doc(roomId).get();
  const hls = snap.exists ? ((snap.data() as any)?.hls ?? null) : null;
  if (roomHlsCache.size > 2000) roomHlsCache.clear();
  roomHlsCache.set(roomId, { at: now, hls });
  return hls;
}

// A player refreshes a live playlist every ~segment (6s); allow headroom for
// seeks, retries and variant playlists. Many viewers may share an IP.
const playIpLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 3000 });

router.get(
  "/:roomId/*file",
  rateLimit([{ limiter: playIpLimiter, key: (req) => `ip:${clientIp(req)}` }]),
  async (req: any, res) => {
    res.setHeader("Cache-Control", "no-store");
    const roomId = String(req.params.roomId || "").trim();
    const fileParam = req.params.file;
    const file = Array.isArray(fileParam) ? fileParam.join("/") : String(fileParam || "");
    if (!roomId || /[ –#/]/.test(roomId) || !isSafePlaylistPath(file)) {
      return res.status(400).json({ error: "invalid_request" });
    }

    const secret = getPlaybackSecret();
    if (!secret) return res.status(503).json({ error: "playback_unconfigured" });

    // Cheap signature/expiry/room check before any I/O.
    const pre = verifyPlaybackToken(secret, req.query?.token, { roomId });
    if ("reason" in pre) return res.status(pre.reason === "expired" ? 401 : 403).json({ error: `token_${pre.reason}` });

    try {
      const hls = await getRoomHls(roomId);
      if (!hls || hls.status !== "live") return res.status(404).json({ error: "not_live" });

      const runCheck = verifyPlaybackToken(secret, req.query.token, { roomId, runId: hls.runId ?? null });
      if ("reason" in runCheck) return res.status(403).json({ error: `token_${runCheck.reason}` });

      if (runCheck.payload.e && !(await isEntitlementStillActive(runCheck.payload.e))) {
        return res.status(403).json({ error: "entitlement_revoked" });
      }

      const body = await buildAuthorizedPlaylist({
        roomId,
        prefix: hlsPrefixFor(roomId, hls),
        file,
        token: String(req.query.token),
      });
      if (body === null) return res.status(404).json({ error: "playlist_not_ready" });

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      return res.status(200).send(body);
    } catch (err: any) {
      console.error("[hls-play] playlist error", { roomId, file, error: err?.message || err });
      return res.status(502).json({ error: "playlist_unavailable" });
    }
  }
);

export default router;
