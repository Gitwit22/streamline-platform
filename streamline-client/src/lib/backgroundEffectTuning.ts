/**
 * Tuning for the enhanced camera background pipeline
 * (lib/enhancedBackgroundProcessor.ts + lib/backgroundEffectGl.ts).
 *
 * Kept pure (no DOM / WebGL) so the numbers that decide how the effect looks
 * and how much GPU it costs are unit-tested in one place.
 */

/** Longest edge of the frame handed to the segmentation model. The selfie
 * model itself runs at 256×256, so a larger input only costs upload time; the
 * mask is brought back to full size by the GPU refinement pass. */
export const INFERENCE_LONG_EDGE = 384;

/** Longest edge of the refined mask buffers (the composite upsamples them). */
export const MASK_BUFFER_LONG_EDGE = 640;

/**
 * Temporal smoothing (EMA) of the raw confidence mask.
 * Each frame: smoothed = mix(previous, current, w), where w ramps from
 * EMA_CURRENT_WEIGHT for small changes (flicker on hair, headrests) up to 1
 * for large ones (real motion), so steady edges calm down without moving
 * arms leaving a ghost trail.
 */
export const EMA_CURRENT_WEIGHT = 0.6;
export const EMA_MOTION_LOW = 0.3;
export const EMA_MOTION_HIGH = 0.8;

/**
 * Soft threshold on the refined confidence, replacing a hard 0.5 cut. Kept
 * narrow: where the model is unsure over a wide area (e.g. a light wall next to
 * a shoulder) a wider band (0.3–0.7 was tried) shows the real room through a
 * virtual background as a translucent veil.
 */
export const MASK_EDGE_LOW = 0.4;
export const MASK_EDGE_HIGH = 0.6;

/** Joint bilateral refinement: how strongly colour differences stop the mask
 * spreading (smaller = snaps harder to colour edges). RGB distance units. */
export const BILATERAL_COLOR_SIGMA = 0.12;

/** Fits w×h inside `longEdge` keeping aspect; never upscales; at least 1×1. */
export function fitLongEdge(width: number, height: number, longEdge: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const scale = Math.min(1, longEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * Spacing (in mask-buffer texels) between joint-bilateral taps. The raw mask is
 * coarser than the buffer, so taps must reach about one raw-mask texel to
 * smooth its stair-steps; capped so the 5×5 kernel stays local.
 */
export function bilateralStep(rawMaskWidth: number, bufferWidth: number): number {
  if (!(rawMaskWidth > 0) || !(bufferWidth > 0)) return 1;
  const ratio = bufferWidth / rawMaskWidth;
  return Math.min(3, Math.max(1, ratio * 0.6));
}

export type KawasePlan = { levels: number; offset: number };

/**
 * Dual-Kawase blur plan for a blur radius (the BLUR_RADIUS values in
 * lib/cameraEffects.ts). Each level halves the resolution; more levels =
 * wider blur. Levels are capped so the smallest level keeps at least 8 px on
 * its short edge (fewer on tiny frames, never below 1 level).
 */
export function kawasePlanFor(blurRadius: number, width: number, height: number): KawasePlan {
  const radius = Number.isFinite(blurRadius) && blurRadius > 0 ? blurRadius : 1;
  const wanted = radius <= 4 ? 2 : radius <= 8 ? 3 : 4;
  const offset = radius <= 4 ? 1 : radius <= 8 ? 1.25 : 1.5;
  const shortEdge = Math.max(1, Math.min(width, height));
  const maxLevels = Math.max(1, Math.floor(Math.log2(shortEdge / 8)));
  return { levels: Math.max(1, Math.min(wanted, maxLevels)), offset };
}

/**
 * How much to lift shadows in the frame shown to the model only (never the
 * published video), given the scene's mean luma (0–1). Dark, backlit rooms
 * make dark hair and clothes indistinguishable from the shadows behind them.
 *
 * Returns k for the curve y = x + k·x·(1 − x): black and white stay fixed and
 * dark/mid tones rise. 0 for normally lit scenes so they are unaffected.
 */
export const SHADOW_LIFT_START_LUMA = 0.4;
export const SHADOW_LIFT_FULL_LUMA = 0.15;
export const SHADOW_LIFT_MAX = 0.9;

export function shadowLiftFor(meanLuma: number): number {
  if (!Number.isFinite(meanLuma)) return 0;
  if (meanLuma >= SHADOW_LIFT_START_LUMA) return 0;
  const t = (SHADOW_LIFT_START_LUMA - meanLuma) / (SHADOW_LIFT_START_LUMA - SHADOW_LIFT_FULL_LUMA);
  return SHADOW_LIFT_MAX * Math.min(1, Math.max(0, t));
}

/** Mean Rec.601 luma (0–1) of RGBA pixel data; NaN for empty input. */
export function meanLuma(rgba: ArrayLike<number>): number {
  const n = Math.floor(rgba.length / 4);
  if (n === 0) return NaN;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    sum += 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
  }
  return sum / n / 255;
}
