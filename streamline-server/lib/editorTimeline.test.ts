import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildExportTimeline,
  clampVolume,
  effectiveMutedTrackIds,
  legacyTimelineToEditor,
  sanitizeEditorTimeline,
  videoClipPlaysEmbeddedAudio,
  type EditorClip,
  type EditorTimeline,
} from "./editorTimeline.js";

const vclip = (p: Partial<EditorClip> = {}): EditorClip => ({
  id: "v", assetId: "rec1", trackId: "video_1", type: "video",
  timelineStart: 0, timelineEnd: 10, sourceStart: 0, sourceEnd: 10,
  linkedGroupId: null, isMuted: false, isHidden: false, displayName: "V", volume: 1, ...p,
});

describe("sanitizeEditorTimeline", () => {
  it("keeps volume (clamped 0..2), mute, link and type; drops invalid clips", () => {
    const r = sanitizeEditorTimeline({
      tracks: [
        { id: "video_1", name: "Video 1", type: "video", order: 0, isMuted: false },
        { id: "audio_1", name: "Audio 1", type: "audio", order: 1, isMuted: true, isSolo: false },
      ],
      clips: [
        { id: "c1", assetId: "a", trackId: "video_1", type: "video", timelineStart: 0, timelineEnd: 5, sourceStart: 1, sourceEnd: 6, linkedGroupId: "g", volume: 3, isMuted: true },
        { id: "c2", assetId: "a", trackId: "audio_1", type: "audio", timelineStart: 0, timelineEnd: 5, sourceStart: 1, sourceEnd: 6, linkedGroupId: "g", volume: 0.25 },
        { id: "", assetId: "a", trackId: "video_1", timelineStart: 0, timelineEnd: 1 },
        { id: "c3", assetId: "a", trackId: "video_1", timelineStart: 4, timelineEnd: 4 },
      ],
    });
    assert.ok("timeline" in r);
    const t = (r as { timeline: EditorTimeline }).timeline;
    assert.equal(t.version, 2);
    assert.equal(t.clips.length, 2);
    assert.equal(t.clips[0].volume, 2);
    assert.equal(t.clips[0].isMuted, true);
    assert.equal(t.clips[1].volume, 0.25);
    assert.equal(t.clips[1].linkedGroupId, "g");
    assert.equal(t.tracks[1].isMuted, true);
  });

  it("rejects clips on unknown tracks and non-array clips", () => {
    assert.ok("error" in sanitizeEditorTimeline({ clips: [{ id: "x", assetId: "a", trackId: "nope", timelineStart: 0, timelineEnd: 1 }] }));
    assert.ok("error" in sanitizeEditorTimeline({ clips: "x" }));
  });

  it("clampVolume defaults to unity", () => {
    assert.equal(clampVolume(undefined), 1);
    assert.equal(clampVolume(-1), 0);
    assert.equal(clampVolume("0.5"), 0.5);
  });
});

describe("legacyTimelineToEditor (editing_projects.timeline)", () => {
  it("converts seconds format and re-links A/V pairs saved without link info", () => {
    const t = legacyTimelineToEditor({
      tracks: [
        { id: "video_1", name: "Video 1", type: "video", muted: false },
        { id: "audio_1", name: "Audio 1", type: "audio", muted: true },
      ],
      clips: [
        { id: "v1", assetId: "rec1", trackId: "video_1", startTime: 2, duration: 5, inPoint: 1, outPoint: 6, name: "Clip", videoUrl: "https://x" },
        { id: "a1", assetId: "rec1", trackId: "audio_1", startTime: 2, duration: 5, inPoint: 1, outPoint: 6, name: "Clip" },
        { id: "v2", assetId: "rec2", trackId: "video_1", startTime: 7, duration: 3, inPoint: 0, outPoint: 3, name: "Solo" },
      ],
    });
    const v1 = t.clips.find((c) => c.id === "v1")!;
    const a1 = t.clips.find((c) => c.id === "a1")!;
    const v2 = t.clips.find((c) => c.id === "v2")!;
    assert.deepEqual([v1.timelineStart, v1.timelineEnd, v1.sourceStart, v1.sourceEnd], [2, 7, 1, 6]);
    assert.equal(a1.type, "audio");
    assert.ok(v1.linkedGroupId && v1.linkedGroupId === a1.linkedGroupId);
    assert.equal(v2.linkedGroupId, null);
    assert.equal(t.tracks[1].isMuted, true);
    // no URL is carried over
    assert.equal((v1 as any).videoUrl, undefined);
    assert.equal(videoClipPlaysEmbeddedAudio(v1, t.clips), false);
    assert.equal(videoClipPlaysEmbeddedAudio(v2, t.clips), true);
  });

  it("numeric tracks (old default `tracks: 2`) get the default video+audio tracks", () => {
    const t = legacyTimelineToEditor({ clips: [], tracks: 2 });
    assert.deepEqual(t.tracks.map((x) => x.id), ["video_1", "audio_1"]);
  });
});

