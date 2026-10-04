/**
 * Streaming meter sweep (default every 2 minutes; see lib/streamingMeter.ts).
 * Bills running outputs, closes outputs that ended without a stop call and
 * stops outputs over the monthly limit / plan maxSessionMinutes.
 *
 * Replaces services/streamingMeterService.ts. STREAMING_METER_SWEEP_MS is
 * still honored (default 120000, minimum 30000, "0" disables the in-process
 * timer; the cron backstop / maintenance endpoint can still run it).
 */
import { sweepStreamingMeter } from "../streamingMeter";
import { defineJob } from "./framework";

export function streamingMeterIntervalMs(): number {
  const raw = process.env.STREAMING_METER_SWEEP_MS;
  if (raw === undefined || raw === "") return 120_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 120_000;
  if (n === 0) return 0;
  return Math.max(30_000, n);
}

export const streamingMeterJob = defineJob({
  name: "streaming-meter-sweep",
  title: "Streaming Meter Sweep",
  description: "Bills running outputs, closes ended outputs, enforces monthly streaming minutes and maxSessionMinutes.",
  intervalMs: streamingMeterIntervalMs,
  leaseMs: 5 * 60_000,
  recordNoopRuns: false,
  highlight: "stopped",
  async run(ctx) {
    const limit = ctx.params.limit !== undefined ? Number(ctx.params.limit) : undefined;
    const r = await sweepStreamingMeter({ now: ctx.now, limit });
    const stopped = Array.isArray(r.stopped) ? r.stopped.length : 0;
    return {
      processed: (r.billed || 0) + (r.closed || 0) + stopped,
      details: {
        considered: r.considered,
        billed: r.billed,
        closed: r.closed,
        streamingMinutesBilled: r.streamingMinutesBilled,
        stopped,
        stoppedOutputs: r.stopped,
        errors: r.errors,
      },
      error: r.errors > 0 ? `${r.errors} output(s) failed` : null,
    };
  },
});
