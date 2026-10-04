import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStreamSummary,
  computeWatchStats,
  destinationLabel,
  egressOutcomeFields,
  egressStatusName,
  outputStatusFor,
  outputsForSession,
  readStoredSummary,
  redactEgressError,
  sessionDurationSec,
  storedSummaryFrom,
  summarizeOutput,
  watchSecondsFor,
} from "./streamSummaryPure";
import { newViewerStats } from "./viewerStatsPure";

const T0 = 1_700_000_000_000;
const SESSION = { sessionId: "s1", startedAt: T0, endedAt: T0 + 3_600_000 };

test("watchSecondsFor clamps to the session window and rejects unknown ends", () => {
  assert.equal(watchSecondsFor(T0, T0 + 90_000, SESSION), 90);
  assert.equal(watchSecondsFor(T0 - 60_000, T0 + 30_000, SESSION), 30); // before session start
  assert.equal(watchSecondsFor(T0 + 3_500_000, T0 + 4_000_000, SESSION), 100); // past session end
  assert.equal(watchSecondsFor(T0, null, SESSION), null);
  assert.equal(watchSecondsFor(null, T0, SESSION), null);
  assert.equal(watchSecondsFor(T0 + 10, T0 + 10, SESSION), null);
  // Live session: no upper clamp.
  assert.equal(watchSecondsFor(T0, T0 + 7_200_000, { startedAt: T0, endedAt: null }), 7200);
});

test("computeWatchStats averages only measured viewers (partial data)", () => {
  const stats = computeWatchStats({
    session: SESSION,
    viewers: [
      // RTC viewer with a leave from participant_left: 120s.
      { key: "rtc:alice", kind: "rtc", firstSeenAt: T0 + 60_000, lastSeenAt: T0 + 180_000, leftAt: T0 + 180_000 },
      // RTC viewer never seen leaving (missed webhook): excluded.
      { key: "rtc:bob", kind: "rtc", firstSeenAt: T0 + 60_000, lastSeenAt: T0 + 60_000 },
      // HLS viewer: heartbeats until +300s on the presence doc.
      { key: "hls:viewer000000000001", kind: "hls", firstSeenAt: T0, lastSeenAt: T0 },
      // HLS viewer that left via sendBeacon (lastSeenAtMs zeroed, leftAtMs kept): 60s.
      { key: "hls:viewer000000000002", kind: "hls", firstSeenAt: T0 + 1_000, lastSeenAt: T0 + 1_000 },
      // HLS viewer whose presence belongs to another session: excluded.
      { key: "hls:viewer000000000003", kind: "hls", firstSeenAt: T0, lastSeenAt: T0 },
    ],
    hlsPresence: [
      { viewerId: "viewer000000000001", sessionId: "s1", firstSeenAt: T0, lastSeenAtMs: T0 + 300_000 },
      { viewerId: "viewer000000000002", sessionId: "s1", firstSeenAt: T0 + 1_000, lastSeenAtMs: 0, leftAtMs: T0 + 61_000 },
      { viewerId: "viewer000000000003", sessionId: "other", firstSeenAt: T0, lastSeenAtMs: T0 + 900_000 },
    ],
  });
  assert.equal(stats.watchSampleSize, 3);
  assert.equal(stats.totalWatchSeconds, 120 + 300 + 60);
  assert.equal(stats.avgWatchSeconds, 160);
});

test("computeWatchStats returns null average without samples", () => {
  const stats = computeWatchStats({
    session: SESSION,
    viewers: [{ key: "rtc:bob", kind: "rtc", firstSeenAt: T0, lastSeenAt: T0 }],
    hlsPresence: [],
  });
  assert.deepEqual(stats, { avgWatchSeconds: null, watchSampleSize: 0, totalWatchSeconds: 0 });
  assert.equal(computeWatchStats({ session: SESSION, viewers: [], hlsPresence: [] }).avgWatchSeconds, null);
});

test("computeWatchStats accepts Firestore-like timestamps", () => {
  const ts = (ms: number) => ({ toMillis: () => ms });
  const stats = computeWatchStats({
    session: SESSION,
    viewers: [{ key: "rtc:x", kind: "rtc", firstSeenAt: ts(T0), leftAt: ts(T0 + 45_000) }],
    hlsPresence: [],
  });
  assert.equal(stats.avgWatchSeconds, 45);
});

test("egressStatusName handles enum numbers and names", () => {
  assert.equal(egressStatusName(3), "complete");
  assert.equal(egressStatusName(4), "failed");
  assert.equal(egressStatusName("EGRESS_ABORTED"), "aborted");
  assert.equal(egressStatusName("6"), "limit_reached");
  assert.equal(egressStatusName(undefined), null);
});

test("redactEgressError strips RTMP urls (stream keys)", () => {
  assert.equal(
    redactEgressError("failed to connect rtmp://a.rtmp.youtube.com/live2/abcd-efgh: timeout"),
    "failed to connect [rtmp url] timeout"
  );
  assert.equal(redactEgressError(""), null);
  assert.equal(redactEgressError(null), null);
});

