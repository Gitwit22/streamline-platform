/**
 * Higher quality camera background blur / replacement.
 *
 * Drop-in for @livekit/track-processors' BackgroundProcessor (same wrapper,
 * same switchTo() contract, same name handling), so lib/cameraEffectApplier.ts
 * and everything above it are unchanged. Differences from the library's
 * transformer:
 *
 * - Soft confidence masks from MediaPipe instead of the binary category mask
 *   (the main cause of the jagged, cut-out edges).
 * - The model sees a small copy of the frame (it runs at 256×256 anyway), with
 *   shadows lifted when the room is dark; the published video is untouched.
 * - Mask smoothing, edge refinement and the mask-aware blur live in
 *   lib/backgroundEffectGl.ts.
 *
 * If that WebGL pipeline can't be set up on a device, the library's own
 * pipeline and category mask are used, so the effect still works exactly as
 * before. Setting localStorage "sl_camera_effect_pipeline" to "standard"
 * forces the library processor (support / side-by-side comparison).
 *
 * Extends BackgroundTransformer from @livekit/track-processors, which is pinned
 * to an exact version in package.json: re-check this file when upgrading it.
 */
import * as vision from "@mediapipe/tasks-vision";
import {
  BackgroundProcessor as LibraryBackgroundProcessor,
  BackgroundProcessorWrapper,
  BackgroundTransformer,
  ProcessorWrapper,
  VideoTransformer,
  getLogger,
  LoggerNames,
  supportsBackgroundProcessors,
  type BackgroundOptions,
  type FrameProcessingStats,
  type VideoTransformerInitOptions,
} from "@livekit/track-processors";
import { setupEnhancedBackgroundGl, type EnhancedBackgroundGl } from "./backgroundEffectGl";
import { INFERENCE_LONG_EDGE, fitLongEdge, meanLuma, shadowLiftFor } from "./backgroundEffectTuning";
import type { ProcessorBaseOptions } from "./cameraEffectApplier";
import type { ProcessorOptions } from "./cameraEffects";

export { supportsBackgroundProcessors };

export const PIPELINE_OVERRIDE_STORAGE_KEY = "sl_camera_effect_pipeline";

// Same defaults the library uses when no asset paths are given.
const TASKS_VISION_VERSION = "0.10.14";
const DEFAULT_FILESET = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const DEFAULT_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

/** Measure scene brightness about once a second at 30 fps. */
const METER_EVERY_N_FRAMES = 30;

/**
 * Builds the small frame the segmentation model sees. Falls back to the
 * original frame (what the library does) if the browser can't draw a
 * VideoFrame into a 2D OffscreenCanvas.
 */
class InferenceInput {
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private meterCtx: OffscreenCanvasRenderingContext2D | null = null;
  private frameCount = 0;
  private lift = 0;
  private failed = false;

  prepare(frame: VideoFrame): TexImageSource {
    if (this.failed) return frame;
    try {
      const { width, height } = fitLongEdge(frame.displayWidth, frame.displayHeight, INFERENCE_LONG_EDGE);
      if (!this.canvas || !this.ctx) {
        this.canvas = new OffscreenCanvas(width, height);
        this.ctx = this.canvas.getContext("2d", { alpha: false });
        if (!this.ctx) throw new Error("2D OffscreenCanvas unavailable");
      }
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      const ctx = this.ctx;
      ctx.globalCompositeOperation = "copy";
      ctx.globalAlpha = 1;
      ctx.drawImage(frame, 0, 0, width, height);
      if (this.frameCount++ % METER_EVERY_N_FRAMES === 0) this.meter(this.canvas);
      if (this.lift > 0.02) {
        // "screen" of the image over itself at alpha k gives y = x + k·x·(1 − x).
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = this.lift;
        ctx.drawImage(frame, 0, 0, width, height);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }
      return this.canvas;
    } catch (err) {
      this.failed = true;
      getLogger(LoggerNames.ProcessorWrapper).warn("[cameraEffect] inference downscale unavailable, using full frames", err);
      return frame;
    }
  }

