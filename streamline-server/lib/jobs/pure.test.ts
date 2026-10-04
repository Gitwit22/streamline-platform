import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPORT_WORKDIR_PREFIX,
  UPLOAD_TEMP_PREFIX,
  boundedLimit,
  buildRunRecord,
  buildStatusPatch,
  chunk,
  computeAutoStop,
  decideLease,
  defaultLeaseMs,
  envNumber,
  isExpiredTempEntry,
  isExportOutputKey,
  isPastAutoStop,
  sanitizeDetails,
} from "./pure.js";

const MIN = 60_000;
const NOW = Date.parse("2026-10-04T10:00:00Z");
const base = { nowMs: NOW, instanceId: "A", intervalMs: 60 * MIN, leaseMs: 15 * MIN };

// ---------------------------------------------------------------------------
// Lease lock decision
// ---------------------------------------------------------------------------

test("decideLease: first run (no lock, no status) runs and takes a lease", () => {
  const d = decideLease({ ...base, lock: null, status: null });
  assert.equal(d.action, "run");
  if (d.action === "run") {
    assert.equal(d.leaseUntilMs, NOW + 15 * MIN);
    assert.equal(d.nextRunAtMs, NOW + 60 * MIN);
  }
});

test("decideLease: a live lease held by another instance blocks, even when forced", () => {
  const lock = { leaseUntilMs: NOW + MIN, owner: "B" };
  for (const force of [false, true]) {
    const d = decideLease({ ...base, lock, status: null, force });
    assert.equal(d.action, "skip");
    if (d.action === "skip") {
      assert.equal(d.reason, "leased");
      assert.equal(d.heldBy, "B");
      assert.equal(d.nextRunAtMs, NOW + MIN);
    }
  }
});

test("decideLease: an expired lease (crashed instance) is taken over", () => {
  const d = decideLease({ ...base, lock: { leaseUntilMs: NOW - 1, owner: "B" }, status: { lastStartedAtMs: NOW - 2 * 60 * MIN } });
  assert.equal(d.action, "run");
});

test("decideLease: own stale lease does not block this instance", () => {
  const d = decideLease({ ...base, lock: { leaseUntilMs: NOW + MIN, owner: "A" }, status: null });
  assert.equal(d.action, "run");
});

test("decideLease: not due until the interval elapsed since the last start on any instance", () => {
  const status = { lastStartedAtMs: NOW - 30 * MIN };
  const d = decideLease({ ...base, lock: null, status });
  assert.equal(d.action, "skip");
  if (d.action === "skip") {
    assert.equal(d.reason, "not_due");
    assert.equal(d.nextRunAtMs, NOW + 30 * MIN);
  }
  // Forced (admin "Run now" / maintenance endpoint) ignores the interval.
  assert.equal(decideLease({ ...base, lock: null, status, force: true }).action, "run");
  // Due exactly at the interval, and within the slack just before it.
  assert.equal(decideLease({ ...base, lock: null, status: { lastStartedAtMs: NOW - 60 * MIN } }).action, "run");
  assert.equal(decideLease({ ...base, lock: null, status: { lastStartedAtMs: NOW - 60 * MIN + 2_000 } }).action, "run");
  assert.equal(decideLease({ ...base, lock: null, status: { lastStartedAtMs: NOW - 60 * MIN + 10_000 } }).action, "skip");
});

test("decideLease: garbage lock/status fields are ignored", () => {
  const d = decideLease({ ...base, lock: { leaseUntilMs: "soon" as any, owner: 5 as any }, status: { lastStartedAtMs: null } });
  assert.equal(d.action, "run");
});

test("defaultLeaseMs is between 2 and 15 minutes", () => {
  assert.equal(defaultLeaseMs(MIN), 2 * MIN);
  assert.equal(defaultLeaseMs(5 * MIN), 5 * MIN);
  assert.equal(defaultLeaseMs(24 * 60 * MIN), 15 * MIN);
});

// ---------------------------------------------------------------------------
// Run record / status shape
// ---------------------------------------------------------------------------

