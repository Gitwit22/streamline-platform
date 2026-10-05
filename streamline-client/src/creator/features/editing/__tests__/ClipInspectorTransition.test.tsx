import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../../lib/editingApi", () => ({
  editingApi: {
    getExportOptions: vi.fn(async () => ({ transitions: { basic: true, advanced: false } })),
  },
}));

import ClipInspector from "../components/ClipInspector";
import { useEditorStore } from "../store/editorStore";
import type { TimelineClip, Track } from "../types";

const tracks: Track[] = [{ id: "video_1", name: "Video 1", type: "video", order: 0, isMuted: false, isSolo: false, isLocked: false }];
const clip: TimelineClip = {
  id: "c1", assetId: "a", trackId: "video_1", type: "video", timelineStart: 0, timelineEnd: 4, sourceStart: 0, sourceEnd: 4,
  linkedGroupId: null, isMuted: false, isHidden: false, displayName: "Clip", volume: 1,
};

describe("ClipInspector transition picker", () => {
  afterEach(cleanup);

  it("offers plan-allowed transitions and writes the choice to the clip", async () => {
    useEditorStore.getState().hydrateProject({ projectId: "p", projectName: "P", tracks, clips: [clip], assets: new Map() });
    useEditorStore.getState().selectClip("c1");
    render(<ClipInspector />);
    const select = (await screen.findByLabelText(/Transition in/)) as HTMLSelectElement;
    await waitFor(() => {
      const cross = Array.from(select.options).find((o) => o.value === "crossfade")!;
      expect(cross.disabled).toBe(true);
      expect(cross.textContent).toContain("upgrade");
    });
    fireEvent.change(select, { target: { value: "fade" } });
    expect(useEditorStore.getState().clips[0].transitionIn).toEqual({ type: "fade", durationMs: 1000 });
    fireEvent.change(screen.getByLabelText("Transition duration"), { target: { value: "1500" } });
    expect(useEditorStore.getState().clips[0].transitionIn).toEqual({ type: "fade", durationMs: 1500 });
    fireEvent.change(select, { target: { value: "" } });
    expect(useEditorStore.getState().clips[0].transitionIn).toBeUndefined();
  });
});
