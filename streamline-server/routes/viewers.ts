/**
 * Viewer counts.
 *
 * Public (no auth):
 *   POST /api/public/viewers/heartbeat { roomId, viewerId, kind: "hls", leave? }
 *     -> { ok, currentViewers, totalViewers }
 *   HLS players ping every ~20s while playing; `leave: true` (sent with
 *   navigator.sendBeacon as text/plain JSON) drops the viewer from "current".
 *
 * Host/cohost:
 *   GET /api/rooms/:roomId/viewers
 *     -> { sessionId, startedAt, live, current: { total, hls, rtcAudience, onStage },
 *          totalUnique: { total, hls, rtc }, peak }
 *   GET /api/rooms/:roomId/stream-summary?sessionId=
 *     -> post-stream summary (see the route below)
 */
import express, { Router } from "express";
import { firestore } from "../firebaseAdmin";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { SlidingWindowLimiter, clientIp, rateLimit } from "../lib/rateLimit";
import {
  getCurrentViewers,
  ensureLiveSession,
  markHlsViewerLeft,
  recordHlsHeartbeat,
  updatePeak,
} from "../lib/viewerStats";
import {
  isSessionActive,
  isValidViewerId,
  isValidViewerRoomId,
  parseHeartbeatBody,
  readViewerStats,
} from "../lib/viewerStatsPure";
import { checkRoomHostAccess } from "./invites";
import { getStreamSummary } from "../lib/streamSummary";

// ---------------------------------------------------------------------------
// Public heartbeat
// ---------------------------------------------------------------------------

export const publicViewersRouter = Router();

// A viewer pings every 20s (3/min); allow bursts from reloads/tab switches.
const heartbeatViewerLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 12 });
// Many viewers can share one IP (NAT, venues); keep the per-IP budget generous.
const heartbeatIpLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 600 });

