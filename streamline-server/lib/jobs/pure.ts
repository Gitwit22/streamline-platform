/**
 * Pure helpers for the scheduled-jobs framework (lib/jobs). No Firestore,
 * no timers: everything here is unit-tested in pure.test.ts.
 */

export type JobRunStatus = "success" | "error" | "skipped";
export type JobTrigger = "schedule" | "cron" | "admin" | "maintenance";

/** jobLocks/{name} */
export type JobLockDoc = {
  leaseUntilMs?: number | null;
  owner?: string | null;
  acquiredAtMs?: number | null;
};

/** The subset of jobStatus/{name} the lease decision reads. */
export type JobStatusTiming = {
  lastStartedAtMs?: number | null;
};

export type LeaseDecision =
  | { action: "run"; leaseUntilMs: number; nextRunAtMs: number }
  | { action: "skip"; reason: "not_due" | "leased"; nextRunAtMs: number; heldBy?: string | null };

/**
 * Small slack so a tick that lands a few ms early (timer drift, clock skew
 * between instances) still counts as due.
 */
export const DUE_SLACK_MS = 5_000;

/**
 * Decide whether `instanceId` may run the job now.
 *
 *   - A live lease held by ANOTHER instance always wins (never two concurrent
 *     runs of one job), even for forced runs.
 *   - A lease held by this same instance is treated as stale (the process
 *     restarted or the previous run finished without releasing it).
 *   - Unforced runs only run when the interval has elapsed since the last
 *     START (across all instances), so N instances still run a job once per
 *     interval.
 */
export function decideLease(input: {
  lock: JobLockDoc | null | undefined;
  status: JobStatusTiming | null | undefined;
  nowMs: number;
  instanceId: string;
  intervalMs: number;
  leaseMs: number;
  force?: boolean;
  slackMs?: number;
}): LeaseDecision {
  const { lock, status, nowMs, instanceId, intervalMs, leaseMs } = input;
  const slack = typeof input.slackMs === "number" ? input.slackMs : DUE_SLACK_MS;
  const leaseUntil = numOrNull(lock?.leaseUntilMs);
  const holder = typeof lock?.owner === "string" ? lock.owner : null;

  if (leaseUntil !== null && leaseUntil > nowMs && holder && holder !== instanceId) {
    return { action: "skip", reason: "leased", nextRunAtMs: leaseUntil, heldBy: holder };
  }

  const lastStart = numOrNull(status?.lastStartedAtMs);
  if (!input.force && lastStart !== null) {
    const dueAt = lastStart + intervalMs;
    if (nowMs + slack < dueAt) {
      return { action: "skip", reason: "not_due", nextRunAtMs: dueAt };
    }
  }

  return { action: "run", leaseUntilMs: nowMs + Math.max(1_000, leaseMs), nextRunAtMs: nowMs + intervalMs };
}

/** Default lease: long enough for a slow run, short enough to recover from a crash. */
export function defaultLeaseMs(intervalMs: number): number {
  return Math.min(15 * 60_000, Math.max(2 * 60_000, intervalMs));
}

// ---------------------------------------------------------------------------
// Run records
// ---------------------------------------------------------------------------

export type JobRunRecord = {
  job: string;
  trigger: JobTrigger;
  startedAtMs: number;
  finishedAtMs: number;
  durationMs: number;
  status: JobRunStatus;
  processed: number;
  details: Record<string, unknown>;
  error: string | null;
  instance: string;
};

export function buildRunRecord(input: {
  job: string;
  trigger: JobTrigger;
  startedAtMs: number;
  finishedAtMs: number;
  status: JobRunStatus;
  processed?: unknown;
  details?: unknown;
  error?: unknown;
  instance: string;
}): JobRunRecord {
  const processed = Number(input.processed);
  return {
    job: input.job,
    trigger: input.trigger,
    startedAtMs: input.startedAtMs,
    finishedAtMs: input.finishedAtMs,
    durationMs: Math.max(0, input.finishedAtMs - input.startedAtMs),
    status: input.status,
    processed: Number.isFinite(processed) && processed > 0 ? Math.floor(processed) : 0,
    details: sanitizeDetails(input.details),
    error: input.error ? errorMessage(input.error) : input.status === "error" ? "unknown_error" : null,
    instance: input.instance,
  };
}

/** Fields written to jobStatus/{name} after a run (counters are deltas). */
export type JobStatusPatch = {
  name: string;
  intervalMs: number;
  lastRunAtMs: number;
  lastFinishedAtMs: number;
  lastStatus: JobRunStatus;
  lastProcessed: number;
  lastDetails: Record<string, unknown>;
  lastError: string | null;
  lastDurationMs: number;
  lastTrigger: JobTrigger;
  lastInstance: string;
  nextRunAtMs: number;
  lastSuccessAtMs?: number;
  runCountDelta: number;
  errorCountDelta: number;
};

