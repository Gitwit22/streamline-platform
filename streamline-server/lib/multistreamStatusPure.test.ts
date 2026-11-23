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

// --- per-destination status (Kick next to other destinations) ---
import { ingestPrefix, mapStreamResultsToDestinations } from "./multistreamStatusPure";

const KICK_PREFIX = "rtmps://fa723fc1b171.global-contribute.live-video.net:443/app";
const YT_PREFIX = "rtmp://a.rtmp.youtube.com/live2";

test("ingestPrefix: raw, masked and LiveKit-redacted URLs give the same prefix", () => {
  assert.equal(ingestPrefix(`${KICK_PREFIX}/sk_us-west-2_SECRET`), KICK_PREFIX);
  assert.equal(ingestPrefix(`${KICK_PREFIX}/***`), KICK_PREFIX);
  assert.equal(ingestPrefix(`${KICK_PREFIX}/{sk_u...CRET}`), KICK_PREFIX);
  assert.equal(ingestPrefix(""), "");
});

test("a rejected Kick push is attributed to Kick while YouTube stays active (order-independent)", () => {
  const targets = [
    { platform: "youtube", prefix: YT_PREFIX },
    { platform: "kick", prefix: KICK_PREFIX },
  ];
  const info = {
    status: 1,
    streamResults: [
      { url: `${KICK_PREFIX}/{sk_u...CRET}`, status: 2, error: `publish failed for ${KICK_PREFIX}/sk_us-west-2_SECRET: 401 unauthorized sk_us-west-2_SECRET` },
      { url: `${YT_PREFIX}/{abcd...wxyz}`, status: 0 },
    ],
  };
  const s = summarizeEgressOutput("multistream", "EG_K", info, targets);
  assert.equal(s.failed, false, "the output as a whole is still live");
  assert.deepEqual(s.destinations.map((d) => [d.platform, d.label, d.status]), [
    ["youtube", "YouTube", "active"],
    ["kick", "Kick", "failed"],
  ]);
  const kickErr = s.destinations[1].error || "";
  assert.ok(!kickErr.includes("SECRET"), "stream key must not leak");
  assert.ok(!kickErr.includes("live-video.net"), "ingest URL must not leak");
  assert.ok(!JSON.stringify(s).includes("SECRET"));
});

test("results without URLs fall back to position when counts match; otherwise unknown", () => {
  const targets = [
    { platform: "kick", prefix: KICK_PREFIX },
    { platform: "twitch", prefix: "rtmp://live.twitch.tv/app" },
  ];
  const byIndex = mapStreamResultsToDestinations([{ status: 2, error: "rejected" }, { status: 0 }], targets);
  assert.deepEqual(byIndex.map((d) => d.status), ["failed", "active"]);
  const none = mapStreamResultsToDestinations([{ status: 0 }], targets);
  assert.deepEqual(none.map((d) => d.status), [null, null]);
});

test("two Kick channels on the same ingest host are matched in order", () => {
  const targets = [
    { platform: "kick", prefix: KICK_PREFIX },
    { platform: "kick", prefix: KICK_PREFIX },
  ];
  const r = mapStreamResultsToDestinations(
    [{ url: `${KICK_PREFIX}/{a}`, status: 0 }, { url: `${KICK_PREFIX}/{b}`, status: 2, error: "x" }],
    targets
  );
  assert.deepEqual(r.map((d) => d.status), ["active", "failed"]);
});

test("outputs started before tracking have no destination rows", () => {
  assert.deepEqual(summarizeEgressOutput("multistream", "EG_OLD", { status: 1, streamResults: [{ status: 0 }] }).destinations, []);
  assert.deepEqual(
    summarizeEgressOutput("multistream", "EG_P", null, [{ platform: "kick", prefix: KICK_PREFIX }]).destinations,
    [{ platform: "kick", label: "Kick", status: null, error: null }]
  );
});
