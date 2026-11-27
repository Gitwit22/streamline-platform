import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PREJOIN_CHOICES,
  PREJOIN_STORAGE_KEY,
  availableDeviceId,
  captureOptionFor,
  loadPreJoinChoices,
  normalizePreJoinChoices,
  savePreJoinChoices,
  shouldShowPreJoin,
} from "./preJoin";

describe("captureOptionFor", () => {
  it("never publishes what the room doesn't allow", () => {
    expect(captureOptionFor(false, true, "cam1")).toBe(false);
    expect(captureOptionFor(false, undefined, undefined)).toBe(false);
  });
  it("keeps the old behavior when the pre-join was skipped", () => {
    expect(captureOptionFor(true, undefined, undefined)).toBe(true);
  });
  it("honors off and a chosen device", () => {
    expect(captureOptionFor(true, false, "cam1")).toBe(false);
    expect(captureOptionFor(true, true, "cam1")).toEqual({ deviceId: "cam1" });
    expect(captureOptionFor(true, true, "")).toBe(true);
  });
});

describe("shouldShowPreJoin", () => {
  const base = { done: false, hasName: true, isHost: false, hasToken: true, isAudience: false, blocked: false };
  it("shows for on-stage guests with a token and for hosts right away", () => {
    expect(shouldShowPreJoin(base)).toBe(true);
    expect(shouldShowPreJoin({ ...base, isHost: true, hasToken: false })).toBe(true);
  });
  it("skips viewers, guests still waiting, finished, nameless or blocked states", () => {
    expect(shouldShowPreJoin({ ...base, isAudience: true })).toBe(false);
    expect(shouldShowPreJoin({ ...base, hasToken: false })).toBe(false);
    expect(shouldShowPreJoin({ ...base, done: true })).toBe(false);
    expect(shouldShowPreJoin({ ...base, hasName: false })).toBe(false);
    expect(shouldShowPreJoin({ ...base, isHost: true, blocked: true })).toBe(false);
  });
});

describe("pre-join choices storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips and defaults to camera and mic on", () => {
    expect(loadPreJoinChoices()).toEqual(DEFAULT_PREJOIN_CHOICES);
    savePreJoinChoices({ videoEnabled: false, audioEnabled: true, videoDeviceId: "", audioDeviceId: "mic2" });
    expect(loadPreJoinChoices()).toEqual({ videoEnabled: false, audioEnabled: true, videoDeviceId: "", audioDeviceId: "mic2" });
  });

  it("ignores corrupt values", () => {
    localStorage.setItem(PREJOIN_STORAGE_KEY, "{oops");
    expect(loadPreJoinChoices()).toEqual(DEFAULT_PREJOIN_CHOICES);
    expect(normalizePreJoinChoices({ videoEnabled: "yes", videoDeviceId: 5, audioDeviceId: "x".repeat(600) })).toEqual(
      DEFAULT_PREJOIN_CHOICES,
    );
  });

  it("drops a saved device that's no longer connected", () => {
    expect(availableDeviceId("cam1", [{ deviceId: "cam1" }])).toBe("cam1");
    expect(availableDeviceId("cam1", [{ deviceId: "cam2" }])).toBe("");
  });
});
