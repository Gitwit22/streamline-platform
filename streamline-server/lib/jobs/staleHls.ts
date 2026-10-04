/**
 * Stale HLS purge: safety net for orphaned HLS sessions (stop egress, delete
 * segments, flip the room idle, bill the meter interval once). Moved from
 * routes/maintenance.ts (purge-stale-hls).
 */
import { firestore } from "../../firebaseAdmin";
import { deletePrefix } from "../storageClient";
import { stopEgress } from "../../services/livekitEgress";
import { setHlsIdleIfRun } from "../../services/rooms";
import { onHlsIdle } from "../viewerStats";
import { hlsLastSeenMs, isHlsSessionStale } from "../mediaPure";
import { closeOutputIntervals } from "../streamingMeter";
import { defineJob } from "./framework";

export async function purgeStaleHls(now: Date, opts?: { ttlMinutes?: number; limit?: number }) {
  // Staleness is measured from the last heartbeat (refreshed by host /status
  // polling while live), so a long but attended stream is never purged.
  const ttlMinutes = typeof opts?.ttlMinutes === "number" && Number.isFinite(opts.ttlMinutes) && opts.ttlMinutes > 0 ? opts.ttlMinutes : 180;
  const limit = typeof opts?.limit === "number" && Number.isFinite(opts.limit) ? Math.max(1, Math.min(500, opts.limit)) : 100;
  const ttlMs = ttlMinutes * 60 * 1000;
  const nowMs = now.getTime();

  let purgedCount = 0;
  let considered = 0;
  let billedMinutesTotal = 0;

  // Prefer a targeted query; if Firestore complains about indexes, fall back to a bounded scan.
  let docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  try {
    const snap = await firestore
      .collection("rooms")
      .where("hls.status", "in", ["starting", "live", "error"])
      .limit(limit)
      .get();
    docs = snap.docs;
  } catch (e) {
    const snap = await firestore
      .collection("rooms")
      .orderBy("updatedAt", "desc")
      .limit(Math.max(limit, 200))
      .get();
    docs = snap.docs;
  }

  for (const doc of docs) {
    const data = (doc.data() || {}) as any;
    const hls = data.hls || {};
    const status = String(hls.status || "idle").toLowerCase();
    if (status !== "starting" && status !== "live" && status !== "error") continue;

    considered += 1;
    if (!isHlsSessionStale(hls, nowMs, ttlMs)) continue;

    const roomId = doc.id;
    const prefix = String(hls.prefix || `hls/${roomId}/`).trim();
    const egressId = typeof hls.egressId === "string" ? hls.egressId : null;
    const runId = typeof hls.runId === "string" ? hls.runId : null;

    try {
      if (egressId) {
        try {
          await stopEgress(egressId);
        } catch (e: any) {
          console.warn("[maintenance/purge-stale-hls] stopEgress failed", { roomId, egressId, error: e?.message || e });
        }
      }

      try {
        await deletePrefix(prefix);
      } catch (e: any) {
        console.warn("[maintenance/purge-stale-hls] deletePrefix failed", { roomId, prefix, error: e?.message || e });
      }

      // Transition idle only if the same run still owns the room; exactly one
      // of (stop, auto-stop, purge) bills for a run that we flip here.
      let flipped = false;
      try {
        flipped = await setHlsIdleIfRun(doc.ref, runId);
      } catch (e: any) {
        console.warn("[maintenance/purge-stale-hls] setHlsIdle failed", { roomId, error: e?.message || e });
      }

      // Close + bill the HLS meter interval (idempotent: exactly once no
      // matter which of stop / auto-stop / webhook / purge / sweep runs first).
      if (egressId) {
        const billed = await closeOutputIntervals([egressId], { endedAt: now, reason: "stale_hls_purge", now });
        billedMinutesTotal += billed.reduce((sum, r) => sum + r.streamingMinutesDelta, 0);
      }

      if (flipped) {
        // Viewer counting: end the live session if the room is empty (best-effort).
        await onHlsIdle(roomId, data);
        purgedCount += 1;
        console.warn("[maintenance/purge-stale-hls] purged stale session", {
          roomId,
          status,
          egressId,
          lastSeenAt: (() => {
            const ms = hlsLastSeenMs(hls);
            return ms ? new Date(ms).toISOString() : null;
          })(),
        });
      }
    } catch (e: any) {
      console.warn("[maintenance/purge-stale-hls] failed", { roomId, error: e?.message || e });
    }
  }

  return { ok: true, purgedCount, considered, ttlMinutes, limit, billedMinutes: billedMinutesTotal };
}

export const staleHlsJob = defineJob({
  name: "stale-hls",
  title: "Stale HLS Sessions",
  description: "Stops orphaned HLS egress (no heartbeat for ttlMinutes, default 180), deletes segments, bills the meter once.",
  intervalMs: 5 * 60_000,
  highlight: "purged",
  async run(ctx) {
    const ttlMinutes = ctx.params.ttlMinutes !== undefined ? Number(ctx.params.ttlMinutes) : undefined;
    const limit = ctx.params.limit !== undefined ? Number(ctx.params.limit) : undefined;
    const r = await purgeStaleHls(ctx.now, { ttlMinutes, limit });
    return {
      processed: r.purgedCount,
      details: { purged: r.purgedCount, considered: r.considered, ttlMinutes: r.ttlMinutes, billedMinutes: r.billedMinutes },
    };
  },
});
