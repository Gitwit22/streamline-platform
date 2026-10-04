import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDestinationCaps,
  clampPresetForPlan,
  clampRecordingPreset,
  encodingOptionsFor,
  INSTAGRAM_STREAM_PROFILE,
  KEYFRAME_INTERVAL_SEC,
  MEDIA_PRESET_LABELS,
  presetsWithAvailability,
  resolveHlsPreset,
  resolvePlanMaxPreset,
  resolveRequestedPresetId,
  toEncodingOptions,
  getPresetById,
} from "./mediaPresets";

test("owner default is used when presetId is absent", () => {
  const r = resolveRequestedPresetId({ actorIsOwner: true, ownerDefaultPresetId: "hd_1080p30" });
  assert.equal(r.requestedId, "hd_1080p30");
  assert.equal(r.source, "owner_default");
});

test("falls back to 720p30 when neither body nor owner default", () => {
  const r = resolveRequestedPresetId({ actorIsOwner: true });
  assert.equal(r.requestedId, "standard_720p30");
  assert.equal(r.source, "fallback");
});

test("owner's own presetId wins without explicit flag", () => {
  const r = resolveRequestedPresetId({ bodyPresetId: "sports_1080p60", actorIsOwner: true, ownerDefaultPresetId: "hd_1080p30" });
  assert.equal(r.requestedId, "sports_1080p60");
});

test("non-owner implicit presetId is ignored in favor of owner default", () => {
  const r = resolveRequestedPresetId({ bodyPresetId: "standard_720p30", actorIsOwner: false, ownerDefaultPresetId: "hd_1080p30" });
  assert.equal(r.requestedId, "hd_1080p30");
});

test("non-owner explicit choice (setup modal) wins", () => {
  const r = resolveRequestedPresetId({
    bodyPresetId: "standard_720p30",
    presetExplicit: true,
    actorIsOwner: false,
    ownerDefaultPresetId: "hd_1080p30",
  });
  assert.equal(r.requestedId, "standard_720p30");
  assert.equal(r.source, "explicit");
});

test("unknown body preset id falls through to owner default", () => {
  const r = resolveRequestedPresetId({ bodyPresetId: "bogus", presetExplicit: true, actorIsOwner: true, ownerDefaultPresetId: "hd_1080p30" });
  assert.equal(r.requestedId, "hd_1080p30");
});

test("plan max: built-in table, plan-doc overrides and unknown plans", () => {
  assert.equal(resolvePlanMaxPreset("free"), "hd_1080p30");
  assert.equal(resolvePlanMaxPreset("pro"), "sports_1080p60");
  assert.equal(resolvePlanMaxPreset("enterprise"), "ultra_4k30");
  assert.equal(resolvePlanMaxPreset("mystery"), "hd_1080p30");
  assert.equal(resolvePlanMaxPreset("free", { limits: { maxPresetId: "pro_1440p30" } }), "pro_1440p30");
  assert.equal(resolvePlanMaxPreset("pro", { limits: { maxResolution: "720p" } }), "standard_720p30");
  assert.equal(resolvePlanMaxPreset("pro", { limits: { maxResolution: "4K" } }), "ultra_4k30");
  assert.equal(resolvePlanMaxPreset("pro", { limits: { maxPresetId: "nope" } }), "sports_1080p60");
});

test("plan clamping uses the effective (override) plan id and explicit max", () => {
  // A free user with adminOverridePlanId=enterprise resolves planId "enterprise".
  assert.equal(clampPresetForPlan("enterprise", "ultra_4k30").effectiveId, "ultra_4k30");
  const free = clampPresetForPlan("free", "ultra_4k30");
  assert.equal(free.effectiveId, "hd_1080p30");
  assert.equal(free.clamped, true);
  // maxPresetId (from plans/{id}) beats the built-in table.
  assert.equal(clampPresetForPlan("free", "ultra_4k30", "pro_1440p30").effectiveId, "pro_1440p30");
  assert.equal(clampRecordingPreset("pro", "ultra_4k30", null, false, "standard_720p30").effectiveId, "standard_720p30");
});

test("recording is lowered to the live stream preset", () => {
  const r = clampRecordingPreset("enterprise", "pro_1440p30", "hd_1080p30", false);
  assert.equal(r.effectiveId, "hd_1080p30");
  assert.equal(r.clampedToStream, true);
});

test("presetsWithAvailability flags locked presets", () => {
  const list = presetsWithAvailability("hd_1080p30");
  assert.deepEqual(
    list.map((p) => [p.id, p.allowed]),
    [
      ["standard_720p30", true],
      ["hd_1080p30", true],
      ["sports_1080p60", false],
      ["pro_1440p30", false],
      ["ultra_4k30", false],
    ]
  );
});

