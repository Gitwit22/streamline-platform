/**
 * Scheduled jobs framework.
 *
 *   defineJob({ name, intervalMs, run(ctx) -> { processed, details } })
 *
 * Every run (in-process timer, Render cron backstop, admin "Run now",
 * legacy /api/maintenance/* endpoints) goes through runJob(), so they share
 * one lease, one status doc and one history:
 *
 *   jobLocks/{name}   { leaseUntilMs, owner, acquiredAtMs }
 *                     Firestore lease: only one instance runs a job at a time,
 *                     and an unforced run only starts once `intervalMs` has
 *                     elapsed since the last start on ANY instance.
 *   jobStatus/{name}  { lastRunAt, lastStatus, lastProcessed, lastError,
 *                       lastDurationMs, nextRunAt, runCount, errorCount,
 *                       recentRuns[] (last 10) ... }
 *   jobRuns/{autoId}  { job, startedAt, finishedAt, durationMs, status,
 *                       processed, details, error, instance, trigger }
 *                     (no-op runs of high-frequency jobs are not stored;
 *                     history older than 30 days is purged by
 *                     the expired-sessions job)
 *
 * Nothing here throws out of a timer: Firestore failures are logged and the
 * run is reported as an error outcome.
 */
import os from "os";
import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../../firebaseAdmin";
import {
  buildRunRecord,
  buildStatusPatch,
  decideLease,
  defaultLeaseMs,
  errorMessage,
  type JobRunRecord,
  type JobRunStatus,
  type JobTrigger,
} from "./pure";

export type JobContext = {
  name: string;
  now: Date;
  trigger: JobTrigger;
  instanceId: string;
  /** Optional per-call parameters (maintenance endpoints pass limit/ttl/...). */
  params: Record<string, any>;
  /** Soft deadline: long loops should stop once timeLeftMs() <= 0. */
  deadlineMs: number;
  timeLeftMs(): number;
};

export type JobResult = {
  processed: number;
  details?: Record<string, unknown>;
  /** Partial failure: the run is recorded as "error" but keeps processed/details. */
  error?: string | null;
};

export type JobDefinition = {
  name: string;
  title: string;
  description?: string;
  /** Interval between runs; a function so env overrides are read at runtime. <= 0 disables the timer. */
  intervalMs: number | (() => number);
  leaseMs?: number;
  /**
   * Store a jobRuns doc even when a successful run processed nothing.
   * Defaults to true for jobs that run every 10 minutes or less often.
   */
  recordNoopRuns?: boolean;
  /** Key in details shown next to "Processed" in the admin panel (e.g. "stopped"). */
  highlight?: string;
  run(ctx: JobContext): Promise<JobResult>;
};

export const JOB_LOCKS = "jobLocks";
export const JOB_STATUS = "jobStatus";
export const JOB_RUNS = "jobRuns";
const RECENT_RUNS_KEPT = 10;

export const INSTANCE_ID = [
  process.env.RENDER_INSTANCE_ID || os.hostname() || "local",
  String(process.pid),
  crypto.randomBytes(3).toString("hex"),
].join(":");

const registry = new Map<string, JobDefinition>();
const runningLocally = new Set<string>();

export function defineJob(def: JobDefinition): JobDefinition {
  if (!/^[a-z0-9-]{2,64}$/.test(def.name)) throw new Error(`invalid job name: ${def.name}`);
  registry.set(def.name, def);
  return def;
}

export function getJob(name: string): JobDefinition | undefined {
  return registry.get(name);
}

export function listJobs(): JobDefinition[] {
  return Array.from(registry.values());
}

/** JOB_<NAME>_MS env override, e.g. JOB_MEDIA_PURGE_MS=1800000 ("0" disables the timer). */
export function jobIntervalEnvName(name: string): string {
  return `JOB_${name.toUpperCase().replace(/-/g, "_")}_MS`;
}

export function jobIntervalMs(def: JobDefinition): number {
  const raw = process.env[jobIntervalEnvName(def.name)];
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n === 0 ? 0 : Math.max(30_000, n);
  }
  const v = typeof def.intervalMs === "function" ? def.intervalMs() : def.intervalMs;
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

function jobLeaseMs(def: JobDefinition, intervalMs: number): number {
  return def.leaseMs && def.leaseMs > 0 ? def.leaseMs : defaultLeaseMs(intervalMs || 60 * 60_000);
}

export type RunOutcome = {
  job: string;
  ran: boolean;
  status: JobRunStatus | "not_due" | "unknown_job";
  reason?: string;
  processed?: number;
  details?: Record<string, unknown>;
  error?: string | null;
  durationMs?: number;
  nextRunAtMs: number | null;
  runId?: string | null;
};

