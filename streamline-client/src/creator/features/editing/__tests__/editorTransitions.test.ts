import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../store/editorStore";
import { splitAtPlayhead } from "../engine/operations";
import { editorStateToTimeline } from "../engine/projectIO";
import { transitionOpacityAt } from "../engine/transitionPreview";
import type { TimelineClip, Track } from "../types";

const tracks: Track[] = [
  { id: "video_1", name: "Video 1", type: "video", order: 0, isMuted: false, isSolo: false, isLocked: false },
  { id: "audio_1", name: "Audio 1", type: "audio", order: 1, isMuted: false, isSolo: false, isLocked: false },
];

function vclip(id: string, start: number, end: number, extra: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id,
    assetId: "a",
    trackId: "video_1",
    type: "video",
    timelineStart: start,
    timelineEnd: end,
    sourceStart: 0,
    sourceEnd: end - start,
    linkedGroupId: null,
    isMuted: false,
    isHidden: false,
    displayName: id,
    volume: 1,
    ...extra,
  };
}

function hydrateWith(clips: TimelineClip[]) {
  useEditorStore.getState().hydrateProject({
    projectId: "p1",
    projectName: "P",
    tracks: tracks.map((t) => ({ ...t })),
    clips,
    assets: new Map(),
  });
}

describe("clip transitions", () => {
  beforeEach(() => hydrateWith([vclip("a", 0, 2), vclip("b", 2, 4)]));

  it("store sets, clamps and clears a video clip's transition (undoable)", () => {
    const st = useEditorStore.getState();
    st.setClipTransition("b", { type: "crossfade", durationMs: 99999 });
    expect(useEditorStore.getState().clips.find((c) => c.id === "b")!.transitionIn).toEqual({ type: "crossfade", durationMs: 3000 });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().clips.find((c) => c.id === "b")!.transitionIn).toBeUndefined();
    useEditorStore.getState().setClipTransition("b", { type: "fade", durationMs: 500 });
    useEditorStore.getState().setClipTransition("b", null);
    expect("transitionIn" in useEditorStore.getState().clips.find((c) => c.id === "b")!).toBe(false);
  });

  it("is saved with the project timeline (video clips only)", () => {
    const t = editorStateToTimeline([vclip("b", 2, 4, { transitionIn: { type: "dip_to_black", durationMs: 800 } })], tracks);
    expect(t.clips[0].transitionIn).toEqual({ type: "dip_to_black", durationMs: 800 });
  });

  it("split keeps the transition on the left half only", () => {
    const out = splitAtPlayhead(3, [vclip("b", 2, 4, { transitionIn: { type: "fade", durationMs: 500 } })], tracks);
    expect(out).toHaveLength(2);
    expect(out[0].transitionIn).toEqual({ type: "fade", durationMs: 500 });
    expect(out[1].transitionIn).toBeUndefined();
  });

  it("preview opacity ramps over the transition window", () => {
    const a = vclip("a", 0, 2);
    const b = vclip("b", 2, 4, { transitionIn: { type: "dip_to_black", durationMs: 1000 } });
    const clips = [a, b];
    // Dip: previous clip fades out over the last 0.5s, next fades in over 0.5s.
    expect(transitionOpacityAt(1.0, a, clips)).toBe(1);
    expect(transitionOpacityAt(1.75, a, clips)).toBeCloseTo(0.5);
    expect(transitionOpacityAt(2.25, b, clips)).toBeCloseTo(0.5);
    expect(transitionOpacityAt(3, b, clips)).toBe(1);
    const f = vclip("f", 5, 7, { transitionIn: { type: "fade", durationMs: 1000 } });
    expect(transitionOpacityAt(5.5, f, [f])).toBeCloseTo(0.5);
    expect(transitionOpacityAt(5, null, [])).toBe(1);
  });
});
