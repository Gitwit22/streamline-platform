import { Router } from "express";
import crypto from "crypto";
import { requireAdmin } from "../middleware/adminAuth";
import {
  expireEmergencyRecordings,
  purgeExpiredRecordings,
  purgeOldRecordings,
  runDueJobs,
  runJob,
  type RunOutcome,
} from "../lib/jobs";

// Re-exported for older imports; the implementation lives in lib/jobs/mediaPurge.ts.
export { purgeOldRecordings, RECORDING_RETENTION_HOURS } from "../lib/jobs";

const router = Router();

// Admin-only maintenance endpoints (Render cron-friendly)
//
// Supports two auth mechanisms:
// 1) Standard admin auth via requireAdmin (JWT/cookie/body)
// 2) Static maintenance key for cron jobs: header x-maintenance-key
//    (Authorization: Bearer <key> is deprecated; use only for legacy clients)
function keyMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.use((req, res, next) => {
  const key = String(process.env.MAINTENANCE_KEY || "").trim();

  const headerKey = String(req.headers["x-maintenance-key"] || "").trim();
  const allowDeprecated = process.env.ALLOW_DEPRECATED_AUTHZ_TOKENS !== "0";
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  const bearer =
    allowDeprecated && typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";

  if (key && headerKey && keyMatches(headerKey, key)) return next();
  if (key && bearer && keyMatches(bearer, key)) {
    console.warn("[deprecation] maintenance key provided via Authorization header; send x-maintenance-key instead");
    return next();
  }

  // Every maintenance route mutates data. GET is only accepted with the
  // maintenance key (cron); cookie-authenticated admins must POST, because the
  // CSRF guard skips GET and the session cookie is SameSite=None (an <img> on
  // any site could otherwise trigger purges through an admin's browser).
  if (req.method === "GET" || req.method === "HEAD") {
    return res.status(405).json({ error: "method_not_allowed", hint: "Use POST (or send x-maintenance-key)" });
  }

  return requireAdmin(req, res, next);
});



// ---------------------------------------------------------------------------
// Scheduled jobs (lib/jobs). Every endpoint below runs through the same job
// functions as the in-process scheduler, so cron, admin and timer runs share
// one lease (jobLocks/{name}), status (jobStatus/{name}) and history (jobRuns).
// ---------------------------------------------------------------------------

function qNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Run a job (forced: ignores "not due", still respects another instance's lease). */
async function runForced(name: string, params: Record<string, any> = {}): Promise<RunOutcome> {
  return runJob(name, { trigger: "maintenance", force: true, params });
}

function sendOutcome(res: any, out: RunOutcome, legacy: (details: Record<string, any>) => Record<string, any>) {
  if (out.status === "skipped") return res.status(409).json({ ok: false, skipped: true, reason: out.reason });
  if (!out.ran) return res.status(500).json({ ok: false, error: out.error || out.status });
  const details = (out.details || {}) as Record<string, any>;
  // A run that threw has no details (500); a partial failure still reports its counts.
  const threw = out.status === "error" && Object.keys(details).length === 0;
  return res.status(threw ? 500 : 200).json({
    ok: !threw,
    ...legacy(details),
    job: { name: out.job, status: out.status, processed: out.processed, durationMs: out.durationMs, error: out.error ?? null, runId: out.runId ?? null },
  });
}

// POST /api/maintenance/jobs/run-due  (Render cron backstop)
// Runs every job whose interval has elapsed (across all instances). Wakes a
// sleeping free-plan web instance and catches up on its schedule.
router.post("/jobs/run-due", async (_req, res) => {
  const outcomes = await runDueJobs("cron");
  const ran = outcomes.filter((o) => o.ran);
  return res.json({
    ok: ran.every((o) => o.status === "success"),
    ran: ran.length,
    jobs: outcomes.map((o) => ({
      job: o.job,
      status: o.status,
      reason: o.reason,
      processed: o.processed ?? 0,
      durationMs: o.durationMs,
      error: o.error ?? null,
      nextRunAt: o.nextRunAtMs ? new Date(o.nextRunAtMs).toISOString() : null,
    })),
  });
});

// POST /api/maintenance/jobs/:name/run  (force one job now)
router.post("/jobs/:name/run", async (req, res) => {
  const out = await runForced(String(req.params.name || ""), {});
  if (out.status === "unknown_job") return res.status(404).json({ ok: false, error: "unknown_job" });
  return sendOutcome(res, out, (d) => ({ details: d }));
});

// Legacy: emergency expiry + deleteAfterMs purge only (subset of media-purge;
// shares the same functions, not the media-purge lease/status).
async function handleExpireEmergency(_req: any, res: any) {
  const now = new Date();
  const [{ deletedCount }, { deletedCount: purgedRecordingsCount }] = await Promise.all([
    expireEmergencyRecordings(now),
    purgeExpiredRecordings(now),
  ]);
  return res.json({ ok: true, deletedCount, purgedRecordingsCount });
}
router.get("/expire-emergency-recordings", handleExpireEmergency);
router.post("/expire-emergency-recordings", handleExpireEmergency);

// Deletes expired recording objects whose deleteAfterMs has passed.
// POST/GET /api/maintenance/purge-expired-recordings?limit=200
async function handlePurgeExpired(req: any, res: any) {
  const { deletedCount } = await purgeExpiredRecordings(new Date(), { limit: qNum(req.query.limit) });
  return res.json({ ok: true, deletedCount });
}
router.get("/purge-expired-recordings", handlePurgeExpired);
router.post("/purge-expired-recordings", handlePurgeExpired);

// Job: account-purge
async function handlePurgeDeletedAccounts(_req: any, res: any) {
  const out = await runForced("account-purge");
  return sendOutcome(res, out, (d) => ({ purgedCount: Number(d.purged || 0) }));
}
router.get("/purge-deleted-accounts", handlePurgeDeletedAccounts);
router.post("/purge-deleted-accounts", handlePurgeDeletedAccounts);

// Job: stale-hls. POST/GET /api/maintenance/purge-stale-hls?ttlMinutes=180&limit=100
async function handlePurgeStaleHls(req: any, res: any) {
  const out = await runForced("stale-hls", { ttlMinutes: qNum(req.query.ttlMinutes), limit: qNum(req.query.limit) });
  return sendOutcome(res, out, (d) => ({
    purgedCount: Number(d.purged || 0),
    considered: d.considered,
    ttlMinutes: d.ttlMinutes,
    billedMinutes: d.billedMinutes,
  }));
}
router.get("/purge-stale-hls", handlePurgeStaleHls);
router.post("/purge-stale-hls", handlePurgeStaleHls);

// Job: streaming-meter-sweep. POST/GET /api/maintenance/streaming-meter-sweep?limit=500
async function handleStreamingMeterSweep(req: any, res: any) {
  const out = await runForced("streaming-meter-sweep", { limit: qNum(req.query.limit) });
  // Legacy SweepResult shape (stopped = list of stopped outputs).
  return sendOutcome(res, out, (d) => ({
    considered: d.considered,
    billed: d.billed,
    closed: d.closed,
    streamingMinutesBilled: d.streamingMinutesBilled,
    stopped: d.stoppedOutputs ?? [],
    errors: d.errors,
  }));
}
router.get("/streaming-meter-sweep", handleStreamingMeterSweep);
router.post("/streaming-meter-sweep", handleStreamingMeterSweep);

// 24-hour recording retention (part of media-purge). Supports dryRun
// (query dryRun=1 or env RECORDING_CLEANUP_DRY_RUN=1), so it calls the
// function directly. POST/GET /api/maintenance/purge-old-recordings?limit=200&dryRun=1
async function handlePurgeOldRecordings(req: any, res: any) {
  const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true" || process.env.RECORDING_CLEANUP_DRY_RUN === "1";
  const result = await purgeOldRecordings(new Date(), { limit: qNum(req.query.limit), dryRun });
  return res.json({ ok: true, ...result });
}
router.get("/purge-old-recordings", handlePurgeOldRecordings);
router.post("/purge-old-recordings", handlePurgeOldRecordings);

export default router;