/**
 * Run one job if it is due (or `force`), under the Firestore lease.
 * Never throws.
 */
export async function runJob(
  name: string,
  opts: { trigger: JobTrigger; force?: boolean; params?: Record<string, any> } = { trigger: "schedule" }
): Promise<RunOutcome> {
  const def = registry.get(name);
  if (!def) return { job: name, ran: false, status: "unknown_job", nextRunAtMs: null };

  const intervalMs = jobIntervalMs(def);
  const trigger = opts.trigger;
  const force = opts.force === true;

  if (intervalMs <= 0 && !force) {
    return { job: name, ran: false, status: "skipped", reason: "disabled", nextRunAtMs: null };
  }
  if (runningLocally.has(name)) {
    const out: RunOutcome = { job: name, ran: false, status: "skipped", reason: "running_on_this_instance", nextRunAtMs: null };
    if (force) await recordSkip(def, intervalMs, trigger, out.reason!);
    return out;
  }

  const leaseMs = jobLeaseMs(def, intervalMs);
  const effectiveInterval = intervalMs > 0 ? intervalMs : leaseMs;
  const lockRef = firestore.collection(JOB_LOCKS).doc(name);
  const statusRef = firestore.collection(JOB_STATUS).doc(name);

  runningLocally.add(name);
  try {
    // ---- acquire -------------------------------------------------------
    let decision: ReturnType<typeof decideLease>;
    const startedAtMs = Date.now();
    try {
      decision = await firestore.runTransaction(async (tx) => {
        const [lockSnap, statusSnap] = await Promise.all([tx.get(lockRef), tx.get(statusRef)]);
        const d = decideLease({
          lock: lockSnap.exists ? (lockSnap.data() as any) : null,
          status: statusSnap.exists ? (statusSnap.data() as any) : null,
          nowMs: startedAtMs,
          instanceId: INSTANCE_ID,
          intervalMs: effectiveInterval,
          leaseMs,
          force,
        });
        if (d.action === "run") {
          tx.set(lockRef, { leaseUntilMs: d.leaseUntilMs, owner: INSTANCE_ID, acquiredAtMs: startedAtMs, job: name });
          tx.set(
            statusRef,
            {
              name,
              title: def.title,
              intervalMs,
              lastStartedAtMs: startedAtMs,
              running: true,
              runningInstance: INSTANCE_ID,
              runningSinceMs: startedAtMs,
              nextRunAtMs: d.nextRunAtMs,
              nextRunAt: new Date(d.nextRunAtMs),
            },
            { merge: true }
          );
        }
        return d;
      });
    } catch (e: any) {
      console.error(`[jobs] ${name}: lease transaction failed`, e?.message || e);
      return {
        job: name,
        ran: false,
        status: "error",
        error: `lease_failed: ${errorMessage(e)}`,
        nextRunAtMs: Date.now() + Math.min(effectiveInterval, 60_000),
      };
    }

    if (decision.action === "skip") {
      const out: RunOutcome = {
        job: name,
        ran: false,
        status: decision.reason === "not_due" ? "not_due" : "skipped",
        reason: decision.reason === "leased" ? `leased_by:${decision.heldBy}` : decision.reason,
        nextRunAtMs: decision.nextRunAtMs,
      };
      if (force && decision.reason === "leased") await recordSkip(def, intervalMs, trigger, out.reason!);
      return out;
    }

    // ---- run -----------------------------------------------------------
    const deadlineMs = startedAtMs + Math.floor(leaseMs * 0.8);
    const ctx: JobContext = {
      name,
      now: new Date(startedAtMs),
      trigger,
      instanceId: INSTANCE_ID,
      params: opts.params || {},
      deadlineMs,
      timeLeftMs: () => deadlineMs - Date.now(),
    };

    let status: JobRunStatus = "success";
    let result: JobResult | null = null;
    let err: unknown = null;
    try {
      result = await def.run(ctx);
      if (result?.error) {
        status = "error";
        err = result.error;
      }
    } catch (e) {
      status = "error";
      err = e;
      console.error(`[jobs] ${name}: run failed`, (e as any)?.message || e);
    }

    const rec = buildRunRecord({
      job: name,
      trigger,
      startedAtMs,
      finishedAtMs: Date.now(),
      status,
      processed: result?.processed,
      details: result?.details,
      error: err,
      instance: INSTANCE_ID,
    });

    const recordNoop = def.recordNoopRuns ?? (intervalMs === 0 || intervalMs >= 10 * 60_000);
    const storeRun = status !== "success" || rec.processed > 0 || recordNoop || trigger !== "schedule";
    const runId = storeRun ? await writeRun(rec) : null;
    await finishStatus(def, rec, effectiveInterval, runId, true);

    if (rec.processed > 0 || status !== "success") {
      console.log(`[jobs] ${name} ${status}`, { processed: rec.processed, durationMs: rec.durationMs, trigger, details: rec.details, error: rec.error });
    }

    return {
      job: name,
      ran: true,
      status,
      processed: rec.processed,
      details: rec.details,
      error: rec.error,
      durationMs: rec.durationMs,
      nextRunAtMs: rec.startedAtMs + effectiveInterval,
      runId,
    };
  } catch (e: any) {
    // Defensive: nothing above should throw, but a timer must never see it.
    console.error(`[jobs] ${name}: unexpected failure`, e?.message || e);
    return { job: name, ran: false, status: "error", error: errorMessage(e), nextRunAtMs: Date.now() + 60_000 };
  } finally {
    runningLocally.delete(name);
  }
}

