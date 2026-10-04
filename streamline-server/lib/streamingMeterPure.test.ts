import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_INTERVAL_MS,
  MINUTE_MS,
  evaluateStreamingGate,
  billableOverageMinutes,
  isLegacyBilledSession,
  legacyStreamingSeed,
  mergeIntervals,
  minutesFromMs,
  monthKeyUTC,
  nextMonthlyResetUTC,
  normalizeOutputKind,
  parseCutoverIso,
  planSegmentBilling,
  pruneCovered,
  readCovered,
  readStreamingMinutes,
  recordingBilledMinutes,
  shouldStopForMonthlyLimit,
  shouldStopForSessionCap,
  subtractedMs,
  toEpochMs,
  type OutputIntervalState,
  type RoomMeterState,
} from "./streamingMeterPure";

const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const min = (n: number) => n * MINUTE_MS;
const at = (m: number) => T0 + min(m);

const emptyRoom = (): RoomMeterState => ({ covered: [], coveredMs: 0, billedMinutes: 0 });
const iv = (startMin: number, endMin: number | null, dest = 1, extra: Partial<OutputIntervalState> = {}): OutputIntervalState => ({
  startMs: at(startMin),
  endMs: endMin === null ? null : at(endMin),
  billedUntilMs: null,
  destinations: dest,
  ownMinutesBilled: 0,
  destinationMinutesBilled: 0,
  ...extra,
});

/** Bill a list of closed intervals in order against one room; returns totals. */
function billAll(intervals: OutputIntervalState[], nowMin = 200) {
  let room = emptyRoom();
  let streaming = 0;
  let destination = 0;
  for (const i of intervals) {
    const p = planSegmentBilling(i, room, { untilMs: i.endMs ?? at(nowMin), nowMs: at(nowMin) });
    room = p.nextRoom;
    streaming += p.streamingMinutesDelta;
    destination += p.destinationMinutesDelta;
  }
  return { streaming, destination, room };
}

// ---------------------------------------------------------------------------
// Interval math
// ---------------------------------------------------------------------------

test("toEpochMs handles Date, millis, ns/µs numbers, numeric strings, bigint ns, Timestamp-like and junk", () => {
  assert.equal(toEpochMs(new Date(T0)), T0);
  assert.equal(toEpochMs(T0), T0);
  assert.equal(toEpochMs(T0 * 1_000_000), T0); // ns
  assert.equal(toEpochMs(T0 * 1_000), T0); // µs
  assert.equal(toEpochMs(String(T0 * 1_000_000)), T0);
  assert.equal(toEpochMs(BigInt(T0) * BigInt(1_000_000)), T0);
  assert.equal(toEpochMs(new Date(T0).toISOString()), T0);
  assert.equal(toEpochMs({ toMillis: () => T0 }), T0);
  assert.equal(toEpochMs({ toDate: () => new Date(T0) }), T0);
  assert.equal(toEpochMs(null), null);
  assert.equal(toEpochMs("nope"), null);
  assert.equal(toEpochMs(-1), null);
});

test("minutesFromMs ceils partial minutes", () => {
  assert.equal(minutesFromMs(0), 0);
  assert.equal(minutesFromMs(1), 1);
  assert.equal(minutesFromMs(min(1)), 1);
  assert.equal(minutesFromMs(min(1) + 1), 2);
});

test("mergeIntervals / subtractedMs compute unions and differences", () => {
  assert.deepEqual(
    mergeIntervals([
      { startMs: 10, endMs: 20 },
      { startMs: 0, endMs: 5 },
      { startMs: 15, endMs: 30 },
      { startMs: 30, endMs: 31 },
    ]),
    [
      { startMs: 0, endMs: 5 },
      { startMs: 10, endMs: 31 },
    ]
  );
  assert.equal(subtractedMs([{ startMs: 0, endMs: 100 }], [{ startMs: 20, endMs: 50 }]), 70);
  assert.equal(subtractedMs([{ startMs: 0, endMs: 100 }], []), 100);
});

// ---------------------------------------------------------------------------
// Union billing (product rule)
// ---------------------------------------------------------------------------

