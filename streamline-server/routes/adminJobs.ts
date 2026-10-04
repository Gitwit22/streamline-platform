/**
 * Admin "System Jobs" endpoints (mounted by routes/admin.ts, which applies
 * requireAdmin to every route).
 *
 *   GET  /api/admin/jobs              jobStatus for every registered job + its
 *                                     last runs (newest first)
 *   POST /api/admin/jobs/:name/run    run a job now (forced; respects another
 *                                     instance's lease). Audit-logged.
 */
import express from "express";
import { logAdminAction } from "../middleware/adminAuth";
import { getJob, getJobsOverview, INSTANCE_ID, runJob, schedulerRunning } from "../lib/jobs";

const router = express.Router();

router.get("/jobs", async (req, res) => {
  try {
    const runsLimit = Math.max(0, Math.min(10, Number(req.query.runs ?? 5) || 0));
    const jobs = await getJobsOverview();
    const nowMs = Date.now();
    return res.json({
      nowMs,
      instance: INSTANCE_ID,
      schedulerRunning: schedulerRunning(),
      jobs: jobs.map((j) => {
        const s = (j.status || {}) as Record<string, any>;
        const leaseActive = !!(j.lock?.leaseUntilMs && j.lock.leaseUntilMs > nowMs);
        return {
          name: j.name,
          title: j.title,
          description: j.description,
          intervalMs: j.intervalMs,
          enabled: j.intervalMs > 0,
          highlight: j.highlight,
          running: leaseActive && s.running === true,
          runningInstance: leaseActive ? j.lock?.owner ?? null : null,
          lastRunAtMs: s.lastRunAtMs ?? null,
          lastFinishedAtMs: s.lastFinishedAtMs ?? null,
          lastStatus: s.lastStatus ?? null,
          lastProcessed: s.lastProcessed ?? null,
          lastDetails: s.lastDetails ?? null,
          lastError: s.lastError ?? null,
          lastDurationMs: s.lastDurationMs ?? null,
          lastTrigger: s.lastTrigger ?? null,
          lastSuccessAtMs: s.lastSuccessAtMs ?? null,
          nextRunAtMs: j.intervalMs > 0 ? s.nextRunAtMs ?? null : null,
          runCount: s.runCount ?? 0,
          errorCount: s.errorCount ?? 0,
          recentRuns: Array.isArray(s.recentRuns) ? s.recentRuns.slice(0, runsLimit) : [],
        };
      }),
    });
  } catch (e: any) {
    console.error("[admin/jobs] failed to load", e?.message || e);
    return res.status(500).json({ error: "jobs_load_failed" });
  }
});

router.post("/jobs/:name/run", async (req, res) => {
  const name = String(req.params.name || "");
  if (!getJob(name)) return res.status(404).json({ error: "unknown_job" });
  const adminUid = (req as any).adminUser?.uid || "unknown";

  // runJob never throws, so the audit entry always records the outcome.
  const out = await runJob(name, { trigger: "admin", force: true });
  await logAdminAction(adminUid, "run_system_job", {
    job: name,
    ip: req.ip,
    status: out.status,
    processed: out.processed ?? 0,
    error: out.error ?? null,
    runId: out.runId ?? null,
  });

  if (out.status === "skipped") return res.status(409).json({ ok: false, ...out });
  return res.json({ ok: out.ran && out.status === "success", ...out });
});

export default router;