async function writeRun(rec: JobRunRecord): Promise<string | null> {
  try {
    const ref = firestore.collection(JOB_RUNS).doc();
    await ref.set({
      ...rec,
      startedAt: new Date(rec.startedAtMs),
      finishedAt: new Date(rec.finishedAtMs),
    });
    return ref.id;
  } catch (e: any) {
    console.warn(`[jobs] ${rec.job}: failed to write jobRuns`, e?.message || e);
    return null;
  }
}

/** Update jobStatus (+ recentRuns) and release our lease in one transaction. */
async function finishStatus(def: JobDefinition, rec: JobRunRecord, intervalMs: number, runId: string | null, releaseLease: boolean) {
  const statusRef = firestore.collection(JOB_STATUS).doc(def.name);
  const lockRef = firestore.collection(JOB_LOCKS).doc(def.name);
  const patch = buildStatusPatch(rec, intervalMs);
  const summary = {
    id: runId,
    startedAtMs: rec.startedAtMs,
    durationMs: rec.durationMs,
    status: rec.status,
    processed: rec.processed,
    details: rec.details,
    error: rec.error,
    trigger: rec.trigger,
    instance: rec.instance,
  };
  try {
    await firestore.runTransaction(async (tx) => {
      const [statusSnap, lockSnap] = await Promise.all([tx.get(statusRef), tx.get(lockRef)]);
      const prev = statusSnap.exists ? ((statusSnap.data() as any)?.recentRuns as any[]) : [];
      const recentRuns = [summary, ...(Array.isArray(prev) ? prev : [])].slice(0, RECENT_RUNS_KEPT);
      const { runCountDelta, errorCountDelta, ...fields } = patch;
      const update: Record<string, any> = {
        ...fields,
        title: def.title,
        lastRunAt: new Date(patch.lastRunAtMs),
        nextRunAt: new Date(patch.nextRunAtMs),
        recentRuns,
        updatedAt: new Date(),
      };
      if (rec.status !== "skipped") {
        update.running = false;
        update.runningInstance = null;
        update.runningSinceMs = null;
        // A skipped record never moved lastStartedAtMs (that run never started).
      }
      if (runCountDelta) update.runCount = FieldValue.increment(runCountDelta);
      if (errorCountDelta) update.errorCount = FieldValue.increment(errorCountDelta);
      if (patch.lastSuccessAtMs) update.lastSuccessAt = new Date(patch.lastSuccessAtMs);
      tx.set(statusRef, update, { merge: true });
      if (releaseLease && lockSnap.exists && (lockSnap.data() as any)?.owner === INSTANCE_ID) {
        tx.set(lockRef, { leaseUntilMs: 0, releasedAtMs: Date.now() }, { merge: true });
      }
    });
  } catch (e: any) {
    console.warn(`[jobs] ${def.name}: failed to update jobStatus`, e?.message || e);
  }
}

async function recordSkip(def: JobDefinition, intervalMs: number, trigger: JobTrigger, reason: string) {
  const now = Date.now();
  const rec = buildRunRecord({
    job: def.name,
    trigger,
    startedAtMs: now,
    finishedAtMs: now,
    status: "skipped",
    details: { reason },
    instance: INSTANCE_ID,
  });
  const runId = await writeRun(rec);
  // Only record history; do not overwrite the last real run's status fields.
  try {
    const statusRef = firestore.collection(JOB_STATUS).doc(def.name);
    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(statusRef);
      const prev = snap.exists ? ((snap.data() as any)?.recentRuns as any[]) : [];
      const summary = { id: runId, startedAtMs: now, durationMs: 0, status: "skipped", processed: 0, details: { reason }, error: null, trigger, instance: INSTANCE_ID };
      tx.set(statusRef, { name: def.name, title: def.title, intervalMs, recentRuns: [summary, ...(Array.isArray(prev) ? prev : [])].slice(0, RECENT_RUNS_KEPT) }, { merge: true });
    });
  } catch (e: any) {
    console.warn(`[jobs] ${def.name}: failed to record skip`, e?.message || e);
  }
}

