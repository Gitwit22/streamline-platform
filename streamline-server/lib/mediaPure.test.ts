/**
 * Pure helpers for export jobs, HLS, multistream, storage accounting and
 * recording download links.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceablePrefixLength,
  collectEgressIds,
  computeHlsBilledMinutes,
  decideHlsStart,
  decideMultistreamStart,
  evaluateDownloadRules,
  isHlsSessionStale,
  isStaleExportJob,
  isTerminalExportStatus,
  maskSecretTail,
  redactRtmpUrl,
  shouldClaimStorageCount,
  shouldRefreshHlsHeartbeat,
  toMillis,
} from "./mediaPure.js";

const MIN = 60_000;
const NOW = Date.parse("2026-10-04T12:00:00Z");
const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

test("toMillis handles Date, Timestamp-like, number, ISO, serialized", () => {
  assert.equal(toMillis(new Date(NOW)), NOW);
  assert.equal(toMillis(ts(NOW)), NOW);
  assert.equal(toMillis({ toDate: () => new Date(NOW) }), NOW);
  assert.equal(toMillis(NOW), NOW);
  assert.equal(toMillis(new Date(NOW).toISOString()), NOW);
  assert.equal(toMillis({ _seconds: NOW / 1000, _nanoseconds: 0 }), NOW);
  assert.equal(toMillis(null), null);
  assert.equal(toMillis("garbage"), null);
});

test("stale export jobs: only active jobs older than the threshold", () => {
  assert.equal(isStaleExportJob({ status: "rendering", startedAt: ts(NOW - 31 * MIN) }, NOW, 30 * MIN), true);
  assert.equal(isStaleExportJob({ status: "preparing", startedAt: ts(NOW - 5 * MIN) }, NOW, 30 * MIN), false);
  assert.equal(isStaleExportJob({ status: "uploading", startedAt: null }, NOW, 30 * MIN), true);
  assert.equal(isStaleExportJob({ status: "queued", startedAt: null }, NOW, 30 * MIN), false);
  assert.equal(isStaleExportJob({ status: "canceled", startedAt: ts(0) }, NOW, 30 * MIN), false);
  assert.equal(isTerminalExportStatus("canceled"), true);
  assert.equal(isTerminalExportStatus("rendering"), false);
});

test("stream keys are masked to the last 4 chars and never fully echoed", () => {
  assert.equal(maskSecretTail("abcd-efgh-1234"), "…1234");
  assert.equal(maskSecretTail("abc"), "…***");
  assert.equal(maskSecretTail(""), null);
  assert.equal(maskSecretTail(undefined), null);
  assert.equal(redactRtmpUrl("rtmp://a.rtmp.youtube.com/live2/SECRETKEY"), "rtmp://a.rtmp.youtube.com/live2/***");
  assert.equal(redactRtmpUrl("rtmps://x/app/KEY?token=t"), "rtmps://x/app/***");
  assert.ok(!redactRtmpUrl("rtmp://h/app/SECRET").includes("SECRET"));
  assert.equal(redactRtmpUrl(""), "***");
});

test("multistream start decision", () => {
  assert.deepEqual(decideMultistreamStart(null, NOW, 2 * MIN), { action: "proceed" });
  assert.deepEqual(
    decideMultistreamStart({ status: "started", egressId: "E1", egressIds: { normal: "E1", instagram: "E2" } }, NOW, 2 * MIN),
    { action: "conflict_check", egressIds: ["E1", "E2"] }
  );
  assert.deepEqual(decideMultistreamStart({ status: "starting", startingAt: NOW - 30_000 }, NOW, 2 * MIN), { action: "in_progress" });
  assert.deepEqual(decideMultistreamStart({ status: "starting", startingAt: NOW - 5 * MIN }, NOW, 2 * MIN), { action: "proceed" });
  assert.deepEqual(decideMultistreamStart({ status: "started" }, NOW, 2 * MIN), { action: "proceed" });
  assert.deepEqual(collectEgressIds({ egressId: " E1 ", egressIds: { normal: "E1" } }), ["E1"]);
});

test("HLS start: idle/error start, live or fresh starting return existing, stale starting is taken over", () => {
  assert.equal(decideHlsStart({ status: "idle" }, NOW, 3 * MIN).action, "start");
  assert.equal(decideHlsStart(undefined, NOW, 3 * MIN).action, "start");
  assert.equal(decideHlsStart({ status: "error" }, NOW, 3 * MIN).action, "start");
  assert.equal(decideHlsStart({ status: "live" }, NOW, 3 * MIN).action, "existing");
  assert.equal(decideHlsStart({ status: "starting", updatedAt: ts(NOW - MIN) }, NOW, 3 * MIN).action, "existing");
  // serverTimestamp not yet resolved → treat as fresh
  assert.equal(decideHlsStart({ status: "starting" }, NOW, 3 * MIN).action, "existing");
  assert.equal(decideHlsStart({ status: "starting", updatedAt: ts(NOW - 10 * MIN) }, NOW, 3 * MIN).action, "start");
});

test("HLS billing matches /stop rounding", () => {
  assert.equal(computeHlsBilledMinutes(ts(NOW - 10 * 1000), NOW), 1);
  assert.equal(computeHlsBilledMinutes(ts(NOW - 90 * MIN), NOW), 90);
  assert.equal(computeHlsBilledMinutes(ts(NOW - 150 * 1000), NOW), 3);
  assert.equal(computeHlsBilledMinutes(null, NOW), 0);
  assert.equal(computeHlsBilledMinutes(ts(NOW + MIN), NOW), 0);
});

test("HLS staleness uses heartbeat, so long attended streams survive", () => {
  const longButAttended = { status: "live", startedAt: ts(NOW - 10 * 60 * MIN), updatedAt: ts(NOW - 10 * 60 * MIN), heartbeatAt: ts(NOW - 2 * MIN) };
  assert.equal(isHlsSessionStale(longButAttended, NOW, 180 * MIN), false);
  const orphan = { status: "live", startedAt: ts(NOW - 10 * 60 * MIN), heartbeatAt: ts(NOW - 4 * 60 * MIN) };
  assert.equal(isHlsSessionStale(orphan, NOW, 180 * MIN), true);
  const legacyNoHeartbeat = { status: "live", updatedAt: ts(NOW - 60 * MIN) };
  assert.equal(isHlsSessionStale(legacyNoHeartbeat, NOW, 180 * MIN), false);
  assert.equal(isHlsSessionStale({ status: "idle" }, NOW, 1), false);
  assert.equal(isHlsSessionStale({ status: "error" }, NOW, 180 * MIN), true);
});

test("HLS heartbeat refresh is throttled and only while active", () => {
  assert.equal(shouldRefreshHlsHeartbeat({ status: "live" }, NOW, MIN), true);
  assert.equal(shouldRefreshHlsHeartbeat({ status: "live", heartbeatAt: ts(NOW - 30_000) }, NOW, MIN), false);
  assert.equal(shouldRefreshHlsHeartbeat({ status: "live", heartbeatAt: ts(NOW - 2 * MIN) }, NOW, MIN), true);
  assert.equal(shouldRefreshHlsHeartbeat({ status: "idle" }, NOW, MIN), false);
});

test("storageCounted flip: only once, never for deleted docs or empty files", () => {
  assert.equal(shouldClaimStorageCount({ status: "ready" }, 100), true);
  assert.equal(shouldClaimStorageCount({ status: "ready", storageCounted: true }, 100), false);
  assert.equal(shouldClaimStorageCount({ status: "deleted" }, 100), false);
  assert.equal(shouldClaimStorageCount({ status: "processing" }, 0), false);
  assert.equal(shouldClaimStorageCount(null, 100), false);
});

test("download rules: strict ready, expiry, paywall, key", () => {
  const ready = { status: "ready", downloadReady: true, readyAt: ts(NOW - 5 * MIN), objectKey: "/recordings/u/r/1.mp4" };
  assert.deepEqual(evaluateDownloadRules(ready, NOW, 30), { kind: "ok", objectKey: "recordings/u/r/1.mp4" });

  const notReady = evaluateDownloadRules({ status: "stopped", downloadReady: true }, NOW, 30);
  assert.equal(notReady.kind, "not_ready");
  assert.equal(notReady.message, "Recording is still processing");

  const failed = evaluateDownloadRules({ status: "failed", errorMessage: "boom" }, NOW, 30);
  assert.equal(failed.message, "Recording failed: boom");

  assert.equal(evaluateDownloadRules({ status: "ready", downloadReady: false }, NOW, 30).kind, "not_ready");
  assert.equal(evaluateDownloadRules({ ...ready, readyAt: ts(NOW - 31 * MIN) }, NOW, 30).kind, "expired");
  assert.equal(evaluateDownloadRules({ ...ready, paywallState: "requires_payment" }, NOW, 30).kind, "paywall");
  assert.equal(evaluateDownloadRules({ ...ready, objectKey: "", downloadPath: "" }, NOW, 30).kind, "missing_key");
  // No readyAt/stoppedAt → not expired (same as the old isExpired)
  assert.equal(evaluateDownloadRules({ status: "ready", downloadReady: true, downloadPath: "k" }, NOW, 30).kind, "ok");
});

test("retention cursor advances only over the leading run of finished docs", () => {
  assert.equal(advanceablePrefixLength([]), 0);
  assert.equal(advanceablePrefixLength([true, true, false, true]), 2);
  assert.equal(advanceablePrefixLength([false, true]), 0);
  assert.equal(advanceablePrefixLength([true, true, true]), 3);
});