test("buildRunRecord: success shape", () => {
  const rec = buildRunRecord({
    job: "media-purge",
    trigger: "schedule",
    startedAtMs: NOW,
    finishedAtMs: NOW + 1234,
    status: "success",
    processed: 42,
    details: { deleted: 42, skip: undefined },
    instance: "A",
  });
  assert.deepEqual(rec, {
    job: "media-purge",
    trigger: "schedule",
    startedAtMs: NOW,
    finishedAtMs: NOW + 1234,
    durationMs: 1234,
    status: "success",
    processed: 42,
    details: { deleted: 42 },
    error: null,
    instance: "A",
  });
});

test("buildRunRecord: error keeps the message, bad processed becomes 0", () => {
  const rec = buildRunRecord({
    job: "x1",
    trigger: "admin",
    startedAtMs: NOW,
    finishedAtMs: NOW - 5,
    status: "error",
    processed: "nope",
    error: new Error("boom"),
    instance: "A",
  });
  assert.equal(rec.error, "boom");
  assert.equal(rec.processed, 0);
  assert.equal(rec.durationMs, 0);
  assert.equal(buildRunRecord({ job: "x1", trigger: "cron", startedAtMs: 0, finishedAtMs: 0, status: "error", instance: "A" }).error, "unknown_error");
});

test("buildStatusPatch: counters and next run", () => {
  const ok = buildRunRecord({ job: "j1", trigger: "schedule", startedAtMs: NOW, finishedAtMs: NOW + 10, status: "success", processed: 1, instance: "A" });
  const p = buildStatusPatch(ok, 5 * MIN);
  assert.equal(p.lastStatus, "success");
  assert.equal(p.lastRunAtMs, NOW);
  assert.equal(p.nextRunAtMs, NOW + 5 * MIN);
  assert.equal(p.runCountDelta, 1);
  assert.equal(p.errorCountDelta, 0);
  assert.equal(p.lastSuccessAtMs, NOW + 10);
  assert.equal(p.lastProcessed, 1);

  const bad = buildRunRecord({ job: "j1", trigger: "schedule", startedAtMs: NOW, finishedAtMs: NOW, status: "error", error: "x", instance: "A" });
  const pb = buildStatusPatch(bad, 5 * MIN);
  assert.equal(pb.errorCountDelta, 1);
  assert.equal(pb.lastError, "x");
  assert.equal(pb.lastSuccessAtMs, undefined);

  const skip = buildRunRecord({ job: "j1", trigger: "admin", startedAtMs: NOW, finishedAtMs: NOW, status: "skipped", instance: "A" });
  assert.equal(buildStatusPatch(skip, MIN).runCountDelta, 0);
});

test("sanitizeDetails: Firestore-safe, bounded", () => {
  assert.deepEqual(sanitizeDetails(null), {});
  assert.deepEqual(sanitizeDetails({ a: 1, b: undefined, c: NaN, d: new Date(NOW) }), { a: 1, c: null, d: new Date(NOW).toISOString() });
  const long = sanitizeDetails({ ids: Array.from({ length: 60 }, (_, i) => i) });
  assert.equal((long.ids as unknown[]).length, 51);
  const big = sanitizeDetails({ s: "x".repeat(20_000) });
  assert.equal(big.truncated, true);
  const cyc: any = { a: 1 };
  cyc.self = cyc;
  assert.deepEqual(sanitizeDetails(cyc), { note: "details_unserializable" });
});

// ---------------------------------------------------------------------------
// Bounded batching helpers
// ---------------------------------------------------------------------------

test("boundedLimit clamps and defaults", () => {
  assert.equal(boundedLimit(undefined, 200, 500), 200);
  assert.equal(boundedLimit("", 200, 500), 200);
  assert.equal(boundedLimit("abc", 200, 500), 200);
  assert.equal(boundedLimit(10_000, 200, 500), 500);
  assert.equal(boundedLimit(0, 200, 500), 1);
  assert.equal(boundedLimit(-5, 200, 500), 1);
  assert.equal(boundedLimit("42.9", 200, 500), 42);
});

test("chunk splits into bounded batches", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 400), []);
  assert.deepEqual(chunk([1, 2], 0), [[1], [2]]);
});