publicViewersRouter.post(
  "/heartbeat",
  express.text({ type: "text/plain", limit: "2kb" }),
  (req, _res, next) => {
    // sendBeacon posts text/plain; normalize to an object for the limiter keys.
    req.body = parseHeartbeatBody(req.body);
    next();
  },
  rateLimit([
    { limiter: heartbeatIpLimiter, key: (req) => `ip:${clientIp(req)}` },
    {
      limiter: heartbeatViewerLimiter,
      key: (req) => {
        const id = (req.body as any)?.viewerId;
        return isValidViewerId(id) ? `v:${id}` : null;
      },
    },
  ]),
  async (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
    const viewerId = body.viewerId;
    const kind = String(body.kind || "hls").toLowerCase();
    if (!isValidViewerRoomId(roomId)) return res.status(400).json({ error: "invalid_room_id" });
    if (!isValidViewerId(viewerId)) return res.status(400).json({ error: "invalid_viewer_id" });
    if (kind !== "hls") return res.status(400).json({ error: "invalid_kind" });

    try {
      if (body.leave === true || body.leave === "true") {
        await markHlsViewerLeft(roomId, viewerId);
        return res.json({ ok: true });
      }

      const roomSnap = await firestore.collection("rooms").doc(roomId).get();
      if (!roomSnap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
      const room = (roomSnap.data() || {}) as any;
      if (String(room?.hls?.status || "idle") !== "live") {
        return res.json({ ok: false, live: false, currentViewers: 0, totalViewers: 0 });
      }

      let stats = readViewerStats(room.viewerStats);
      if (!isSessionActive(stats)) stats = await ensureLiveSession(roomId);
      if (!stats) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

      const added = await recordHlsHeartbeat(roomId, viewerId, stats.sessionId);
      const latest = added && added.sessionId === stats.sessionId ? added : stats;
      const current = await getCurrentViewers(roomId, { room });
      const peak = await updatePeak(roomId, current.total, latest.sessionId).catch(() => null);

      return res.json({
        ok: true,
        live: true,
        currentViewers: current.total,
        totalViewers: latest.totalUnique,
        peak: peak ?? latest.peak,
      });
    } catch (err: any) {
      console.warn("[viewers/heartbeat] failed", { roomId, error: err?.message || err });
      return res.status(500).json({ error: "heartbeat_failed" });
    }
  }
);

// ---------------------------------------------------------------------------
// Host read API
// ---------------------------------------------------------------------------

export const roomViewersRouter = Router();

roomViewersRouter.get("/:roomId/viewers", async (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!isValidViewerRoomId(roomId)) return res.status(400).json({ error: "invalid_room_id" });
  try {
    const roomRef = firestore.collection("rooms").doc(roomId);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    const room = (roomSnap.data() || {}) as any;

    const denied = await checkRoomHostAccess(req, roomId, room);
    if (denied) {
      return res
        .status(denied)
        .json({ error: denied === 401 ? PERMISSION_ERRORS.UNAUTHORIZED : PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const stats = readViewerStats(room.viewerStats);
    const live = isSessionActive(stats);
    const current = live
      ? await getCurrentViewers(roomId, { room })
      : { total: 0, hls: 0, rtcAudience: 0, onStage: 0, host: 0, roomExists: null };
    let peak = stats?.peak ?? 0;
    if (live) {
      const updated = await updatePeak(roomId, current.total, stats?.sessionId).catch(() => null);
      if (typeof updated === "number") peak = Math.max(peak, updated);
    }

    return res.json({
      sessionId: stats?.sessionId ?? null,
      startedAt: stats?.startedAt ?? null,
      endedAt: stats?.endedAt ?? null,
      live,
      current: { total: current.total, hls: current.hls, rtcAudience: current.rtcAudience, onStage: current.onStage },
      totalUnique: { total: stats?.totalUnique ?? 0, hls: stats?.totalUniqueHls ?? 0, rtc: stats?.totalUniqueRtc ?? 0 },
      peak,
    });
  } catch (err: any) {
    console.error("[rooms/viewers] failed", { roomId, error: err?.message || err });
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// Post-stream summary
// ---------------------------------------------------------------------------

/**
 * GET /api/rooms/:roomId/stream-summary?sessionId=<optional; default latest>
 * Auth: host/cohost (user auth or a host/cohost x-room-access-token).
 * -> { sessionId, startedAt, endedAt, live, durationSec, peakConcurrent,
 *      uniqueViewers: { total, hls, rtc }, avgWatchSeconds | null,
 *      watchSampleSize,
 *      outputs: [{ egressId, kind, destinations: [{ platform, label, status?, error? }],
 *                  startedAt, endedAt, durationSec, status, error? }] }
 * Timestamps are epoch ms. output.status: live | completed | failed | stopped_limit.
 * 404 { error: "no_session" } when the room never went live.
 */
roomViewersRouter.get("/:roomId/stream-summary", async (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!isValidViewerRoomId(roomId)) return res.status(400).json({ error: "invalid_room_id" });
  const rawSession = typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";
  if (rawSession && !isValidViewerRoomId(rawSession)) return res.status(400).json({ error: "invalid_session_id" });
  try {
    const roomSnap = await firestore.collection("rooms").doc(roomId).get();
    if (!roomSnap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    const room = (roomSnap.data() || {}) as any;

    const denied = await checkRoomHostAccess(req, roomId, room);
    if (denied) {
      return res
        .status(denied)
        .json({ error: denied === 401 ? PERMISSION_ERRORS.UNAUTHORIZED : PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const summary = await getStreamSummary(roomId, room, rawSession || null);
    if (!summary) return res.status(404).json({ error: "no_session" });
    res.setHeader("Cache-Control", "no-store");
    return res.json(summary);
  } catch (err: any) {
    console.error("[rooms/stream-summary] failed", { roomId, error: err?.message || err });
    return res.status(500).json({ error: "internal_error" });
  }
});
