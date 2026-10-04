import test from "node:test";
import assert from "node:assert/strict";
import { LIMIT_ERRORS } from "./limitErrors";
import { PERMISSION_ERRORS } from "./permissionErrors";
import {
  TELEMETRY_EVENT_TYPES,
  TELEMETRY_METADATA_MAX_BYTES,
  buildTelemetryDoc,
  entitlementDenialCode,
  isTelemetryEventType,
  redactTelemetryString,
  sanitizeTelemetryMetadata,
  telemetryRateKey,
  urlHost,
} from "./telemetryPure";

test("allowlist: exactly the owner's event list", () => {
  assert.deepEqual([...TELEMETRY_EVENT_TYPES].sort(), [
    "broadcast.ended",
    "broadcast.started",
    "checkout.completed",
    "checkout.failed",
    "checkout.started",
    "destination.connected",
    "destination.failed",
    "destination.reconnected",
    "entitlement.denied",
    "hls.started",
    "hls.viewer_joined",
    "hls.viewer_left",
    "job.failed",
    "recording.completed",
    "recording.failed",
    "recording.started",
  ]);
  assert.equal(isTelemetryEventType("broadcast.started"), true);
  assert.equal(isTelemetryEventType("ui.click"), false);
  assert.equal(isTelemetryEventType(undefined), false);
});

test("sanitize: drops sensitive keys, redacts urls/keys, keeps scalars", () => {
  const out = sanitizeTelemetryMetadata({
    platform: "youtube",
    streamKey: "abcd",
    stream_key: "abcd",
    token: "t",
    email: "a@b.c",
    error: "failed to push rtmp://a.rtmp.youtube.com/live2/SECRET-KEY now",
    stripe: "sk_live_123abc",
    count: 3,
    nan: NaN,
    ok: true,
    nothing: undefined,
    list: ["a", 1, { x: 1 }],
    nested: { kind: "hls", password: "x", deeper: { a: 1 } },
    fn: () => 1,
  });
  assert.equal(out.platform, "youtube");
  for (const k of ["streamKey", "stream_key", "token", "email", "nan", "nothing", "fn"]) {
    assert.equal(k in out, false, k);
  }
  assert.equal(out.error, "failed to push [url] now");
  assert.equal(out.stripe, "[key]");
  assert.equal(out.count, 3);
  assert.equal(out.ok, true);
  assert.deepEqual(out.list, ["a", 1]);
  assert.deepEqual(out.nested, { kind: "hls" });
});

test("sanitize: size cap and non-object input", () => {
  const big: Record<string, string> = {};
  for (let i = 0; i < 20; i++) big[`k${i}`] = "x".repeat(300);
  const out = sanitizeTelemetryMetadata(big);
  assert.ok(Buffer.byteLength(JSON.stringify(out)) <= TELEMETRY_METADATA_MAX_BYTES);
  assert.ok(Object.keys(out).length > 0);
  assert.deepEqual(sanitizeTelemetryMetadata(null), {});
  assert.deepEqual(sanitizeTelemetryMetadata("x"), {});
  assert.deepEqual(sanitizeTelemetryMetadata([1, 2]), {});
});

test("buildTelemetryDoc: shape and id hygiene", () => {
  const doc = buildTelemetryDoc(
    "abc",
    "recording.started",
    { userId: "u1", roomId: "bad/id", broadcastId: "  eg_1 ", metadata: { presetId: "720p" } },
    1700000000000
  );
  assert.deepEqual(doc, {
    id: "abc",
    eventType: "recording.started",
    userId: "u1",
    roomId: null,
    broadcastId: "eg_1",
    timestamp: 1700000000000,
    metadata: { presetId: "720p" },
  });
});

test("rate key: room, else user, else global", () => {
  assert.equal(telemetryRateKey("hls.viewer_joined", { roomId: "r1", userId: "u" }), "hls.viewer_joined|r1");
  assert.equal(telemetryRateKey("checkout.started", { userId: "u" }), "checkout.started|u");
  assert.equal(telemetryRateKey("job.failed", {}), "job.failed|_");
});

test("entitlementDenialCode: only entitlement error bodies on denial statuses", () => {
  const { FEATURE_NOT_ENTITLED, LIMIT_EXCEEDED, USAGE_EXHAUSTED, FEATURE_DISABLED } = LIMIT_ERRORS;
  assert.equal(entitlementDenialCode(403, { error: FEATURE_NOT_ENTITLED }), FEATURE_NOT_ENTITLED);
  assert.equal(entitlementDenialCode(409, { error: LIMIT_EXCEEDED }), LIMIT_EXCEEDED);
  assert.equal(entitlementDenialCode(403, { error: USAGE_EXHAUSTED }), USAGE_EXHAUSTED);
  assert.equal(entitlementDenialCode(200, { error: FEATURE_DISABLED }), null);
  assert.equal(entitlementDenialCode(403, { error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS }), null);
  assert.equal(entitlementDenialCode(403, null), null);
});

test("urlHost: hostname only", () => {
  assert.equal(urlHost("rtmp://a.rtmp.youtube.com/live2/KEY"), "a.rtmp.youtube.com");
  assert.equal(urlHost("not a url"), null);
  assert.equal(urlHost(""), null);
});

test("redactTelemetryString: jwt and truncation", () => {
  assert.equal(redactTelemetryString("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc"), "Bearer [jwt]");
  assert.equal(redactTelemetryString("y".repeat(1000)).length, 300);
});