/** Run every job that is due (unforced). Used by the cron backstop. */
export async function runDueJobs(trigger: JobTrigger = "cron"): Promise<RunOutcome[]> {
  const jobs = listJobs().filter((j) => jobIntervalMs(j) > 0);
  return Promise.all(jobs.map((j) => runJob(j.name, { trigger })));
}

// ---------------------------------------------------------------------------
// In-process scheduler
// ---------------------------------------------------------------------------

let tickTimer: ReturnType<typeof setInterval> | null = null;
const nextCheckAt = new Map<string, number>();

export function schedulerRunning(): boolean {
  return tickTimer !== null;
}

/**
 * Start the in-process scheduler. One cheap timer ticks every `tickMs`; a job
 * only hits Firestore when its locally cached next-run time has passed, so the
 * steady-state cost is about one lease transaction per job per interval.
 */
export function startJobScheduler(opts: { tickMs?: number; initialDelayMs?: number } = {}): void {
  if (tickTimer) return;
  const tickMs = Math.max(5_000, opts.tickMs ?? 15_000);
  const initialDelay = Math.max(0, opts.initialDelayMs ?? 20_000);
  const start = Date.now();
  listJobs().forEach((j, i) => nextCheckAt.set(j.name, start + initialDelay + i * 3_000));

  tickTimer = setInterval(() => {
    try {
      tick();
    } catch (e: any) {
      console.error("[jobs] scheduler tick failed", e?.message || e);
    }
  }, tickMs);
  tickTimer.unref?.();
  console.log(
    `[jobs] scheduler started on ${INSTANCE_ID}: ` +
      listJobs()
        .map((j) => `${j.name}=${Math.round(jobIntervalMs(j) / 1000)}s`)
        .join(", ")
  );
}

function tick() {
  const now = Date.now();
  for (const def of listJobs()) {
    const intervalMs = jobIntervalMs(def);
    if (intervalMs <= 0) continue;
    if (runningLocally.has(def.name)) continue;
    const at = nextCheckAt.get(def.name) ?? 0;
    if (at > now) continue;
    // Placeholder until the run reports its real next time.
    nextCheckAt.set(def.name, now + intervalMs);
    void runJob(def.name, { trigger: "schedule" })
      .then((out) => {
        const next = out.nextRunAtMs ?? Date.now() + intervalMs;
        // Re-check no later than one interval from now (another instance may have run it).
        nextCheckAt.set(def.name, Math.min(Math.max(next, Date.now() + 1_000), Date.now() + intervalMs));
      })
      .catch(() => {
        nextCheckAt.set(def.name, Date.now() + intervalMs);
      });
  }
}

export function stopJobScheduler(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  nextCheckAt.clear();
}

// ---------------------------------------------------------------------------
// Admin overview
// ---------------------------------------------------------------------------

export type JobOverview = {
  name: string;
  title: string;
  description: string | null;
  intervalMs: number;
  highlight: string | null;
  status: Record<string, any> | null;
  lock: { leaseUntilMs: number | null; owner: string | null } | null;
};

function plain(v: any): any {
  if (v && typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") {
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) out[k] = plain(val);
    return out;
  }
  return v;
}

export async function getJobsOverview(): Promise<JobOverview[]> {
  const defs = listJobs();
  if (defs.length === 0) return [];
  const statusRefs = defs.map((d) => firestore.collection(JOB_STATUS).doc(d.name));
  const lockRefs = defs.map((d) => firestore.collection(JOB_LOCKS).doc(d.name));
  const snaps = await firestore.getAll(...statusRefs, ...lockRefs);
  return defs.map((d, i) => {
    const s = snaps[i];
    const l = snaps[defs.length + i];
    const lock = l?.exists ? (l.data() as any) : null;
    return {
      name: d.name,
      title: d.title,
      description: d.description || null,
      intervalMs: jobIntervalMs(d),
      highlight: d.highlight || null,
      status: s?.exists ? plain(s.data()) : null,
      lock: lock ? { leaseUntilMs: typeof lock.leaseUntilMs === "number" ? lock.leaseUntilMs : null, owner: lock.owner || null } : null,
    };
  });
}
