import { describe, expect, it, vi } from "vitest";
import {
  CAMERA_EFFECT_PROCESSOR_NAME,
  FAILED_MESSAGE,
  UNSUPPORTED_MESSAGE,
  createCameraEffectApplier,
  type OurProcessor,
  type ProcessableTrack,
} from "./cameraEffectApplier";
import { NO_EFFECT, type CameraEffect, type ProcessorOptions } from "./cameraEffects";

type FakeProcessor = OurProcessor & { opts?: ProcessorOptions; switchTo: ReturnType<typeof vi.fn> };

function fakeTrack(opts: { muted?: boolean; setFails?: boolean } = {}) {
  let processor: OurProcessor | undefined;
  const track: ProcessableTrack = {
    isMuted: !!opts.muted,
    getProcessor: () => processor,
    setProcessor: vi.fn(async (p: OurProcessor) => {
      if (opts.setFails) throw new Error("webgl2 unavailable");
      processor = p;
    }),
    stopProcessor: vi.fn(async () => {
      processor = undefined;
    }),
  };
  return track;
}

function fakeModule(supported = true) {
  return {
    supportsBackgroundProcessors: () => supported,
    BackgroundProcessor: vi.fn((opts: ProcessorOptions, name?: string) => {
      const p = { name: name || "", opts } as FakeProcessor;
      p.switchTo = vi.fn(async (o: ProcessorOptions) => {
        p.opts = o;
      });
      return p;
    }),
  };
}

function setup(track: ProcessableTrack | null, mod = fakeModule(), baseOptions?: { assetPaths: { tasksVisionFileSet: string } }) {
  let desired: { effect: CameraEffect; imageUrl: string | null } = { effect: NO_EFFECT, imageUrl: null };
  const onFail = vi.fn();
  const onApplied = vi.fn();
  const apply = createCameraEffectApplier({
    getTrack: () => track,
    getDesired: () => desired,
    loadModule: async () => mod,
    baseOptions,
    onApplying: () => {},
    onApplied,
    onFail,
  });
  const select = (effect: CameraEffect, imageUrl: string | null = null) => {
    desired = { effect, imageUrl };
    return apply();
  };
  return { select, onFail, onApplied, mod };
}

describe("createCameraEffectApplier", () => {
  it("sets a named blur processor on the camera track", async () => {
    const track = fakeTrack();
    const { select, mod, onApplied } = setup(track);
    await select({ mode: "blur-strong", imageId: null });
    expect(mod.BackgroundProcessor).toHaveBeenCalledWith({ mode: "background-blur", blurRadius: 14 }, CAMERA_EFFECT_PROCESSOR_NAME);
    expect(track.getProcessor()?.name).toBe(CAMERA_EFFECT_PROCESSOR_NAME);
    expect(onApplied).toHaveBeenCalled();
  });

  it("switches the existing processor instead of creating another", async () => {
    const track = fakeTrack();
    const { select, mod } = setup(track);
    await select({ mode: "blur-light", imageId: null });
    await select({ mode: "image", imageId: "ocean" }, "data:image/jpeg;base64,AA");
    expect(mod.BackgroundProcessor).toHaveBeenCalledTimes(1);
    expect(track.setProcessor).toHaveBeenCalledTimes(1);
    expect((track.getProcessor() as FakeProcessor).opts).toEqual({ mode: "virtual-background", imagePath: "data:image/jpeg;base64,AA" });
  });

  it("removes the processor when set back to none", async () => {
    const track = fakeTrack();
    const { select } = setup(track);
    await select({ mode: "blur-light", imageId: null });
    await select(NO_EFFECT);
    expect(track.stopProcessor).toHaveBeenCalledTimes(1);
    expect(track.getProcessor()).toBeUndefined();
  });

  it("never stops a processor it didn't set", async () => {
    const track = fakeTrack();
    await track.setProcessor({ name: "someone-else" });
    const { select } = setup(track);
    await select(NO_EFFECT);
    expect(track.stopProcessor).not.toHaveBeenCalled();
  });

  it("waits while the camera is off or not published", async () => {
    const muted = fakeTrack({ muted: true });
    const a = setup(muted);
    await a.select({ mode: "blur-light", imageId: null });
    expect(muted.setProcessor).not.toHaveBeenCalled();

    const none = setup(null);
    await none.select({ mode: "blur-light", imageId: null });
    expect(none.mod.BackgroundProcessor).not.toHaveBeenCalled();
    expect(none.onFail).not.toHaveBeenCalled();
  });

  it("reports unsupported browsers without touching the camera", async () => {
    const track = fakeTrack();
    const { select, onFail } = setup(track, fakeModule(false));
    await select({ mode: "blur-light", imageId: null });
    expect(onFail).toHaveBeenCalledWith(UNSUPPORTED_MESSAGE);
    expect(track.setProcessor).not.toHaveBeenCalled();
  });

  it("reports a failed setup and leaves the camera without a processor", async () => {
    const track = fakeTrack({ setFails: true });
    const { select, onFail, onApplied } = setup(track);
    await select({ mode: "blur-light", imageId: null });
    expect(onFail).toHaveBeenCalledWith(FAILED_MESSAGE);
    expect(onApplied).not.toHaveBeenCalled();
    expect(track.getProcessor()).toBeUndefined();
  });

  it("serializes rapid changes and ends on the latest choice", async () => {
    const track = fakeTrack();
    const { select, mod } = setup(track);
    const runs = [
      select({ mode: "blur-light", imageId: null }),
      select({ mode: "blur-strong", imageId: null }),
      select({ mode: "image", imageId: "sunset" }, "data:image/jpeg;base64,BB"),
    ];
    await Promise.all(runs);
    // Let the queued re-run finish.
    await new Promise((r) => setTimeout(r, 0));
    expect(track.setProcessor).toHaveBeenCalledTimes(1);
    expect(mod.BackgroundProcessor).toHaveBeenCalledTimes(1);
    expect((track.getProcessor() as FakeProcessor).opts).toEqual({ mode: "virtual-background", imagePath: "data:image/jpeg;base64,BB" });
  });

  it("passes creation-only options (self-hosted MediaPipe files) to the processor", async () => {
    const track = fakeTrack();
    const base = { assetPaths: { tasksVisionFileSet: "https://app.example.com/mediapipe/wasm" } };
    const { select, mod } = setup(track, fakeModule(), base);
    await select({ mode: "blur-light", imageId: null });
    expect(mod.BackgroundProcessor).toHaveBeenCalledWith(
      { mode: "background-blur", blurRadius: 6, assetPaths: base.assetPaths },
      CAMERA_EFFECT_PROCESSOR_NAME,
    );
  });
});