  private meter(source: OffscreenCanvas) {
    try {
      if (!this.meterCtx) {
        this.meterCtx = new OffscreenCanvas(16, 9).getContext("2d", { willReadFrequently: true });
        if (!this.meterCtx) return;
      }
      this.meterCtx.drawImage(source, 0, 0, 16, 9);
      const luma = meanLuma(this.meterCtx.getImageData(0, 0, 16, 9).data);
      const target = shadowLiftFor(luma);
      // Ease toward the target so a light switching on doesn't jolt the mask.
      this.lift = this.lift * 0.5 + target * 0.5;
    } catch {
      this.lift = 0;
    }
  }
}

function errorWithCause(message: string, cause: unknown) {
  return Object.assign(new Error(message), { cause });
}

export class EnhancedBackgroundTransformer extends BackgroundTransformer {
  /** Set while our pipeline is active; undefined means the library pipeline (fallback). */
  private enhancedGl?: EnhancedBackgroundGl;

  private inferenceInput = new InferenceInput();

  private frameLog = getLogger(LoggerNames.ProcessorWrapper);

  get pipeline(): "enhanced" | "standard" {
    return this.enhancedGl ? "enhanced" : "standard";
  }

  /** Swaps the library's WebGL pipeline (same context) for ours; keeps the library's on failure. */
  private installEnhancedGl() {
    this.enhancedGl = undefined;
    if (!this.canvas) return;
    try {
      const enhanced = setupEnhancedBackgroundGl(this.canvas);
      this.gl?.cleanup();
      this.gl = enhanced;
      this.enhancedGl = enhanced;
    } catch (err) {
      console.warn("[cameraEffect] enhanced pipeline unavailable, using standard", (err as Error)?.message || String(err));
    }
  }

  async init({ outputCanvas, inputElement }: VideoTransformerInitOptions) {
    // The base setup (TransformStream, canvas, library WebGL) without
    // BackgroundTransformer.init, which would build a category-mask segmenter.
    await VideoTransformer.prototype.init.call(this, { outputCanvas, inputElement });
    this.installEnhancedGl();
    const enhanced = !!this.enhancedGl;

    const fileSet = await vision.FilesetResolver.forVisionTasks(this.options.assetPaths?.tasksVisionFileSet ?? DEFAULT_FILESET);
    this.imageSegmenter = await vision.ImageSegmenter.createFromOptions(fileSet, {
      baseOptions: {
        modelAssetPath: this.options.assetPaths?.modelAssetPath ?? DEFAULT_MODEL,
        delegate: "GPU",
        ...this.options.segmenterOptions,
      },
      canvas: this.canvas,
      runningMode: "VIDEO",
      outputCategoryMask: !enhanced,
      outputConfidenceMasks: enhanced,
    }).catch((err) => {
      // Same as the library: MediaPipe rejects a failed WASM load with the <script> error Event.
      if (err instanceof Event) {
        const src = err.target instanceof HTMLScriptElement ? err.target.src : "unknown URL";
        throw errorWithCause(`Failed to load the MediaPipe tasks-vision fileset from ${src}`, err);
      }
      throw err;
    });

    if (this.options.imagePath) {
      await this.loadAndSetBackground(this.options.imagePath).catch((err) =>
        this.frameLog.error("Error while loading processor background image: ", err),
      );
    }
    if (typeof this.options.blurRadius === "number") this.gl?.setBlurRadius(this.options.blurRadius);
    this.gl?.setBackgroundDisabled(this.options.backgroundDisabled ?? false);
  }

  async restart(opts: VideoTransformerInitOptions) {
    await super.restart(opts);
    this.installEnhancedGl();
    if (typeof this.options.blurRadius === "number") this.gl?.setBlurRadius(this.options.blurRadius);
    this.gl?.setBackgroundDisabled(this.options.backgroundDisabled ?? false);
    // The cached image is re-uploaded into the new pipeline.
    if (this.options.imagePath) await this.loadAndSetBackground(this.options.imagePath).catch(() => undefined);
  }

  async destroy(options?: Parameters<BackgroundTransformer["destroy"]>[0]) {
    await super.destroy(options);
    this.enhancedGl = undefined;
  }

