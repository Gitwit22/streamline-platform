import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CUSTOM_IMAGE_STORAGE_KEY,
  EFFECT_STORAGE_KEY,
  NO_EFFECT,
  cameraEffectStore,
  normalizeCameraEffect,
  processorOptionsFor,
} from "./cameraEffects";

describe("normalizeCameraEffect", () => {
  it("keeps valid selections and drops anything else", () => {
    expect(normalizeCameraEffect({ mode: "blur-strong", imageId: "x" })).toEqual({ mode: "blur-strong", imageId: null });
    expect(normalizeCameraEffect({ mode: "image", imageId: "ocean" })).toEqual({ mode: "image", imageId: "ocean" });
    expect(normalizeCameraEffect({ mode: "image", imageId: "custom" })).toEqual({ mode: "image", imageId: "custom" });
    expect(normalizeCameraEffect({ mode: "image", imageId: "https://evil.example/x.png" })).toEqual(NO_EFFECT);
    expect(normalizeCameraEffect({ mode: "sparkles" })).toEqual(NO_EFFECT);
    expect(normalizeCameraEffect(null)).toEqual(NO_EFFECT);
  });
});

describe("processorOptionsFor", () => {
  it("maps blur strengths and images", () => {
    expect(processorOptionsFor({ mode: "blur-light", imageId: null }, null)).toEqual({ mode: "background-blur", blurRadius: 6 });
    expect(processorOptionsFor({ mode: "blur-strong", imageId: null }, null)).toEqual({ mode: "background-blur", blurRadius: 14 });
    expect(processorOptionsFor({ mode: "image", imageId: "ocean" }, "data:image/jpeg;base64,AA")).toEqual({
      mode: "virtual-background",
      imagePath: "data:image/jpeg;base64,AA",
    });
  });

  it("disables instead of passing an empty image path", () => {
    expect(processorOptionsFor({ mode: "image", imageId: "custom" }, null)).toEqual({ mode: "disabled" });
    expect(processorOptionsFor(NO_EFFECT, null)).toEqual({ mode: "disabled" });
  });
});

describe("cameraEffectStore", () => {
  beforeEach(() => {
    localStorage.clear();
    cameraEffectStore.reset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("remembers the selection across reloads", () => {
    cameraEffectStore.setEffect({ mode: "blur-light", imageId: null });
    cameraEffectStore.reset(); // simulates a reload
    expect(cameraEffectStore.getSnapshot().effect).toEqual({ mode: "blur-light", imageId: null });
  });

  it("drops a saved custom background whose image is gone", () => {
    localStorage.setItem(EFFECT_STORAGE_KEY, JSON.stringify({ mode: "image", imageId: "custom" }));
    cameraEffectStore.reset();
    expect(cameraEffectStore.getSnapshot().effect).toEqual(NO_EFFECT);
  });

  it("ignores corrupt or non-image stored values", () => {
    localStorage.setItem(EFFECT_STORAGE_KEY, "{not json");
    localStorage.setItem(CUSTOM_IMAGE_STORAGE_KEY, "javascript:alert(1)");
    cameraEffectStore.reset();
    expect(cameraEffectStore.getSnapshot()).toMatchObject({ effect: NO_EFFECT, customImage: null });
  });

  it("uses a custom image for this visit when the browser refuses to store it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const { persisted } = cameraEffectStore.setCustomImage("data:image/jpeg;base64,AA");
    expect(persisted).toBe(false);
    expect(cameraEffectStore.getSnapshot()).toMatchObject({
      effect: { mode: "image", imageId: "custom" },
      customImage: "data:image/jpeg;base64,AA",
    });
  });

  it("removing the custom image also clears it as the selection", () => {
    cameraEffectStore.setCustomImage("data:image/jpeg;base64,AA");
    cameraEffectStore.removeCustomImage();
    expect(cameraEffectStore.getSnapshot()).toMatchObject({ effect: NO_EFFECT, customImage: null });
    expect(localStorage.getItem(CUSTOM_IMAGE_STORAGE_KEY)).toBeNull();
  });

  it("fail() reverts to no effect and reports why", () => {
    cameraEffectStore.setEffect({ mode: "blur-strong", imageId: null });
    cameraEffectStore.fail("nope");
    expect(cameraEffectStore.getSnapshot()).toMatchObject({ effect: NO_EFFECT, status: { state: "error", message: "nope" } });
    cameraEffectStore.reset();
    expect(cameraEffectStore.getSnapshot().effect).toEqual(NO_EFFECT);
  });
});
