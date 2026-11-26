import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_MEDIA_VIDEOS, MEDIA_VIDEO_LIMITS, normalizeMediaVideos, parseMediaVideosInput } from "./mediaVideosPure";

test("parseMediaVideosInput accepts library files and YouTube videos", () => {
  const r = parseMediaVideosInput({
    videos: [
      { assetId: "v1", name: " Intro reel " },
      { youtubeId: "dQw4w9WgXcQ", name: "Song", volume: 0.5 },
    ],
    playMode: "next",
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    videos: [
      { assetId: "v1", name: "Intro reel", volume: 1 },
      { youtubeId: "dQw4w9WgXcQ", name: "Song", volume: 0.5 },
    ],
    playMode: "next",
  });
});

test("parseMediaVideosInput defaults the play mode and maps the old loop flag", () => {
  assert.equal(parseMediaVideosInput({ videos: [] }).value?.playMode, "once");
  assert.equal(parseMediaVideosInput({ videos: [], loop: true }).value?.playMode, "loop");
  assert.equal(parseMediaVideosInput({ videos: [], loop: true, playMode: "nextLoop" }).value?.playMode, "nextLoop");
});

test("parseMediaVideosInput rejects bad input", () => {
  assert.equal(parseMediaVideosInput(null).ok, false);
  assert.equal(parseMediaVideosInput([]).ok, false);
  assert.equal(parseMediaVideosInput({ videos: "x" }).field, "videos");
  assert.equal(parseMediaVideosInput({ videos: [{ name: "a" }] }).field, "videos[0]");
  assert.equal(parseMediaVideosInput({ videos: [{ assetId: "a", youtubeId: "dQw4w9WgXcQ", name: "a" }] }).field, "videos[0]");
  assert.equal(parseMediaVideosInput({ videos: [{ assetId: "../x", name: "a" }] }).field, "videos[0].assetId");
  assert.equal(parseMediaVideosInput({ videos: [{ youtubeId: "short", name: "a" }] }).field, "videos[0].youtubeId");
  assert.equal(parseMediaVideosInput({ videos: [{ youtubeId: "dQw4w9WgXc<", name: "a" }] }).field, "videos[0].youtubeId");
  assert.equal(parseMediaVideosInput({ videos: [{ assetId: "a", name: "" }] }).field, "videos[0].name");
  assert.equal(parseMediaVideosInput({ videos: [{ assetId: "a", name: "x", volume: -1 }] }).field, "videos[0].volume");
  assert.equal(parseMediaVideosInput({ playMode: "shuffle" }).field, "playMode");
  const many = Array.from({ length: MEDIA_VIDEO_LIMITS.videos + 1 }, (_, i) => ({ assetId: `v${i}`, name: "x" }));
  assert.equal(parseMediaVideosInput({ videos: many }).field, "videos");
});

test("normalizeMediaVideos tolerates missing or broken stored data", () => {
  assert.deepEqual(normalizeMediaVideos(undefined), EMPTY_MEDIA_VIDEOS);
  assert.deepEqual(normalizeMediaVideos({ videos: "broken" }), EMPTY_MEDIA_VIDEOS);
  assert.deepEqual(normalizeMediaVideos({ videos: [{ assetId: "a", name: "A" }], updatedAt: 1 }), {
    videos: [{ assetId: "a", name: "A", volume: 1 }],
    playMode: "once",
  });
});