test("envNumber", () => {
  assert.equal(envNumber(undefined, 30), 30);
  assert.equal(envNumber("7", 30), 7);
  assert.equal(envNumber("0", 30), 30);
  assert.equal(envNumber("0", 30, { allowZero: true }), 0);
  assert.equal(envNumber("-1", 30), 30);
  assert.equal(envNumber("x", 30), 30);
});

// ---------------------------------------------------------------------------
// Temp upload age filter
// ---------------------------------------------------------------------------

test("isExpiredTempEntry: only our prefixed files older than the max age", () => {
  const H = 60 * MIN;
  assert.equal(isExpiredTempEntry(`${UPLOAD_TEMP_PREFIX}1_abc`, NOW - 3 * H, NOW, 2 * H), true);
  assert.equal(isExpiredTempEntry(`${UPLOAD_TEMP_PREFIX}1_abc`, NOW - H, NOW, 2 * H), false);
  assert.equal(isExpiredTempEntry(`${UPLOAD_TEMP_PREFIX}1_abc`, NOW - 2 * H, NOW, 2 * H), false); // exactly at the limit
  assert.equal(isExpiredTempEntry("someone_else.tmp", NOW - 10 * H, NOW, 2 * H), false);
  assert.equal(isExpiredTempEntry(`${EXPORT_WORKDIR_PREFIX}job`, NOW - 10 * H, NOW, 2 * H), false); // not in prefixes
  assert.equal(isExpiredTempEntry(`${EXPORT_WORKDIR_PREFIX}job`, NOW - 10 * H, NOW, 2 * H, [EXPORT_WORKDIR_PREFIX]), true);
  assert.equal(isExpiredTempEntry(`${UPLOAD_TEMP_PREFIX}../etc`, NOW - 10 * H, NOW, 2 * H), false);
  assert.equal(isExpiredTempEntry(`${UPLOAD_TEMP_PREFIX}x`, NaN, NOW, 2 * H), false);
  assert.equal(isExpiredTempEntry("", NOW - 10 * H, NOW, 2 * H), false);
});

// ---------------------------------------------------------------------------
// autoStopAt from limits.recordingMinutesPerClip
// ---------------------------------------------------------------------------

test("computeAutoStop: null = unlimited, 0 = not allowed, N = startedAt + N min", () => {
  assert.deepEqual(computeAutoStop(NOW, null), { kind: "unlimited" });
  assert.deepEqual(computeAutoStop(NOW, undefined), { kind: "unlimited" });
  assert.deepEqual(computeAutoStop(NOW, 0), { kind: "not_allowed" });
  assert.deepEqual(computeAutoStop(null, 0), { kind: "not_allowed" });
  assert.deepEqual(computeAutoStop(NOW, 30), { kind: "at", autoStopAtMs: NOW + 30 * MIN });
  // No start time: cannot place a deadline, treated as not capped this run.
  assert.deepEqual(computeAutoStop(null, 30), { kind: "unlimited" });
  assert.deepEqual(computeAutoStop(NOW, Number.NaN), { kind: "unlimited" });
});

test("isPastAutoStop", () => {
  assert.equal(isPastAutoStop(null, NOW), false);
  assert.equal(isPastAutoStop(NOW, NOW), true);
  assert.equal(isPastAutoStop(NOW + 1, NOW), false);
  assert.equal(isPastAutoStop(NOW - 1, NOW), true);
});

test("isExportOutputKey: only the owner's exports/ keys", () => {
  assert.equal(isExportOutputKey("exports/u1/p1/1.mp4", "u1"), true);
  assert.equal(isExportOutputKey("exports/u2/p1/1.mp4", "u1"), false);
  assert.equal(isExportOutputKey("my-content/u1/x.mp4", "u1"), false);
  assert.equal(isExportOutputKey("recordings/u1/x.mp4", "u1"), false);
  assert.equal(isExportOutputKey("exports/u1/../u2/x.mp4", "u1"), false);
  assert.equal(isExportOutputKey("exports/u1/p/x.mp4", ""), false);
  assert.equal(isExportOutputKey(null, "u1"), false);
});
