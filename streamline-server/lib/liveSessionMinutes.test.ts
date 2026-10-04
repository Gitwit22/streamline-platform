import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAX_SESSION_MS,
  MINUTE_MS,
  isLargeMinutesDiscrepancy,
  mergeIntervals,
  minutesFromMs,
  planLiveSessionBilling,
  subtractedMs,
  toEpochMs,
} from "./liveSessionMinutes";

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const OWNER = "owner-1";
const min = (n: number) => n * MINUTE_MS;

test("toEpochMs handles Date, millis, ISO, Timestamp-like and junk", () => {
  assert.equal(toEpochMs(new Date(NOW)), NOW);
  assert.equal(toEpochMs(NOW), NOW);
  assert.equal(toEpochMs(new Date(NOW).toISOString()), NOW);
  assert.equal(toEpochMs({ toMillis: () => NOW }), NOW);
  assert.equal(toEpochMs({ toDate: () => new Date(NOW) }), NOW);
  assert.equal(toEpochMs(null), null);
  assert.equal(toEpochMs(undefined), null);
  assert.equal(toEpochMs("not a date"), null);
  assert.equal(toEpochMs(-5), null);
});

test("minutesFromMs ceils partial minutes and returns 0 for no time", () => {
  assert.equal(minutesFromMs(0), 0);
  assert.equal(minutesFromMs(-1), 0);
  assert.equal(minutesFromMs(1), 1);
  assert.equal(minutesFromMs(min(1)), 1);
  assert.equal(minutesFromMs(min(1) + 1), 2);
  assert.equal(minutesFromMs(Number.NaN), 0);
});

test("mergeIntervals / subtractedMs compute unions and differences", () => {
  assert.deepEqual(
    mergeIntervals([
      { startMs: 10, endMs: 20 },
      { startMs: 0, endMs: 5 },
      { startMs: 15, endMs: 30 },
      { startMs: 40, endMs: 40 },
    ]),
    [
      { startMs: 0, endMs: 5 },
      { startMs: 10, endMs: 30 },
    ]
  );
  assert.equal(subtractedMs([{ startMs: 0, endMs: 100 }], [{ startMs: 20, endMs: 30 }, { startMs: 90, endMs: 200 }]), 80);
  assert.equal(subtractedMs([{ startMs: 0, endMs: 100 }], []), 100);
});

test("ended session is billed from server startedAt to endedAt", () => {
  const plan = planLiveSessionBilling(
    [{ id: "e1", uid: OWNER, kind: "multistream", startedAt: new Date(NOW - min(30)), endedAt: new Date(NOW - min(5) - 1000) }],
    { ownerUid: OWNER, nowMs: NOW }
  );
  // 24m59s -> 25 minutes
  assert.equal(plan.minutes, 25);
  assert.equal(plan.sessionsToMark.length, 1);
  assert.equal(plan.sessionsToMark[0].openEnded, false);
});

test("open-ended session is closed at now", () => {
  const plan = planLiveSessionBilling([{ id: "e1", uid: OWNER, startedAt: NOW - min(10) }], { ownerUid: OWNER, nowMs: NOW });
  assert.equal(plan.minutes, 10);
  assert.equal(plan.sessionsToMark[0].openEnded, true);
  assert.equal(plan.sessionsToMark[0].endMs, NOW);
});

test("already counted sessions are not billed again (idempotent)", () => {
  const plan = planLiveSessionBilling(
    [
      {
        id: "e1",
        uid: OWNER,
        startedAt: NOW - min(30),
        endedAt: NOW - min(10),
        liveCountedAt: new Date(NOW - min(9)),
        liveBilledStartMs: NOW - min(30),
        liveBilledEndMs: NOW - min(10),
      },
    ],
    { ownerUid: OWNER, nowMs: NOW }
  );
  assert.equal(plan.minutes, 0);
  assert.equal(plan.sessionsToMark.length, 0);
  assert.deepEqual(plan.skipped, [{ id: "e1", reason: "already_counted" }]);
});