export function buildStatusPatch(rec: JobRunRecord, intervalMs: number): JobStatusPatch {
  const patch: JobStatusPatch = {
    name: rec.job,
    intervalMs,
    lastRunAtMs: rec.startedAtMs,
    lastFinishedAtMs: rec.finishedAtMs,
    lastStatus: rec.status,
    lastProcessed: rec.processed,
    lastDetails: rec.details,
    lastError: rec.error,
    lastDurationMs: rec.durationMs,
    lastTrigger: rec.trigger,
    lastInstance: rec.instance,
    nextRunAtMs: rec.startedAtMs + intervalMs,
    runCountDelta: rec.status === "skipped" ? 0 : 1,
    errorCountDelta: rec.status === "error" ? 1 : 0,
  };
  if (rec.status === "success") patch.lastSuccessAtMs = rec.finishedAtMs;
  return patch;
}

export function errorMessage(err: unknown): string {
  if (!err) return "unknown_error";
  const msg = typeof err === "string" ? err : (err as any)?.message || String(err);
  return String(msg).slice(0, 1000);
}

/**
 * Firestore-safe copy of a job's details: JSON round-trip (drops undefined,
 * functions, Dates become ISO strings), long arrays truncated, total size
 * capped so a chatty job can never fail the status write.
 */
export function sanitizeDetails(details: unknown, maxBytes = 8_000): Record<string, unknown> {
  if (!details || typeof details !== "object") return {};
  let json: string;
  try {
    json = JSON.stringify(details, (_k, v) => {
      if (Array.isArray(v) && v.length > 50) return [...v.slice(0, 50), `…+${v.length - 50} more`];
      if (typeof v === "number" && !Number.isFinite(v)) return null;
      return v;
    });
  } catch {
    return { note: "details_unserializable" };
  }
  if (!json) return {};
  if (json.length > maxBytes) return { truncated: true, preview: json.slice(0, maxBytes) };
  const parsed = JSON.parse(json);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { value: parsed };
}

// ---------------------------------------------------------------------------
// Bounded batching
// ---------------------------------------------------------------------------

/** Clamp a caller-supplied limit into [min, max], falling back to `def`. */
export function boundedLimit(value: unknown, def: number, max: number, min = 1): number {
  const n = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** Positive integer env var (ms, days, ...) with a default; "0" allowed when allowZero. */
export function envNumber(raw: string | undefined, def: number, opts: { allowZero?: boolean } = {}): number {
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return def;
  if (n === 0 && !opts.allowZero) return def;
  return n;
}

// ---------------------------------------------------------------------------
// Temporary uploads
// ---------------------------------------------------------------------------

export const UPLOAD_TEMP_PREFIX = "sl_upload_";
export const EXPORT_WORKDIR_PREFIX = "sl_export_";

/**
 * True when a file in os.tmpdir() is one of OUR temp files and is old enough
 * to delete. Only names with a known prefix are ever considered.
 */
export function isExpiredTempEntry(
  name: string,
  mtimeMs: number,
  nowMs: number,
  maxAgeMs: number,
  prefixes: readonly string[] = [UPLOAD_TEMP_PREFIX]
): boolean {
  if (typeof name !== "string" || !name) return false;
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") return false;
  if (!prefixes.some((p) => name.startsWith(p))) return false;
  if (!Number.isFinite(mtimeMs)) return false;
  return nowMs - mtimeMs > maxAgeMs;
}

// ---------------------------------------------------------------------------
// Expired exports
// ---------------------------------------------------------------------------

/** Only render-worker output keys of the job's own user are ever deleted. */
export function isExportOutputKey(key: unknown, userId: unknown): boolean {
  if (typeof key !== "string" || typeof userId !== "string" || !userId) return false;
  return key.startsWith(`exports/${userId}/`) && !key.includes("..");
}

// ---------------------------------------------------------------------------
// Recording maximum-length enforcement
// ---------------------------------------------------------------------------

export type AutoStopDecision =
  | { kind: "unlimited" } //            limit null: no per-clip cap
  | { kind: "not_allowed" } //          limit 0: recording not allowed -> stop now
  | { kind: "at"; autoStopAtMs: number };

/**
 * autoStopAt for a running recording from entitlements
 * `limits.recordingMinutesPerClip` (null = UNLIMITED, 0 = NONE).
 *
 * 0 means the plan has no recording time: /recordings/start already refuses
 * it, so a running recording under a 0 limit (plan changed mid-recording)
 * is stopped immediately by the enforcement job.
 */
export function computeAutoStop(startedAtMs: number | null, limitMinutes: number | null | undefined): AutoStopDecision {
  if (limitMinutes === null || limitMinutes === undefined) return { kind: "unlimited" };
  const lim = Number(limitMinutes);
  if (!Number.isFinite(lim)) return { kind: "unlimited" };
  if (lim <= 0) return { kind: "not_allowed" };
  if (startedAtMs === null || !Number.isFinite(startedAtMs)) return { kind: "unlimited" };
  return { kind: "at", autoStopAtMs: startedAtMs + lim * 60_000 };
}

export function isPastAutoStop(autoStopAtMs: number | null, nowMs: number): boolean {
  return autoStopAtMs !== null && Number.isFinite(autoStopAtMs) && autoStopAtMs <= nowMs;
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : v === null || v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}