test("60-min show to YouTube+Facebook+Twitch (one egress, 3 dests) + Instagram + HLS = 60 streaming minutes", () => {
  const rtmp = iv(0, 60, 3); // youtube, facebook, twitch on one egress
  const instagram = iv(0, 60, 1);
  const hls = iv(0, 60, 1);
  const r = billAll([rtmp, instagram, hls]);
  assert.equal(r.streaming, 60, "outputs overlap: counted once");
  assert.equal(r.destination, 60 * 5, "destination minutes = duration x destinations (analytics)");
});

test("multiple destinations are never multiplied into streaming minutes", () => {
  const r = billAll([iv(0, 30, 10)]);
  assert.equal(r.streaming, 30);
  assert.equal(r.destination, 300);
});

test("partially overlapping outputs count their union", () => {
  // RTMP 0-40, HLS 30-70 => union 0-70
  const r = billAll([iv(0, 40), iv(30, 70)]);
  assert.equal(r.streaming, 70);
});

test("disjoint outputs in the same room add up; a room open with no output adds nothing", () => {
  const r = billAll([iv(0, 10), iv(100, 115)]);
  assert.equal(r.streaming, 25);
  assert.equal(billAll([]).streaming, 0);
});

test("incremental (sweep) billing then close bills exactly the duration, with no rounding inflation", () => {
  let room = emptyRoom();
  let state = iv(0, null, 2);
  let streaming = 0;
  let destination = 0;
  // Sweep every 2.5 minutes for 20 minutes while running.
  for (let t = 2.5; t <= 20; t += 2.5) {
    const p = planSegmentBilling(state, room, { untilMs: at(t), nowMs: at(t) });
    room = p.nextRoom;
    streaming += p.streamingMinutesDelta;
    destination += p.destinationMinutesDelta;
    state = {
      ...state,
      billedUntilMs: p.billedUntilMs,
      ownMinutesBilled: p.nextOwnMinutesBilled,
      destinationMinutesBilled: p.nextDestinationMinutesBilled,
    };
  }
  // Close at 21.25 min.
  const close = planSegmentBilling({ ...state, endMs: at(21.25) }, room, { untilMs: at(21.25), nowMs: at(22) });
  streaming += close.streamingMinutesDelta;
  destination += close.destinationMinutesDelta;
  assert.equal(streaming, 22); // ceil(21.25)
  assert.equal(destination, 43); // ceil(21.25 * 2)
});

test("re-billing the same interval (repeated close / webhook after stop) adds nothing", () => {
  const room0 = emptyRoom();
  const i = iv(0, 45);
  const first = planSegmentBilling(i, room0, { untilMs: at(45), nowMs: at(50) });
  assert.equal(first.streamingMinutesDelta, 45);
  const again = planSegmentBilling(
    { ...i, billedUntilMs: first.billedUntilMs, ownMinutesBilled: first.nextOwnMinutesBilled, destinationMinutesBilled: first.nextDestinationMinutesBilled },
    first.nextRoom,
    { untilMs: at(45), nowMs: at(60) }
  );
  assert.equal(again.streamingMinutesDelta, 0);
  assert.equal(again.destinationMinutesDelta, 0);
  assert.equal(again.segment, null);
});

test("an overlapping output closed later only bills the part not already covered", () => {
  const a = planSegmentBilling(iv(0, 30), emptyRoom(), { untilMs: at(30), nowMs: at(30) });
  assert.equal(a.streamingMinutesDelta, 30);
  // second output 10..50: 10..30 already covered => 20 new minutes
  const b = planSegmentBilling(iv(10, 50), a.nextRoom, { untilMs: at(50), nowMs: at(50) });
  assert.equal(b.streamingMinutesDelta, 20);
  assert.equal(b.ownMinutesDelta, 40, "own (per output type) time is the output's own duration");
});

test("open interval is billed only up to now; future end is clamped", () => {
  const p = planSegmentBilling(iv(0, null), emptyRoom(), { untilMs: at(500), nowMs: at(12) });
  assert.equal(p.streamingMinutesDelta, 12);
  assert.equal(p.billedUntilMs, at(12));
});

test("a never-ended interval is capped at MAX_INTERVAL_MS and flagged clamped", () => {
  const p = planSegmentBilling(iv(0, null), emptyRoom(), { untilMs: at(3000), nowMs: at(3000) });
  assert.equal(p.clamped, true);
  assert.equal(p.streamingMinutesDelta, MAX_INTERVAL_MS / MINUTE_MS);
});