test("concurrent egresses (normal + instagram) are billed once as wall-clock time", () => {
  const plan = planLiveSessionBilling(
    [
      { id: "normal", uid: OWNER, startedAt: NOW - min(20), endedAt: NOW },
      { id: "insta", uid: OWNER, startedAt: NOW - min(20), endedAt: NOW - min(2) },
    ],
    { ownerUid: OWNER, nowMs: NOW }
  );
  assert.equal(plan.minutes, 20);
  assert.equal(plan.sessionsToMark.length, 2);
});

test("overlap with an already-billed interval is subtracted", () => {
  const plan = planLiveSessionBilling(
    [
      {
        id: "a",
        uid: OWNER,
        startedAt: NOW - min(20),
        endedAt: NOW - min(10),
        liveCountedAt: true,
        liveBilledStartMs: NOW - min(20),
        liveBilledEndMs: NOW - min(10),
      },
      { id: "b", uid: OWNER, startedAt: NOW - min(15), endedAt: NOW },
    ],
    { ownerUid: OWNER, nowMs: NOW }
  );
  assert.equal(plan.minutes, 10);
});

test("two sequential streams in one room are both billed", () => {
  const plan = planLiveSessionBilling(
    [
      { id: "a", uid: OWNER, startedAt: NOW - min(60), endedAt: NOW - min(50) },
      { id: "b", uid: OWNER, startedAt: NOW - min(20), endedAt: NOW - min(5) },
    ],
    { ownerUid: OWNER, nowMs: NOW }
  );
  assert.equal(plan.minutes, 25);
});

test("guards: wrong uid, non-multistream, missing start, future start, lookback, cutover", () => {
  const plan = planLiveSessionBilling(
    [
      { id: "u", uid: "someone-else", startedAt: NOW - min(5) },
      { id: "k", uid: OWNER, kind: "hls", startedAt: NOW - min(5) },
      { id: "s", uid: OWNER },
      { id: "f", uid: OWNER, startedAt: NOW + min(5) },
      { id: "old", uid: OWNER, startedAt: NOW - 3 * 24 * 60 * MINUTE_MS, endedAt: NOW - 3 * 24 * 60 * MINUTE_MS + min(5) },
      { id: "pre", uid: OWNER, startedAt: NOW - min(30), endedAt: NOW - min(20) },
    ],
    { ownerUid: OWNER, nowMs: NOW, cutoverMs: NOW - min(25) }
  );
  assert.equal(plan.minutes, 0);
  assert.deepEqual(
    plan.skipped.map((s) => s.reason),
    ["uid_mismatch", "not_multistream", "no_start", "start_in_future", "outside_lookback", "before_cutover"]
  );
});

test("never-ended session is clamped to maxSessionMs", () => {
  const plan = planLiveSessionBilling([{ id: "x", uid: OWNER, startedAt: NOW - min(300) }], {
    ownerUid: OWNER,
    nowMs: NOW,
    maxSessionMs: min(120),
  });
  assert.equal(plan.minutes, 120);
  assert.equal(plan.sessionsToMark[0].clamped, true);
  assert.ok(DEFAULT_MAX_SESSION_MS >= min(120));
});

test("endedAt after now is capped at now; client minutes ignored", () => {
  const plan = planLiveSessionBilling([{ id: "x", uid: OWNER, startedAt: NOW - min(3), endedAt: NOW + min(60) }], {
    ownerUid: OWNER,
    nowMs: NOW,
  });
  assert.equal(plan.minutes, 3);
});

test("isLargeMinutesDiscrepancy flags big gaps only", () => {
  assert.equal(isLargeMinutesDiscrepancy(10, 10), false);
  assert.equal(isLargeMinutesDiscrepancy(13, 10), false);
  assert.equal(isLargeMinutesDiscrepancy(600, 10), true);
  assert.equal(isLargeMinutesDiscrepancy(undefined, 10), false);
  assert.equal(isLargeMinutesDiscrepancy(130, 100), true);
});
