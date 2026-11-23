import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKickIngestUrl,
  checkKickEncoderProfile,
  isKickPlatform,
  KICK_ERROR_MESSAGES,
  normalizeKickServerUrl,
  normalizeKickStreamKey,
  resolveKickCredentials,
  scrubKickKeys,
} from "./kickDestinationPure";
import { applyDestinationCaps, encodingOptionsFor, MEDIA_PRESETS } from "./mediaPresets";

const KICK_URL = "rtmps://fa723fc1b171.global-contribute.live-video.net:443/app/";
const KEY = "sk_us-west-2_AbCdEf123456";

test("platform id is case/space insensitive", () => {
  assert.equal(isKickPlatform("kick"), true);
  assert.equal(isKickPlatform(" KICK "), true);
  assert.equal(isKickPlatform("twitch"), false);
  assert.equal(isKickPlatform(undefined), false);
});

test("server URL: keeps host, port and ingest path; drops trailing slash", () => {
  const r = normalizeKickServerUrl(KICK_URL);
  assert.deepEqual(r, { ok: true, url: "rtmps://fa723fc1b171.global-contribute.live-video.net:443/app", embeddedKey: null });
  const deep = normalizeKickServerUrl("rtmps://ingest.example.net/live/app/v2//");
  assert.deepEqual(deep, { ok: true, url: "rtmps://ingest.example.net/live/app/v2", embeddedKey: null });
  const noPath = normalizeKickServerUrl("  rtmps://ingest.example.net  ");
  assert.deepEqual(noPath, { ok: true, url: "rtmps://ingest.example.net", embeddedKey: null });
});

test("server URL: only RTMPS is accepted", () => {
  assert.deepEqual(normalizeKickServerUrl(""), { ok: false, code: "kick_server_url_required" });
  assert.deepEqual(normalizeKickServerUrl("rtmp://ingest.example.net/app"), { ok: false, code: "kick_server_url_not_rtmps" });
  assert.deepEqual(normalizeKickServerUrl("https://kick.com/app"), { ok: false, code: "kick_server_url_not_rtmps" });
  assert.deepEqual(normalizeKickServerUrl("ingest.example.net/app"), { ok: false, code: "kick_server_url_invalid" });
});

test("server URL: credentials, queries, fragments and spaces are rejected", () => {
  for (const bad of [
    "rtmps://user:pass@ingest.example.net/app",
    "rtmps://ingest.example.net/app?token=abc",
    "rtmps://ingest.example.net/app#x",
    "rtmps://ingest.example.net/my app",
    "rtmps://",
  ]) {
    assert.deepEqual(normalizeKickServerUrl(bad), { ok: false, code: "kick_server_url_invalid" }, bad);
  }
});

test("server URL: a Kick key pasted onto the URL is split off, not kept in the URL", () => {
  const r = normalizeKickServerUrl(`${KICK_URL}${KEY}`);
  assert.deepEqual(r, { ok: true, url: "rtmps://fa723fc1b171.global-contribute.live-video.net:443/app", embeddedKey: KEY });
});

test("stream key: whitespace stripped; URLs and odd characters rejected", () => {
  assert.deepEqual(normalizeKickStreamKey(`  ${KEY}\n`), { ok: true, key: KEY });
  assert.deepEqual(normalizeKickStreamKey(""), { ok: false, code: "kick_stream_key_required" });
  assert.deepEqual(normalizeKickStreamKey(`${KICK_URL}${KEY}`), { ok: false, code: "kick_stream_key_invalid" });
  assert.deepEqual(normalizeKickStreamKey("sk/abc"), { ok: false, code: "kick_stream_key_invalid" });
  assert.deepEqual(normalizeKickStreamKey("a".repeat(257)), { ok: false, code: "kick_stream_key_invalid" });
});

