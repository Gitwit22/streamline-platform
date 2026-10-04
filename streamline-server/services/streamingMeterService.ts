/**
 * In-process streaming meter sweep (see lib/streamingMeter.ts).
 *
 * Runs every STREAMING_METER_SWEEP_MS (default 120000 = 2 min; "0" disables).
 * The same sweep is exposed at /api/maintenance/streaming-meter-sweep for an
 * external cron, so metering keeps working if the process is restarted or
 * scaled to several instances (the sweep is idempotent).
 */
import { sweepStreamingMeter } from "../lib/streamingMeter";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

function intervalMs(): number {
  const raw = process.env.STREAMING_METER_SWEEP_MS;
  if (raw === undefined || raw === "") return 120_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 120_000;
}

async function runSweep(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const r = await sweepStreamingMeter();
    if (r.considered > 0 || r.stopped.length > 0) {
      console.log("[streamingMeter] sweep", {
        considered: r.considered,
        billed: r.billed,
        closed: r.closed,
        streamingMinutesBilled: r.streamingMinutesBilled,
        stopped: r.stopped,
        errors: r.errors,
      });
    }
  } catch (e: any) {
    console.error("[streamingMeter] sweep failed", e?.message || e);
  } finally {
    running = false;
  }
}

export function startStreamingMeterSweep(): void {
  if (timer) return;
  const ms = intervalMs();
  if (ms <= 0) {
    console.log("[streamingMeter] in-process sweep disabled (STREAMING_METER_SWEEP_MS=0)");
    return;
  }
  timer = setInterval(() => void runSweep(), Math.max(30_000, ms));
  console.log(`[streamingMeter] in-process sweep every ${Math.round(Math.max(30_000, ms) / 1000)}s`);
}

export function stopStreamingMeterSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