test("destination caps: twitch caps 1080p60 bitrate at 6000", () => {
  const r = applyDestinationCaps("sports_1080p60", ["twitch"], "sports_1080p60");
  assert.equal(r.effectiveId, "sports_1080p60");
  assert.equal(r.profile.videoKbps, 6000);
  assert.equal(r.bitrateCapped, true);
  assert.match(r.adjustmentReason || "", /Twitch/);
});

test("destination caps: strictest destination wins", () => {
  const r = applyDestinationCaps("ultra_4k30", ["youtube", "twitch"], "ultra_4k30");
  assert.equal(r.effectiveId, "sports_1080p60");
  assert.equal(r.profile.videoKbps, 6000);
  assert.equal(r.adjusted, true);
  assert.equal(r.limitingPlatform, "Twitch");
  assert.equal(r.adjustmentReason, "Adjusted to 1080p60 for Twitch");
});

test("destination caps: facebook caps resolution to 1080p", () => {
  const r = applyDestinationCaps("pro_1440p30", ["facebook"], "ultra_4k30");
  assert.equal(r.effectiveId, "sports_1080p60");
  assert.equal(r.limitingPlatform, "Facebook");
  assert.ok(r.profile.videoKbps <= 6000);
});

test("destination caps: enterprise + only YouTube/custom keeps 4K", () => {
  const r = applyDestinationCaps("ultra_4k30", ["youtube", "custom"], "ultra_4k30");
  assert.equal(r.effectiveId, "ultra_4k30");
  assert.equal(r.adjusted, false);
  assert.equal(r.adjustmentReason, null);
});

test("destination caps: non-enterprise composite is limited to 1080p even for YouTube", () => {
  const r = applyDestinationCaps("pro_1440p30", ["youtube"], "pro_1440p30");
  // pro_1440p30 plan ceiling is above 1080p60, so allowed.
  assert.equal(r.effectiveId, "pro_1440p30");
  const r2 = applyDestinationCaps("ultra_4k30", ["youtube"], "sports_1080p60");
  assert.equal(r2.effectiveId, "sports_1080p60");
  assert.equal(r2.adjustmentReason, "Adjusted to 1080p60 for live streaming");
});

test("destination caps: unchanged 720p for any destination", () => {
  const r = applyDestinationCaps("standard_720p30", ["twitch", "facebook", "kick"], "hd_1080p30");
  assert.equal(r.effectiveId, "standard_720p30");
  assert.equal(r.profile.videoKbps, 2500);
  assert.equal(r.adjustmentReason, null);
});

test("HLS: owner default used, clamped by plan and to 1080p", () => {
  assert.equal(resolveHlsPreset({ ownerDefaultPresetId: "hd_1080p30", planMaxPresetId: "hd_1080p30" }).hlsPresetId, "hls_1080p");
  assert.equal(resolveHlsPreset({ planMaxPresetId: "ultra_4k30" }).hlsPresetId, "hls_720p");
  const four = resolveHlsPreset({ ownerDefaultPresetId: "ultra_4k30", planMaxPresetId: "ultra_4k30" });
  assert.equal(four.hlsPresetId, "hls_1080p");
  assert.equal(four.clamped, true);
  const capped = resolveHlsPreset({ bodyPresetId: "hls_1080p", planMaxPresetId: "standard_720p30" });
  assert.equal(capped.hlsPresetId, "hls_720p");
  assert.equal(capped.clamped, true);
  assert.equal(resolveHlsPreset({ bodyPresetId: "hls_720p", ownerDefaultPresetId: "hd_1080p30", planMaxPresetId: "hd_1080p30" }).hlsPresetId, "hls_720p");
  assert.equal(resolveHlsPreset({ bodyPresetId: "sports_1080p60", planMaxPresetId: "sports_1080p60" }).hlsPresetId, "hls_1080p");
});

test("encodingOptionsFor uses proto field names and 2s keyframes", () => {
  const e = encodingOptionsFor({ width: 1920, height: 1080, fps: 30, videoKbps: 4500, audioKbps: 160 });
  assert.deepEqual(e, { width: 1920, height: 1080, framerate: 30, videoBitrate: 4500, audioBitrate: 160, keyFrameInterval: 2 });
  assert.equal(KEYFRAME_INTERVAL_SEC, 2);
  assert.equal(toEncodingOptions(getPresetById("hd_1080p30"), "record").keyFrameInterval, 2);
});

test("Instagram profile: 1080x1920 30fps ~3500 kbps", () => {
  const e = encodingOptionsFor(INSTAGRAM_STREAM_PROFILE);
  assert.equal(e.width, 1080);
  assert.equal(e.height, 1920);
  assert.equal(e.framerate, 30);
  assert.equal(e.videoBitrate, 3500);
  assert.equal(e.keyFrameInterval, 2);
});

test("labels match preset table", () => {
  assert.equal(MEDIA_PRESET_LABELS.standard_720p30, "Standard (720p30)");
  assert.equal(MEDIA_PRESET_LABELS.ultra_4k30, "Cinema (4K30)");
});
