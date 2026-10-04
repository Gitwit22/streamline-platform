import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../store/editorStore";
import { resolvePlayback } from "../engine/playbackResolver";
import { placeAssetOnTimeline, unlinkClips } from "../engine/operations";
import { editorStateToTimeline, payloadToEditorState } from "../engine/projectIO";
import type { SourceAsset, TimelineClip, Track } from "../types";
import { MAX_CLIP_VOLUME, videoClipPlaysEmbeddedAudio } from "../types";
import type { EditorProjectPayload } from "../../../../lib/projectsApi";

const tracks: Track[] = [
  { id: "video_1", name: "Video 1", type: "video", order: 0, isMuted: false, isSolo: false, isLocked: false },
  { id: "audio_1", name: "Audio 1", type: "audio", order: 1, isMuted: false, isSolo: false, isLocked: false },
];

const av: SourceAsset = { id: "rec1", type: "video", url: "https://r2/rec1", fileName: "Rec", duration: 10, hasVideo: true, hasAudio: true };

function hydrateWith(clips: TimelineClip[]) {
  useEditorStore.getState().hydrateProject({
    projectId: "p1",
    projectName: "P",
    tracks: tracks.map((t) => ({ ...t })),
    clips,
    assets: new Map([[av.id, av]]),
  });
}

describe("editor store — clip volume / mute", () => {
  beforeEach(() => {
    const { newClips } = placeAssetOnTimeline(av, 0, tracks, []);
    hydrateWith(newClips);
  });

  it("setClipVolume persists a gain clamped to 0..MAX_CLIP_VOLUME and marks dirty", () => {
    const audio = useEditorStore.getState().clips.find((c) => c.type === "audio")!;
    useEditorStore.getState().setClipVolume(audio.id, 0.5);
    expect(useEditorStore.getState().clips.find((c) => c.id === audio.id)!.volume).toBe(0.5);
    expect(useEditorStore.getState().isDirty).toBe(true);
    useEditorStore.getState().setClipVolume(audio.id, 9);
    expect(useEditorStore.getState().clips.find((c) => c.id === audio.id)!.volume).toBe(MAX_CLIP_VOLUME);
    useEditorStore.getState().setClipVolume(audio.id, -1);
    expect(useEditorStore.getState().clips.find((c) => c.id === audio.id)!.volume).toBe(0);
  });

  it("setClipMuted and track mute are saved in the timeline payload", () => {
    const audio = useEditorStore.getState().clips.find((c) => c.type === "audio")!;
    useEditorStore.getState().setClipMuted(audio.id, true);
    useEditorStore.getState().toggleMute("audio_1");
    const s = useEditorStore.getState();
    expect(s.isDirty).toBe(true);
    const payload = editorStateToTimeline(s.clips, s.tracks);
    expect(payload.clips.find((c) => c.id === audio.id)!.isMuted).toBe(true);
    expect(payload.tracks.find((t) => t.id === "audio_1")!.isMuted).toBe(true);
  });

  it("muted clip / muted track are not audible in the preview", () => {
    const audio = useEditorStore.getState().clips.find((c) => c.type === "audio")!;
    let s = useEditorStore.getState();
    expect(resolvePlayback(1, s.clips, s.tracks).activeAudioClips.map((c) => c.id)).toEqual([audio.id]);
    s.setClipMuted(audio.id, true);
    s = useEditorStore.getState();
    expect(resolvePlayback(1, s.clips, s.tracks).activeAudioClips).toHaveLength(0);
    s.setClipMuted(audio.id, false);
    s.toggleMute("audio_1");
    s = useEditorStore.getState();
    expect(resolvePlayback(1, s.clips, s.tracks).activeAudioClips).toHaveLength(0);
  });
});

describe("embedded audio of video clips", () => {
  it("linked A/V pair: sound comes from the audio clip, not the video element", () => {
    const { newClips } = placeAssetOnTimeline(av, 0, tracks, []);
    const pb = resolvePlayback(1, newClips, tracks);
    expect(pb.activeVideoClip?.type).toBe("video");
    expect(pb.videoPlaysEmbeddedAudio).toBe(false);
  });

  it("video clip without an audio partner plays its own audio (and a clip mute silences it)", () => {
    const { newClips } = placeAssetOnTimeline(av, 0, tracks, []);
    const videoOnly = newClips.filter((c) => c.type === "video").map((c) => ({ ...c, linkedGroupId: null }));
    expect(resolvePlayback(1, videoOnly, tracks).videoPlaysEmbeddedAudio).toBe(true);
    const muted = videoOnly.map((c) => ({ ...c, isMuted: true }));
    const pb = resolvePlayback(1, muted, tracks);
    expect(pb.activeVideoClip).not.toBeNull(); // clip mute does not hide the picture
    expect(pb.videoPlaysEmbeddedAudio).toBe(false);
  });

  it("unlinking detaches the video clip's audio (no double sound)", () => {
    const { newClips } = placeAssetOnTimeline(av, 0, tracks, []);
    const group = newClips[0].linkedGroupId!;
    const unlinked = unlinkClips(group, newClips);
    const v = unlinked.find((c) => c.type === "video")!;
    expect(v.linkedGroupId).toBeNull();
    expect(v.audioDetached).toBe(true);
    expect(videoClipPlaysEmbeddedAudio(v, unlinked)).toBe(false);
  });
});

describe("project payload <-> store", () => {
  it("hydrates the saved timeline (volume, mute, links) and resolves media URLs", () => {
    const payload: EditorProjectPayload = {
      project: { id: "p1", ownerId: "u", name: "P", createdBy: "u", status: "active", thumbnail: null, createdAt: "", updatedAt: "", assetCount: 0, sourceRoomId: null, sourceRoomName: null },
      timeline: {
        version: 2,
        tracks: tracks.map((t) => ({ ...t })),
        clips: [
          { id: "a", assetId: "rec1", trackId: "audio_1", type: "audio", timelineStart: 0, timelineEnd: 5, sourceStart: 0, sourceEnd: 5, linkedGroupId: "g", isMuted: true, isHidden: false, displayName: "A", volume: 1.5 },
          { id: "m", assetId: "gone", trackId: "audio_1", type: "audio", timelineStart: 5, timelineEnd: 8, sourceStart: 0, sourceEnd: 3, linkedGroupId: null, isMuted: false, isHidden: false, displayName: "Music", volume: 1 },
        ],
      },
      mediaAssets: {
        rec1: { id: "rec1", type: "recording", source: "stream", collection: "recordings", name: "Rec", duration: 10, fileSize: 0, videoUrl: "https://signed", thumbnailUrl: null, thumbnail: "", createdAt: "", status: "ready", hasVideo: true, hasAudio: true, userId: "u" },
      },
      projectAssets: [],
      migratedFrom: null,
    };
    const state = payloadToEditorState(payload);
    const a = state.clips.find((c) => c.id === "a")!;
    expect(a.volume).toBe(1.5);
    expect(a.isMuted).toBe(true);
    expect(state.assets.get("rec1")!.url).toBe("https://signed");
    expect(state.assets.get("gone")!.url).toBe(""); // missing media keeps its clip
    const roundTrip = editorStateToTimeline(state.clips, state.tracks);
    expect(roundTrip.clips.map((c) => c.volume)).toEqual([1.5, 1]);
  });
});
