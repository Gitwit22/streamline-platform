/**
 * Applies a camera background selection (lib/cameraEffects.ts) to the local
 * camera track through @livekit/track-processors. Pure of React and LiveKit
 * room wiring so it can be tested with a fake track; the room wiring is
 * components/CameraEffectController.tsx.
 */
import { processorOptionsFor, type CameraEffect, type ProcessorOptions } from "./cameraEffects";

/** Name we give our processor, so we never touch one we didn't set. */
export const CAMERA_EFFECT_PROCESSOR_NAME = "sl-camera-background";

export type OurProcessor = { name: string; switchTo?: (opts: ProcessorOptions) => Promise<void> };

/** The parts of LocalVideoTrack the applier uses (a fake in tests). */
export type ProcessableTrack = {
  isMuted: boolean;
  getProcessor: () => OurProcessor | undefined;
  setProcessor: (p: OurProcessor) => Promise<void>;
  stopProcessor: () => Promise<void>;
};

/** Options passed on creation only (not on switchTo), e.g. where MediaPipe's files live. */
export type ProcessorBaseOptions = { assetPaths?: { tasksVisionFileSet?: string; modelAssetPath?: string } };

export type ProcessorModule = {
  supportsBackgroundProcessors: () => boolean;
  BackgroundProcessor: (opts: ProcessorOptions & ProcessorBaseOptions, name?: string) => OurProcessor;
};

export const UNSUPPORTED_MESSAGE = "Background effects aren't supported in this browser. Try Chrome, Edge or a recent Safari.";
export const FAILED_MESSAGE = "Couldn't turn on the background effect. Your camera is unchanged.";

/**
 * Applies the selected effect to the camera track. Runs are serialized and
 * the latest selection wins, so fast clicking can't leave two processors
 * racing. A failure reverts the selection to "None" (cameraEffectStore.fail)
 * so the picker never shows an effect nobody sees.
 */
export function createCameraEffectApplier(deps: {
  getTrack: () => ProcessableTrack | null;
  getDesired: () => { effect: CameraEffect; imageUrl: string | null };
  loadModule: () => Promise<ProcessorModule>;
  baseOptions?: ProcessorBaseOptions;
  onApplying: () => void;
  onApplied: () => void;
  onFail: (message: string) => void;
}) {
  let running = false;
  let again = false;

  async function once() {
    const track = deps.getTrack();
    // Camera off: applied when it's turned on (TrackUnmuted / LocalTrackPublished).
    if (!track || track.isMuted) return;
    const { effect, imageUrl } = deps.getDesired();
    const opts = processorOptionsFor(effect, imageUrl);
    const current = track.getProcessor();
    const ours = !!current && current.name === CAMERA_EFFECT_PROCESSOR_NAME;

    if (opts.mode === "disabled") {
      if (ours) await track.stopProcessor();
      return;
    }

    deps.onApplying();
    try {
      if (ours && typeof current!.switchTo === "function") {
        await current!.switchTo(opts);
      } else {
        const mod = await deps.loadModule();
        if (!mod.supportsBackgroundProcessors()) {
          deps.onFail(UNSUPPORTED_MESSAGE);
          return;
        }
        await track.setProcessor(mod.BackgroundProcessor({ ...opts, ...(deps.baseOptions || {}) }, CAMERA_EFFECT_PROCESSOR_NAME));
      }
      deps.onApplied();
    } catch (err) {
      console.warn("[cameraEffect] apply failed", { mode: opts.mode, error: (err as Error)?.message || String(err) });
      try {
        if (track.getProcessor()?.name === CAMERA_EFFECT_PROCESSOR_NAME) await track.stopProcessor();
      } catch {
        // The camera keeps going without the effect either way.
      }
      deps.onFail(FAILED_MESSAGE);
    }
  }

  return async function apply(): Promise<void> {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await once();
      } while (again);
    } finally {
      running = false;
    }
  };
}

/**
 * Loaded only when an effect is used: keeps MediaPipe out of the main bundle.
 * The enhanced processor is a drop-in for the library's (same wrapper and
 * switchTo contract) with smoother, cleaner mask edges and a halo-free blur.
 */
export const loadBackgroundProcessors = (): Promise<ProcessorModule> => import("./enhancedBackgroundProcessor");

/**
 * MediaPipe's WASM is served from our own origin (scripts/copy-mediapipe-wasm.cjs)
 * instead of cdn.jsdelivr.net, which some networks block.
 */
export function defaultProcessorBaseOptions(): ProcessorBaseOptions {
  return { assetPaths: { tasksVisionFileSet: new URL("/mediapipe/wasm", window.location.origin).href } };
}