test("egressOutcomeFields maps the LiveKit webhook payload", () => {
  const out = egressOutcomeFields({
    status: 4,
    error: "pipeline failed",
    streamResults: [
      { url: "rtmp://x/y/KEY", status: 1 },
      { url: "rtmps://z/KEY2", status: 2, error: "rtmps://z/KEY2 refused" },
    ],
  });
  assert.deepEqual(out, {
    egressStatus: "failed",
    egressError: "pipeline failed",
    egressStreamResults: [
      { status: "finished", error: null },
      { status: "failed", error: "[rtmp url] refused" },
    ],
  });
  assert.equal(JSON.stringify(out).includes("KEY"), false);
});

test("outputStatusFor maps meter + egress outcome to a status", () => {
  assert.deepEqual(outputStatusFor({ meterOpen: true, endedAt: null }), { status: "live", error: null });
  assert.deepEqual(outputStatusFor({ meterOpen: false, endedAt: T0, closeReason: "stop_multistream" }), {
    status: "completed",
    error: null,
  });
  assert.deepEqual(outputStatusFor({ endedAt: T0, egressStatus: "complete", closeReason: "egress_ended" }), {
    status: "completed",
    error: null,
  });
  assert.deepEqual(outputStatusFor({ endedAt: T0, egressStatus: "failed", egressError: "boom" }), {
    status: "failed",
    error: "boom",
  });
  assert.deepEqual(outputStatusFor({ endedAt: T0, egressStatus: "failed" }), { status: "failed", error: "Output failed" });
  assert.deepEqual(
    outputStatusFor({ endedAt: T0, egressStreamResults: [{ status: "failed", error: "refused" }] }),
    { status: "failed", error: "refused" }
  );
  assert.deepEqual(outputStatusFor({ endedAt: T0, closeReason: "monthly_limit" }), { status: "stopped_limit", error: null });
  assert.deepEqual(outputStatusFor({ endedAt: T0, egressStatus: "limit_reached" }), { status: "stopped_limit", error: null });
});

test("summarizeOutput builds destinations with labels and per-stream results", () => {
  const o = summarizeOutput(
    "EG_1",
    {
      kind: "multistream",
      startedAt: new Date(T0),
      endedAt: new Date(T0 + 600_000),
      meterOpen: false,
      destinations: ["youtube", "custom"],
      egressStatus: "complete",
      egressStreamResults: [{ status: "finished" }, { status: "failed", error: "refused" }],
    },
    T0 + 1_000_000
  );
  assert.deepEqual(o, {
    egressId: "EG_1",
    kind: "multistream",
    destinations: [
      { platform: "youtube", label: "YouTube", status: "finished" },
      { platform: "custom", label: "Custom RTMP", status: "failed", error: "refused" },
    ],
    startedAt: T0,
    endedAt: T0 + 600_000,
    durationSec: 600,
    status: "completed",
  });
  // Live output: duration runs to now.
  const live = summarizeOutput("EG_2", { kind: "hls", startedAt: T0, meterOpen: true, destinations: ["streamline_hls"] }, T0 + 30_000);
  assert.equal(live.status, "live");
  assert.equal(live.durationSec, 30);
  assert.equal(live.destinations[0].label, "Streamline Channel (HLS)");
  assert.equal(destinationLabel("my_platform"), "My platform");
});

test("outputsForSession keeps overlapping outputs, oldest first", () => {
  const session = { startedAt: T0, endedAt: T0 + 3_600_000 };
  const docs = [
    { id: "late", data: { kind: "instagram", startedAt: T0 + 120_000, endedAt: T0 + 900_000, meterOpen: false } },
    { id: "warmup", data: { kind: "hls", startedAt: T0 - 60_000, endedAt: T0 + 3_000_000, meterOpen: false } },
    { id: "previous", data: { kind: "multistream", startedAt: T0 - 86_400_000, endedAt: T0 - 80_000_000, meterOpen: false } },
    { id: "next", data: { kind: "multistream", startedAt: T0 + 4_000_000, meterOpen: true } },
    { id: "nostart", data: { kind: "multistream" } },
  ];
  assert.deepEqual(
    outputsForSession(docs, session, T0 + 5_000_000).map((o) => o.egressId),
    ["warmup", "late"]
  );
});

test("buildStreamSummary + stored summary round trip", () => {
  const stats = { ...newViewerStats("s1", T0), peak: 12, totalUnique: 30, totalUniqueHls: 21, totalUniqueRtc: 9, endedAt: T0 + 5_400_000 };
  assert.equal(sessionDurationSec(stats, T0), 5400);
  assert.equal(sessionDurationSec({ startedAt: T0, endedAt: null }, T0 + 2_000), 2);
  const summary = buildStreamSummary(stats, { avgWatchSeconds: 610, watchSampleSize: 25 }, [], T0 + 9_999_999);
  assert.deepEqual(summary, {
    sessionId: "s1",
    startedAt: T0,
    endedAt: T0 + 5_400_000,
    live: false,
    durationSec: 5400,
    peakConcurrent: 12,
    uniqueViewers: { total: 30, hls: 21, rtc: 9 },
    avgWatchSeconds: 610,
    watchSampleSize: 25,
    outputs: [],
  });
  const stored = storedSummaryFrom(stats, { avgWatchSeconds: null, watchSampleSize: 0, totalWatchSeconds: 0 }, 123);
  assert.deepEqual(readStoredSummary(stored), stored);
  assert.equal(readStoredSummary(null), null);
  assert.equal(readStoredSummary({ durationSec: 5 }), null);
});
