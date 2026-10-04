import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyParticipant,
  currentViewerTotal,
  finalizeViewerStats,
  isCountableRtcViewer,
  isSessionActive,
  isValidViewerId,
  isValidViewerRoomId,
  newViewerStats,
  nextPeak,
  parseHeartbeatBody,
  readViewerStats,
  recordingViewerFields,
  summarizeRtcParticipants,
  viewerKeyFor,
  withNewViewer,
} from "./viewerStatsPure";

const OWNER = "ownerUid123";

test("isValidViewerId accepts 16-64 url-safe chars only", () => {
  assert.equal(isValidViewerId("abcdefghijklmnop"), true);
  assert.equal(isValidViewerId("A-b_" + "x".repeat(60)), true);
  assert.equal(isValidViewerId("short"), false);
  assert.equal(isValidViewerId("x".repeat(65)), false);
  assert.equal(isValidViewerId("abcdefghijklmnop/"), false);
  assert.equal(isValidViewerId("abcdefghijklmno p"), false);
  assert.equal(isValidViewerId(1234567890123456), false);
  assert.equal(isValidViewerId(undefined), false);
});

test("isValidViewerRoomId rejects path-like ids", () => {
  assert.equal(isValidViewerRoomId("room_1"), true);
  assert.equal(isValidViewerRoomId("a/b"), false);
  assert.equal(isValidViewerRoomId(".."), false);
  assert.equal(isValidViewerRoomId(""), false);
  assert.equal(isValidViewerRoomId("x".repeat(129)), false);
});

test("classifyParticipant excludes agents, egress and hidden participants", () => {
  assert.equal(classifyParticipant({ identity: "EG_abc" }, OWNER), "excluded");
  assert.equal(classifyParticipant({ identity: "bot", isAgent: true }, OWNER), "excluded");
  assert.equal(classifyParticipant({ identity: "rec", kind: 2 }, OWNER), "excluded");
  assert.equal(classifyParticipant({ identity: "agent", kind: 4 }, OWNER), "excluded");
  assert.equal(classifyParticipant({ identity: "agent", kind: "AGENT" }, OWNER), "excluded");
  assert.equal(classifyParticipant({ identity: "invisible_u_1" }, OWNER), "excluded");
  assert.equal(
    classifyParticipant({ identity: "mod", metadata: JSON.stringify({ presenceMode: "invisible" }) }, OWNER),
    "excluded"
  );
  assert.equal(classifyParticipant({ identity: "mod", metadata: JSON.stringify({ hidden: true }) }, OWNER), "excluded");
  assert.equal(classifyParticipant({ identity: "h", permission: { hidden: true } }, OWNER), "excluded");
  assert.equal(classifyParticipant({ identity: "" }, OWNER), "excluded");
});

test("classifyParticipant splits host / on stage / audience", () => {
  assert.equal(classifyParticipant({ identity: OWNER, permission: { canPublish: true } }, OWNER), "host");
  assert.equal(classifyParticipant({ identity: `producer:u2:${OWNER}`, permission: { canPublish: true } }, OWNER), "host");
  assert.equal(classifyParticipant({ identity: "guest1", permission: { canPublish: true } }, OWNER), "onStage");
  assert.equal(classifyParticipant({ identity: "guest2", permission: { canPublish: false } }, OWNER), "audience");
  assert.equal(classifyParticipant({ identity: "guest3" }, OWNER), "audience");
  assert.equal(classifyParticipant({ identity: "guest4", metadata: "not json" }, OWNER), "audience");
});

test("isCountableRtcViewer counts guests (stage or audience) but not hosts", () => {
  assert.equal(isCountableRtcViewer({ identity: OWNER }, OWNER), false);
  assert.equal(isCountableRtcViewer({ identity: "producer:x:y" }, OWNER), false);
  assert.equal(isCountableRtcViewer({ identity: "EG_1" }, OWNER), false);
  assert.equal(isCountableRtcViewer({ identity: "invite:abc:1" }, OWNER), true);
  assert.equal(isCountableRtcViewer({ identity: "g", permission: { canPublish: true } }, OWNER), true);
});

test("summarizeRtcParticipants counts each identity once", () => {
  const counts = summarizeRtcParticipants(
    [
      { identity: OWNER, permission: { canPublish: true } },
      { identity: "EG_x" },
      { identity: "invisible_m_1" },
      { identity: "g1", permission: { canPublish: true } },
      { identity: "a1", permission: { canPublish: false } },
      { identity: "a2", permission: { canPublish: false } },
      { identity: "a2", permission: { canPublish: false } },
    ],
    OWNER
  );
  assert.deepEqual(counts, { host: 1, onStage: 1, audience: 2 });
});

test("currentViewerTotal = HLS + RTC audience", () => {
  assert.equal(currentViewerTotal(3, 2), 5);
  assert.equal(currentViewerTotal(-1, 2), 2);
  assert.equal(currentViewerTotal(NaN as any, 0), 0);
});

test("nextPeak never decreases", () => {
  assert.equal(nextPeak(5, 3), 5);
  assert.equal(nextPeak(5, 8), 8);
  assert.equal(nextPeak(undefined, 2), 2);
  assert.equal(nextPeak("x", -4), 0);
});

test("session totals: withNewViewer increments total and per-kind", () => {
  let s = newViewerStats("sess1", 1000);
  assert.equal(isSessionActive(s), true);
  s = withNewViewer(s, "hls");
  s = withNewViewer(s, "hls");
  s = withNewViewer(s, "rtc");
  assert.equal(s.totalUnique, 3);
  assert.equal(s.totalUniqueHls, 2);
  assert.equal(s.totalUniqueRtc, 1);
  const done = finalizeViewerStats({ ...s, peak: 2 }, 5000, 4);
  assert.equal(done.endedAt, 5000);
  assert.equal(done.peak, 4);
  assert.equal(isSessionActive(done), false);
  // Finalizing twice keeps the first end time.
  assert.equal(finalizeViewerStats(done, 9000).endedAt, 5000);
});

test("readViewerStats is defensive", () => {
  assert.equal(readViewerStats(null), null);
  assert.equal(readViewerStats({}), null);
  const r = readViewerStats({ sessionId: "s", startedAt: 10, peak: "3", totalUnique: 2 });
  assert.deepEqual(r, {
    sessionId: "s",
    startedAt: 10,
    endedAt: null,
    peak: 3,
    totalUnique: 2,
    totalUniqueRtc: 0,
    totalUniqueHls: 0,
  });
  assert.equal(readViewerStats({ sessionId: "s", endedAt: 50 })?.endedAt, 50);
});

test("viewerKeyFor never produces a nested path", () => {
  assert.equal(viewerKeyFor("rtc", "invite:a/b"), "rtc:invite:a_b");
  assert.equal(viewerKeyFor("hls", "abc"), "hls:abc");
});

test("parseHeartbeatBody handles beacon text and objects", () => {
  assert.deepEqual(parseHeartbeatBody('{"roomId":"r","leave":true}'), { roomId: "r", leave: true });
  assert.deepEqual(parseHeartbeatBody("garbage"), {});
  assert.deepEqual(parseHeartbeatBody({ roomId: "r" }), { roomId: "r" });
  assert.deepEqual(parseHeartbeatBody(undefined), {});
});

test("recordingViewerFields maps totals to recording fields", () => {
  assert.equal(recordingViewerFields(null), null);
  const s = { ...newViewerStats("s", 1), totalUnique: 7, peak: 4 };
  assert.deepEqual(recordingViewerFields(s), { viewerCount: 7, peakViewers: 4 });
});