test("credentials: key from field, from URL, or both when they agree", () => {
  assert.deepEqual(resolveKickCredentials({ serverUrl: KICK_URL, streamKey: KEY, requireKey: true }), {
    ok: true,
    serverUrl: "rtmps://fa723fc1b171.global-contribute.live-video.net:443/app",
    streamKey: KEY,
  });
  assert.deepEqual(resolveKickCredentials({ serverUrl: `${KICK_URL}${KEY}`, requireKey: true }), {
    ok: true,
    serverUrl: "rtmps://fa723fc1b171.global-contribute.live-video.net:443/app",
    streamKey: KEY,
  });
  assert.equal(resolveKickCredentials({ serverUrl: `${KICK_URL}${KEY}`, streamKey: KEY, requireKey: true }).ok, true);
  assert.deepEqual(resolveKickCredentials({ serverUrl: `${KICK_URL}${KEY}`, streamKey: "sk_other", requireKey: true }), {
    ok: false,
    code: "kick_server_url_key_mismatch",
  });
  assert.deepEqual(resolveKickCredentials({ serverUrl: KICK_URL, streamKey: "  ", requireKey: true }), {
    ok: false,
    code: "kick_stream_key_required",
  });
  assert.deepEqual(resolveKickCredentials({ serverUrl: KICK_URL, requireKey: false }), {
    ok: true,
    serverUrl: "rtmps://fa723fc1b171.global-contribute.live-video.net:443/app",
    streamKey: null,
  });
});

test("ingest URL: the key is appended exactly once", () => {
  const base = "rtmps://fa723fc1b171.global-contribute.live-video.net:443/app";
  const full = `${base}/${KEY}`;
  assert.equal(buildKickIngestUrl(base, KEY), full);
  assert.equal(buildKickIngestUrl(`${base}/`, KEY), full);
  assert.equal(buildKickIngestUrl(full, KEY), full);
  assert.equal(buildKickIngestUrl(`${full}/`, KEY), full);
});

test("encoder profile: every StreamLine preset up to 1080p60 fits Kick once Kick's caps are applied", () => {
  for (const preset of MEDIA_PRESETS) {
    const capped = applyDestinationCaps(preset.id, ["kick"], "ultra_4k30");
    assert.equal(checkKickEncoderProfile(encodingOptionsFor(capped.profile)).ok, true, preset.id);
    assert.ok(capped.profile.height <= 1080 && capped.profile.fps <= 60 && capped.profile.videoKbps <= 8000, preset.id);
  }
});

test("encoder profile: Kick caps reduce a 1440p/4K request (and the label says Kick)", () => {
  const r = applyDestinationCaps("ultra_4k30", ["youtube", "kick"], "ultra_4k30");
  assert.equal(r.effectiveId, "sports_1080p60");
  assert.equal(r.adjustmentReason, "Adjusted to 1080p60 for Kick");
});

test("encoder profile: incompatible settings are reported with every problem", () => {
  const r = checkKickEncoderProfile({ width: 2560, height: 1440, framerate: 120, videoBitrate: 9000, keyFrameInterval: 4, videoCodec: "VP8" });
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.equal(r.code, "kick_profile_incompatible");
    assert.equal(r.problems.length, 5);
  }
  assert.equal(checkKickEncoderProfile({ width: 1920, height: 1080, framerate: 60, videoBitrate: 8000, keyFrameInterval: 2 }).ok, true);
  assert.equal(checkKickEncoderProfile({ width: 1920, height: 1080, framerate: 60, videoBitrate: 8000, keyFrameInterval: 2, videoCodec: "H264_MAIN" }).ok, true);
  assert.equal(checkKickEncoderProfile({ width: 1920, height: 1080, framerate: 30, videoBitrate: 8001, keyFrameInterval: 2 }).ok, false);
  assert.equal(checkKickEncoderProfile({ width: 1920, height: 1080, framerate: 30, videoBitrate: 4500, keyFrameInterval: 0 }).ok, false);
});

test("messages never echo input; key scrubbing for error strings", () => {
  for (const msg of Object.values(KICK_ERROR_MESSAGES)) {
    assert.equal(/sk_[A-Za-z0-9]/.test(msg), false);
  }
  assert.equal(scrubKickKeys(`publish rejected for ${KEY}: unauthorized`), "publish rejected for sk_***: unauthorized");
  assert.equal(scrubKickKeys(null), null);
});
