import { describe, expect, it } from "vitest";
import {
  SHADOW_LIFT_MAX,
  SHADOW_LIFT_START_LUMA,
  bilateralStep,
  fitLongEdge,
  kawasePlanFor,
  meanLuma,
  shadowLiftFor,
} from "./backgroundEffectTuning";
import { BLUR_RADIUS } from "./cameraEffects";

describe("fitLongEdge", () => {
  it("scales the long edge down keeping aspect", () => {
    expect(fitLongEdge(1280, 720, 384)).toEqual({ width: 384, height: 216 });
    expect(fitLongEdge(720, 1280, 384)).toEqual({ width: 216, height: 384 });
  });

  it("never upscales and never returns zero", () => {
    expect(fitLongEdge(320, 180, 640)).toEqual({ width: 320, height: 180 });
    expect(fitLongEdge(0, 0, 640)).toEqual({ width: 1, height: 1 });
    expect(fitLongEdge(4000, 1, 384)).toEqual({ width: 384, height: 1 });
  });
});

describe("bilateralStep", () => {
  it("reaches about one raw-mask texel, clamped to 1..3", () => {
    expect(bilateralStep(384, 640)).toBeCloseTo(1, 5);
    expect(bilateralStep(256, 640)).toBeCloseTo(1.5, 5);
    expect(bilateralStep(64, 640)).toBe(3);
    expect(bilateralStep(1280, 640)).toBe(1);
  });

  it("falls back to 1 for unknown sizes", () => {
    expect(bilateralStep(0, 640)).toBe(1);
    expect(bilateralStep(NaN, 640)).toBe(1);
  });
});

describe("kawasePlanFor", () => {
  it("gives the strong preset a wider blur than the light one", () => {
    const light = kawasePlanFor(BLUR_RADIUS["blur-light"], 1280, 720);
    const strong = kawasePlanFor(BLUR_RADIUS["blur-strong"], 1280, 720);
    expect(light).toEqual({ levels: 3, offset: 1.25 });
    expect(strong).toEqual({ levels: 4, offset: 1.5 });
  });

  it("caps levels so the smallest level keeps at least 8 px", () => {
    // 64 px short edge: 64→32→16→8 is 3 levels max.
    expect(kawasePlanFor(14, 120, 64).levels).toBe(3);
    expect(kawasePlanFor(14, 16, 16).levels).toBe(1);
    expect(kawasePlanFor(14, 1, 1).levels).toBe(1);
  });

  it("treats invalid radii as the smallest blur", () => {
    expect(kawasePlanFor(NaN, 1280, 720)).toEqual({ levels: 2, offset: 1 });
    expect(kawasePlanFor(-3, 1280, 720)).toEqual({ levels: 2, offset: 1 });
  });
});

describe("shadowLiftFor", () => {
  it("leaves normally lit scenes alone", () => {
    expect(shadowLiftFor(SHADOW_LIFT_START_LUMA)).toBe(0);
    expect(shadowLiftFor(0.6)).toBe(0);
    expect(shadowLiftFor(NaN)).toBe(0);
  });

  it("lifts more as the scene gets darker, up to the cap", () => {
    const dim = shadowLiftFor(0.3);
    const dark = shadowLiftFor(0.2);
    expect(dim).toBeGreaterThan(0);
    expect(dark).toBeGreaterThan(dim);
    expect(shadowLiftFor(0.05)).toBe(SHADOW_LIFT_MAX);
    expect(shadowLiftFor(0)).toBe(SHADOW_LIFT_MAX);
  });
});

describe("meanLuma", () => {
  it("averages Rec.601 luma over RGBA pixels", () => {
    expect(meanLuma([255, 255, 255, 255, 0, 0, 0, 255])).toBeCloseTo(0.5, 5);
    expect(meanLuma([255, 0, 0, 255])).toBeCloseTo(0.299, 5);
  });

  it("is NaN for no pixels (so no lift is applied)", () => {
    expect(meanLuma([])).toBeNaN();
    expect(shadowLiftFor(meanLuma([]))).toBe(0);
  });
});