  /** Mirrors BackgroundTransformer.transform; differs only in the marked steps. */
  async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
    let enqueuedFrame = false;
    try {
      if (!(frame instanceof VideoFrame) || frame.codedWidth === 0 || frame.codedHeight === 0) return;

      let skipProcessingFrame = this.isDisabled || (this.options.backgroundDisabled ?? false);
      if (typeof this.options.blurRadius !== "number" && typeof this.options.imagePath !== "string") {
        skipProcessingFrame = true;
      }
      if (skipProcessingFrame) {
        controller.enqueue(frame);
        enqueuedFrame = true;
        return;
      }

      const frameTimeMs = Date.now();
      if (!this.canvas) throw TypeError("Canvas needs to be initialized first");
      this.canvas.width = frame.displayWidth;
      this.canvas.height = frame.displayHeight;

      // Show the first frame right away while the first (slow) segmentation runs.
      if (this.isFirstFrame) {
        controller.enqueue(frame.clone());
        if (this.inputVideo) {
          await new Promise((resolve) => {
            this.inputVideo!.requestVideoFrameCallback((_now, e) => {
              setTimeout(resolve, e.expectedDisplayTime - e.presentationTime);
            });
          });
        }
      }
      if (this.isDisabled || !this.imageSegmenter) return;
      this.isFirstFrame = false;

      const filterStartTimeMs = performance.now();
      const gl = this.enhancedGl;
      // Enhanced: the frame goes up first so mask refinement can follow its colours,
      // and the model gets the small (possibly shadow-lifted) copy.
      gl?.uploadFrame(frame);
      const input = gl ? this.inferenceInput.prepare(frame) : frame;

      const segmentationStartTimeMs = performance.now();
      // Synchronous: the callback runs before segmentForVideo returns.
      this.imageSegmenter.segmentForVideo(input, segmentationStartTimeMs, (result) => {
        this.segmentationTimeMs = performance.now() - segmentationStartTimeMs;
        try {
          if (gl) {
            const mask = result.confidenceMasks?.[0];
            if (mask) gl.updateMask(mask.getAsWebGLTexture(), mask.width);
          } else if (result.categoryMask) {
            this.gl?.updateMask(result.categoryMask.getAsWebGLTexture());
          }
        } finally {
          result.close();
        }
      });

      // MediaPipe sizes the shared canvas to its input (the small copy); restore it.
      if (gl) {
        this.canvas.width = frame.displayWidth;
        this.canvas.height = frame.displayHeight;
      }
      this.gl?.renderFrame(frame);
      if (this.canvas.width > 0 && this.canvas.height > 0) {
        controller.enqueue(new VideoFrame(this.canvas, { timestamp: frame.timestamp || frameTimeMs }));
        const filterTimeMs = performance.now() - filterStartTimeMs;
        const stats: FrameProcessingStats = {
          processingTimeMs: this.segmentationTimeMs + filterTimeMs,
          segmentationTimeMs: this.segmentationTimeMs,
          filterTimeMs,
        };
        this.options.onFrameProcessed?.(stats);
      } else {
        controller.enqueue(frame);
        enqueuedFrame = true;
      }
    } catch (e) {
      this.frameLog.error("Error while processing frame: ", e);
    } finally {
      if (!enqueuedFrame) frame.close();
    }
  }
}

function pipelineOverride(): string | null {
  try {
    return localStorage.getItem(PIPELINE_OVERRIDE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Same signature and behaviour as the library's BackgroundProcessor for the
 * options our applier passes (lib/cameraEffectApplier.ts).
 */
export function BackgroundProcessor(opts: ProcessorOptions & ProcessorBaseOptions, name = "background-processor") {
  if (pipelineOverride() === "standard") return LibraryBackgroundProcessor(opts, name);
  if (!BackgroundTransformer.isSupported) throw new Error("Background transformer is not supported in this browser");
  if (!ProcessorWrapper.isSupported) {
    throw new Error("Neither MediaStreamTrackProcessor nor canvas.captureStream() fallback is supported in this browser");
  }
  const base: BackgroundOptions = { assetPaths: opts.assetPaths };
  const transformerOptions: BackgroundOptions =
    opts.mode === "background-blur"
      ? { ...base, blurRadius: opts.blurRadius }
      : opts.mode === "virtual-background"
        ? { ...base, imagePath: opts.imagePath }
        : { ...base, backgroundDisabled: true };
  return new BackgroundProcessorWrapper(new EnhancedBackgroundTransformer(transformerOptions), name);
}