test("cutover: time before the cutover is never billed", () => {
  const cutoverMs = at(20);
  const p = planSegmentBilling(iv(0, 50, 2), emptyRoom(), { untilMs: at(50), nowMs: at(60), cutoverMs });
  assert.equal(p.streamingMinutesDelta, 30);
  assert.equal(p.destinationMinutesDelta, 60);
  const before = planSegmentBilling(iv(0, 10), emptyRoom(), { untilMs: at(10), nowMs: at(60), cutoverMs });
  assert.equal(before.streamingMinutesDelta, 0);
  assert.equal(before.skippedReason, "before_cutover");
});

test("interval without a start bills nothing", () => {
  const p = planSegmentBilling({ ...iv(0, 10), startMs: null }, emptyRoom(), { untilMs: at(10), nowMs: at(10) });
  assert.equal(p.streamingMinutesDelta, 0);
  assert.equal(p.skippedReason, "no_start");
});

test("legacy sessions billed by the old model are skipped", () => {
  assert.equal(isLegacyBilledSession({ countedAt: new Date() }), true);
  assert.equal(isLegacyBilledSession({ liveCountedAt: new Date() }), true);
  assert.equal(isLegacyBilledSession({ meterVersion: 2, countedAt: new Date() }), false);
  assert.equal(isLegacyBilledSession({}), false);
});

test("readCovered / pruneCovered sanitize and bound the room union", () => {
  assert.deepEqual(readCovered([{ startMs: 5, endMs: 10 }, { startMs: 0, endMs: 6 }, { bogus: 1 }]), [{ startMs: 0, endMs: 10 }]);
  const old = { startMs: at(-10_000), endMs: at(-9_000) };
  const recent = { startMs: at(0), endMs: at(5) };
  assert.deepEqual(pruneCovered([old, recent], at(10)), [recent]);
});

test("normalizeOutputKind", () => {
  assert.equal(normalizeOutputKind("hls"), "hls");
  assert.equal(normalizeOutputKind("multistream", "instagram"), "instagram");
  assert.equal(normalizeOutputKind(undefined), "multistream");
});

// ---------------------------------------------------------------------------
// Monthly reading + gate
// ---------------------------------------------------------------------------

test("readStreamingMinutes prefers usage.streamingMinutes, falls back to old live + hls", () => {
  assert.equal(readStreamingMinutes({ usage: { streamingMinutes: 42, participantMinutes: 999 } }), 42);
  assert.equal(readStreamingMinutes({ usage: { minutes: { live: { currentPeriod: 30 } }, hlsMinutes: 12, transcodeMinutes: 500 } }), 42);
  assert.equal(readStreamingMinutes({}), 0);
  assert.equal(legacyStreamingSeed(null), 0);
});

test("gate: unlimited when plan has no monthly minutes", () => {
  const d = evaluateStreamingGate({ usedMinutes: 99999, includedMinutes: 0, planAllowsOverages: false, overagesEnabled: false });
  assert.equal(d.allowed, true);
  assert.equal(d.unlimited, true);
  assert.equal(d.limitMinutes, null);
  assert.equal(d.remainingMinutes, null);
});

test("gate: bonus minutes extend the monthly limit", () => {
  const blocked = evaluateStreamingGate({ usedMinutes: 180, includedMinutes: 180, planAllowsOverages: false, overagesEnabled: false });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "usage_exhausted");
  assert.equal(blocked.requiresUpgrade, true);
  const withBonus = evaluateStreamingGate({ usedMinutes: 180, includedMinutes: 180, bonusMinutes: 60, planAllowsOverages: false, overagesEnabled: false });
  assert.equal(withBonus.allowed, true);
  assert.equal(withBonus.limitMinutes, 240);
  assert.equal(withBonus.remainingMinutes, 60);
});

