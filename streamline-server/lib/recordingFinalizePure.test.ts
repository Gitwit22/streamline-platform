import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCK_INFLIGHT_MS,
  LOCK_STARTING_STALE_MS,
  recordingLockBlocks,
  STUCK_GIVE_UP_AFTER_MS,
  STUCK_RECHECK_AFTER_MS,
  mayApplyRecordingStatus,
  recordingOutcomeFromEgress,
  stuckRecordingAction,
  activeRecordingFromLock,
} from "./recordingFinalizePure";

// Regression (audit P1-2): the webhook compared the SDK's numeric status (3)
// against "EGRESS_COMPLETE", so recordings were never finalized by it.
test("egress status numbers and names map to the same outcome", () => {
  assert.equal(recordingOutcomeFromEgress(3, ""), "check_file");
  assert.equal(recordingOutcomeFromEgress("EGRESS_COMPLETE", ""), "check_file");
  assert.equal(recordingOutcomeFromEgress(6, ""), "check_file"); // limit reached: file exists
  assert.equal(recordingOutcomeFromEgress(5, ""), "check_file"); // aborted: may have a partial file
  assert.equal(recordingOutcomeFromEgress(4, ""), "failed");
  assert.equal(recordingOutcomeFromEgress("EGRESS_FAILED", ""), "failed");
  assert.equal(recordingOutcomeFromEgress(3, "upload error"), "failed");
  assert.equal(recordingOutcomeFromEgress(1, ""), "processing");
  assert.equal(recordingOutcomeFromEgress(undefined, undefined), "processing");
});

test("finalization never downgrades a ready or deleted recording", () => {
  assert.equal(mayApplyRecordingStatus("ready", "processing"), false);
  assert.equal(mayApplyRecordingStatus("ready", "failed"), false);
  assert.equal(mayApplyRecordingStatus("deleted", "ready"), false);
  assert.equal(mayApplyRecordingStatus("failed", "processing"), false);
  assert.equal(mayApplyRecordingStatus("failed", "ready"), true);
  assert.equal(mayApplyRecordingStatus("processing", "ready"), true);
  assert.equal(mayApplyRecordingStatus("recording", "failed"), true);
});

test("stuck recordings are re-checked after 10 minutes and given up after 6 hours", () => {
  const now = 10_000_000_000;
  assert.equal(stuckRecordingAction(now - 60_000, now), "wait");
  assert.equal(stuckRecordingAction(now - STUCK_RECHECK_AFTER_MS, now), "recheck");
  assert.equal(stuckRecordingAction(now - STUCK_GIVE_UP_AFTER_MS, now), "recheck_or_fail");
  assert.equal(stuckRecordingAction(null, now), "recheck");
});

// Regression (audit P1-4): nothing stopped a second recording in the same room.
test("a room's running recording blocks a second start; ended or abandoned ones don't", () => {
  const now = 10_000_000_000;
  const lock = { recordingId: "r1", claimedAtMs: now - 1000 };
  assert.equal(recordingLockBlocks(null, null, now), false);
  assert.equal(recordingLockBlocks(lock, { status: "recording" }, now), true);
  assert.equal(recordingLockBlocks(lock, { status: "starting", updatedAtMs: now - 1000 }, now), true);
  assert.equal(recordingLockBlocks(lock, { status: "starting", updatedAtMs: now - LOCK_STARTING_STALE_MS }, now), false);
  assert.equal(recordingLockBlocks(lock, { status: "processing" }, now), false);
  assert.equal(recordingLockBlocks(lock, { status: "failed" }, now), false);
  // Double click: the first start hasn't created its doc yet.
  assert.equal(recordingLockBlocks(lock, null, now), true);
  assert.equal(recordingLockBlocks({ recordingId: "r1", claimedAtMs: now - LOCK_INFLIGHT_MS }, null, now), false);
});

test("activeRecordingFromLock: adopts only this room's running recording", () => {
  const lock = { recordingId: "rec1" };
  assert.deepEqual(activeRecordingFromLock(lock, { roomId: "r1", status: "recording", startedAtMs: 5 }, "r1"), {
    recordingId: "rec1",
    startedAtMs: 5,
  });
  assert.equal(activeRecordingFromLock(null, { roomId: "r1", status: "recording" }, "r1"), null);
  assert.equal(activeRecordingFromLock(lock, null, "r1"), null);
  assert.equal(activeRecordingFromLock(lock, { roomId: "other", status: "recording" }, "r1"), null);
  for (const status of ["starting", "processing", "ready", "failed", "stopped"]) {
    assert.equal(activeRecordingFromLock(lock, { roomId: "r1", status }, "r1"), null, status);
  }
  assert.deepEqual(activeRecordingFromLock(lock, { status: "RECORDING", startedAtMs: null }, "r1"), {
    recordingId: "rec1",
    startedAtMs: null,
  });
});