describe("mixing rules", () => {
  it("solo mutes every non-solo track; otherwise muted tracks", () => {
    const tracks = [
      { id: "v", name: "", type: "video" as const, order: 0, isMuted: false, isSolo: false, isLocked: false },
      { id: "a", name: "", type: "audio" as const, order: 1, isMuted: true, isSolo: false, isLocked: false },
      { id: "m", name: "", type: "audio" as const, order: 2, isMuted: false, isSolo: false, isLocked: false },
    ];
    assert.deepEqual([...effectiveMutedTrackIds(tracks)], ["a"]);
    tracks[2].isSolo = true;
    assert.deepEqual([...effectiveMutedTrackIds(tracks)].sort(), ["a", "v"]);
  });

  it("unlinked-with-detached-audio video clip does not play embedded audio", () => {
    assert.equal(videoClipPlaysEmbeddedAudio(vclip({ audioDetached: true }), []), false);
    assert.equal(videoClipPlaysEmbeddedAudio(vclip({ linkedGroupId: "g" }), [vclip({ id: "a", type: "audio", linkedGroupId: "g" })]), false);
    assert.equal(videoClipPlaysEmbeddedAudio(vclip({ linkedGroupId: "g" }), []), true);
  });
});

describe("buildExportTimeline", () => {
  const timeline: EditorTimeline = {
    version: 2,
    tracks: [
      { id: "video_1", name: "V", type: "video", order: 0, isMuted: false, isSolo: false, isLocked: false },
      { id: "audio_1", name: "A", type: "audio", order: 1, isMuted: true, isSolo: false, isLocked: false },
    ],
    clips: [
      vclip({ id: "v", linkedGroupId: "g" }),
      vclip({ id: "a", type: "audio", trackId: "audio_1", linkedGroupId: "g", volume: 0.5, isMuted: true }),
    ],
  };

  it("carries volume / mute / track mute / embedded audio into the render contract", () => {
    const r = buildExportTimeline(timeline, new Map([["rec1", { sourceKey: "recordings/x.mp4", mediaType: "video" as const }]]), { width: 1280, height: 720 });
    assert.ok("timeline" in r);
    const out = (r as any).timeline;
    assert.equal(out.version, 2);
    assert.equal(out.durationMs, 10_000);
    const audioTrack = out.tracks.find((t: any) => t.id === "audio_1");
    assert.equal(audioTrack.muted, true);
    const a = audioTrack.clips[0];
    assert.equal(a.volume, 0.5);
    assert.equal(a.muted, true);
    assert.equal(a.kind, "audio");
    const v = out.tracks[0].clips[0];
    assert.equal(v.embeddedAudio, false);
    assert.equal(v.sourceKey, "recordings/x.mp4");
    assert.equal(v.sourceUrl, "");
  });

  it("fails when a clip's media cannot be resolved", () => {
    const r = buildExportTimeline(timeline, new Map(), { width: 1280, height: 720 });
    assert.ok("error" in r);
    assert.equal((r as any).error, "clip_source_unavailable");
  });
});