test("gate: overages need both plan permission AND user opt-in", () => {
  const notOptedIn = evaluateStreamingGate({ usedMinutes: 700, includedMinutes: 600, planAllowsOverages: true, overagesEnabled: false });
  assert.equal(notOptedIn.allowed, false);
  assert.equal(notOptedIn.requiresOveragesEnabled, true);
  assert.equal(notOptedIn.requiresUpgrade, false);
  assert.equal(billableOverageMinutes(notOptedIn), 0);

  const optedIn = evaluateStreamingGate({ usedMinutes: 700, includedMinutes: 600, planAllowsOverages: true, overagesEnabled: true });
  assert.equal(optedIn.allowed, true);
  assert.equal(optedIn.overagesActive, true);
  assert.equal(billableOverageMinutes(optedIn), 100);

  const planDisallows = evaluateStreamingGate({ usedMinutes: 700, includedMinutes: 600, planAllowsOverages: false, overagesEnabled: true });
  assert.equal(planDisallows.allowed, false);
});

test("mid-session monthly stop only after the grace period and never with active overages", () => {
  const at181 = evaluateStreamingGate({ usedMinutes: 181, includedMinutes: 180, planAllowsOverages: false, overagesEnabled: false });
  assert.equal(shouldStopForMonthlyLimit(at181, 2), false);
  const at182 = evaluateStreamingGate({ usedMinutes: 182, includedMinutes: 180, planAllowsOverages: false, overagesEnabled: false });
  assert.equal(shouldStopForMonthlyLimit(at182, 2), true);
  const overage = evaluateStreamingGate({ usedMinutes: 9999, includedMinutes: 180, planAllowsOverages: true, overagesEnabled: true });
  assert.equal(shouldStopForMonthlyLimit(overage, 2), false);
  const unlimited = evaluateStreamingGate({ usedMinutes: 9999, includedMinutes: 0, planAllowsOverages: false, overagesEnabled: false });
  assert.equal(shouldStopForMonthlyLimit(unlimited, 2), false);
});

test("maxSessionMinutes cap (0 = none) with grace", () => {
  assert.equal(shouldStopForSessionCap({ sessionStartMs: at(0), nowMs: at(61), maxSessionMinutes: 60, graceMinutes: 2 }), false);
  assert.equal(shouldStopForSessionCap({ sessionStartMs: at(0), nowMs: at(62), maxSessionMinutes: 60, graceMinutes: 2 }), true);
  assert.equal(shouldStopForSessionCap({ sessionStartMs: at(0), nowMs: at(9999), maxSessionMinutes: 0 }), false);
  assert.equal(shouldStopForSessionCap({ sessionStartMs: null, nowMs: at(9999), maxSessionMinutes: 60 }), false);
});

// ---------------------------------------------------------------------------
// Reset rules (UTC calendar month)
// ---------------------------------------------------------------------------

test("usage month is the UTC calendar month (resets on the 1st, 00:00 UTC)", () => {
  assert.equal(monthKeyUTC(new Date(Date.UTC(2026, 9, 31, 23, 59, 59))), "2026-10");
  assert.equal(monthKeyUTC(new Date(Date.UTC(2026, 10, 1, 0, 0, 0))), "2026-11");
  assert.equal(monthKeyUTC(new Date(Date.UTC(2026, 11, 31, 23, 0, 0))), "2026-12");
  assert.equal(nextMonthlyResetUTC(new Date(Date.UTC(2026, 11, 15))).toISOString(), "2027-01-01T00:00:00.000Z");
  assert.equal(nextMonthlyResetUTC(new Date(Date.UTC(2026, 9, 4, 12))).toISOString(), "2026-11-01T00:00:00.000Z");
});

test("parseCutoverIso", () => {
  assert.equal(parseCutoverIso(""), null);
  assert.equal(parseCutoverIso(undefined), null);
  assert.equal(parseCutoverIso("garbage"), null);
  assert.equal(parseCutoverIso("2026-10-04T12:00:00Z"), T0);
});

test("recording minutes bill [startedAt, endedAt], not processing time", () => {
  assert.deepEqual(recordingBilledMinutes(new Date(at(0)), new Date(at(10.5))), { minutes: 11, durationMs: min(10.5) });
  assert.deepEqual(recordingBilledMinutes(null, new Date(at(5))), { minutes: 0, durationMs: 0 });
  assert.deepEqual(recordingBilledMinutes(new Date(at(5)), new Date(at(5))), { minutes: 0, durationMs: 0 });
});
