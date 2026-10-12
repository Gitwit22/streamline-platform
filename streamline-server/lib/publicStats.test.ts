import test from "node:test";
import assert from "node:assert/strict";
import { streamedMinutesFromUsage } from "./publicStats";

test("streamedMinutesFromUsage prefers participantMinutes", () => {
  assert.equal(streamedMinutesFromUsage({ participantMinutes: 90, minutes: { live: { currentPeriod: 5 } } }), 90);
});

test("streamedMinutesFromUsage reads the minutes.live object schema", () => {
  assert.equal(streamedMinutesFromUsage({ minutes: { live: { currentPeriod: 42 } } }), 42);
});

test("streamedMinutesFromUsage never returns NaN for object-only usage (recording/export months)", () => {
  const v = streamedMinutesFromUsage({ minutes: { recording: { currentPeriod: 30 } }, recordingMinutes: 30 });
  assert.equal(v, 0);
  assert.ok(Number.isFinite(v));
});

test("streamedMinutesFromUsage handles legacy numeric fields and junk", () => {
  assert.equal(streamedMinutesFromUsage({ streamMinutes: "12" }), 12);
  assert.equal(streamedMinutesFromUsage({ minutes: 7 }), 7);
  assert.equal(streamedMinutesFromUsage({ participantMinutes: "abc" }), 0);
  assert.equal(streamedMinutesFromUsage(null), 0);
  assert.equal(streamedMinutesFromUsage({ participantMinutes: -5 }), 0);
});
