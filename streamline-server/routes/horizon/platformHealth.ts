/**
 * Horizon Platform Health routes — real-time system health metrics.
 *
 * Mounted at `/api/horizon/health` in index.ts.
 * requireAdmin is applied at the mount point.
 *
 * Routes:
 *   GET /           Full health snapshot (uptime, memory, CPU, versions)
 *   GET /metrics    Time-series metrics (last N samples)
 */
import { Router } from "express";
import os from "node:os";
import { logger } from "../../lib/logger";

const router = Router();

/* ── In-memory metrics ring buffer ────────────────────────────────── */

interface MetricSample {
  ts: string;
  cpuUser: number;
  cpuSystem: number;
  memHeapUsed: number;
  memHeapTotal: number;
  memRss: number;
  memExternal: number;
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  activeHandles: number;
  eventLoopLag?: number;
}

const MAX_SAMPLES = 1440; // 24h at 1-min intervals
const samples: MetricSample[] = [];

function collectSample(): MetricSample {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const load = os.loadavg();

  return {
    ts: new Date().toISOString(),
    cpuUser: cpu.user,
    cpuSystem: cpu.system,
    memHeapUsed: mem.heapUsed,
    memHeapTotal: mem.heapTotal,
    memRss: mem.rss,
    memExternal: mem.external,
    loadAvg1: load[0],
    loadAvg5: load[1],
    loadAvg15: load[2],
    activeHandles: (process as any)._getActiveHandles?.()?.length ?? 0,
  };
}

// Collect every 60 seconds
setInterval(() => {
  samples.push(collectSample());
  if (samples.length > MAX_SAMPLES) samples.shift();
}, 60_000);

// Seed with initial sample
samples.push(collectSample());

/* ── GET / — Full health snapshot ─────────────────────────────────── */

router.get("/", (_req, res) => {
  try {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const load = os.loadavg();

    return res.json({
      ok: true,
      ts: new Date().toISOString(),
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      env: String(process.env.NODE_ENV || "development"),
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
        external: mem.external,
        arrayBuffers: mem.arrayBuffers,
      },
      cpu: {
        user: cpu.user,
        system: cpu.system,
      },
      os: {
        loadAvg: { "1m": load[0], "5m": load[1], "15m": load[2] },
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        cpus: os.cpus().length,
      },
      activeHandles: (process as any)._getActiveHandles?.()?.length ?? 0,
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, "GET /health failed");
    return res.status(500).json({ error: "HEALTH_CHECK_FAILED" });
  }
});

/* ── GET /metrics — Time-series metrics ───────────────────────────── */

router.get("/metrics", (req, res) => {
  try {
    const last = Math.min(
      Math.max(1, parseInt(String(req.query.last), 10) || 60),
      MAX_SAMPLES
    );
    const slice = samples.slice(-last);
    return res.json({ ok: true, count: slice.length, samples: slice });
  } catch (err: any) {
    logger.error({ err: err?.message }, "GET /health/metrics failed");
    return res.status(500).json({ error: "METRICS_FETCH_FAILED" });
  }
});

export default router;
