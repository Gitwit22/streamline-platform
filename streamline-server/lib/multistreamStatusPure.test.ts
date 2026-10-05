import test from "node:test";
import assert from "node:assert/strict";
import { summarizeEgressOutput } from "./multistreamStatusPure";

test("summarizeEgressOutput: missing info is unknown, not failed", () => {
  const s = summarizeEgressOutput("instagram", "EG_1", null);
  assert.equal(s.status, "unknown");
  assert.equal(s.failed, false);
  assert.equal(s.error, null);
});

test("summarizeEgressOutput: active egress with an active stream", () => {
  const s = summarizeEgressOutput("multistream", "EG_2", { status: 1, streamResults: [{ status: 0 }] });
  assert.equal(s.status, "active");
  assert.equal(s.failed, false);
  assert.deepEqual(s.streams, [{ status: "active", error: null }]);
});

test("summarizeEgressOutput: failed egress reports a redacted error", () => {
  const s = summarizeEgressOutput("instagram", "EG_3", {
    status: 4,
    error: "pipeline failed: rtmps://edgetee-upload-det1-1.xx.fbcdn.net:443/rtmp/FB-123?s_bl=1&s_ow=10 connection refused",
  });
  assert.equal(s.status, "failed");
  assert.equal(s.failed, true);
  assert.ok(s.error && !s.error.includes("FB-123"), "stream key must not leak");
  assert.match(s.error!, /\[rtmp url\]/);
});

test("summarizeEgressOutput: egress still active but every RTMP push failed", () => {
  const s = summarizeEgressOutput("instagram", "EG_4", {
    status: "EGRESS_ACTIVE",
    streamResults: [{ status: 2, error: "rtmp handshake failed" }],
  });
  assert.equal(s.status, "active");
  assert.equal(s.failed, true);
  assert.equal(s.error, "rtmp handshake failed");
});
