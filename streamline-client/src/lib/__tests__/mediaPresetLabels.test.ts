import { describe, expect, it } from "vitest";
import {
  captureResolutionForPreset,
  isHighQualityPreset,
  MEDIA_PRESET_LABELS,
  MEDIA_PRESET_ORDER,
  mediaPresetLabel,
  readCachedRoomPreset,
  toPresetOptions,
  writeCachedRoomPreset,
} from "../mediaPresetLabels";
import { buildRoomOptions, screenShareCaptureOptions } from "../captureDefaults";

describe("media preset labels", () => {
  it("matches the server labels (streamline-server/lib/mediaPresets.ts)", () => {
    expect(MEDIA_PRESET_LABELS).toEqual({
      standard_720p30: "Standard (720p30)",
      hd_1080p30: "Full HD (1080p30)",
      sports_1080p60: "Action/Sports (1080p60)",
      pro_1440p30: "Studio (1440p30)",
      ultra_4k30: "Cinema (4K30)",
    });
    expect(MEDIA_PRESET_ORDER).toHaveLength(5);
  });

  it("never returns a raw id", () => {
    expect(mediaPresetLabel("hd_1080p30")).toBe("Full HD (1080p30)");
    expect(mediaPresetLabel("weird_id")).toBe("Standard (720p30)");
    expect(mediaPresetLabel(null)).toBe("Standard (720p30)");
  });

  it("flags high-quality presets (>=1080p60)", () => {
    expect(isHighQualityPreset("standard_720p30")).toBe(false);
    expect(isHighQualityPreset("hd_1080p30")).toBe(false);
    expect(isHighQualityPreset("sports_1080p60")).toBe(true);
    expect(isHighQualityPreset("pro_1440p30")).toBe(true);
    expect(isHighQualityPreset("ultra_4k30")).toBe(true);
  });

  it("builds options honoring server `allowed`, else maxPresetId", () => {
    const fromServer = toPresetOptions([
      { id: "standard_720p30", label: "x", allowed: true },
      { id: "ultra_4k30", label: "y", allowed: false },
      { id: "bogus" },
    ]);
    expect(fromServer).toEqual([
      { id: "standard_720p30", label: "Standard (720p30)", allowed: true },
      { id: "ultra_4k30", label: "Cinema (4K30)", allowed: false },
    ]);
    const byMax = toPresetOptions([{ id: "hd_1080p30" }, { id: "sports_1080p60" }], "hd_1080p30");
    expect(byMax.map((o) => o.allowed)).toEqual([true, false]);
    const fallback = toPresetOptions([], "sports_1080p60");
    expect(fallback.filter((o) => o.allowed).map((o) => o.id)).toEqual([
      "standard_720p30",
      "hd_1080p30",
      "sports_1080p60",
    ]);
  });
});

describe("capture defaults", () => {
  it("picks camera capture resolution from the host preset", () => {
    expect(captureResolutionForPreset("standard_720p30")).toBe("h720");
    expect(captureResolutionForPreset(undefined)).toBe("h720");
    expect(captureResolutionForPreset("hd_1080p30")).toBe("h1080");
    expect(captureResolutionForPreset("ultra_4k30")).toBe("h1080");
  });

  it("builds room options with simulcast, dynacast and adaptive stream", () => {
    const o720 = buildRoomOptions("standard_720p30");
    expect(o720.adaptiveStream).toBe(true);
    expect(o720.dynacast).toBe(true);
    expect(o720.videoCaptureDefaults?.resolution).toMatchObject({ width: 1280, height: 720 });
    expect(o720.publishDefaults?.simulcast).toBe(true);
    expect(o720.publishDefaults?.screenShareEncoding).toBeTruthy();
    const o1080 = buildRoomOptions("sports_1080p60");
    expect(o1080.videoCaptureDefaults?.resolution).toMatchObject({ width: 1920, height: 1080 });
    // Stable JSON for a given preset (useLiveKitRoom recreates the Room on change).
    expect(JSON.stringify(buildRoomOptions("hd_1080p30"))).toBe(JSON.stringify(buildRoomOptions("hd_1080p30")));
  });

  it("screen share captures audio at 1080p30", () => {
    const opts = screenShareCaptureOptions();
    expect(opts.audio).toBeTruthy();
    expect(opts.systemAudio).toBe("include");
    expect(opts.resolution).toMatchObject({ width: 1920, height: 1080, frameRate: 30 });
  });

  it("caches the owner preset per room", () => {
    writeCachedRoomPreset("room_1", "hd_1080p30");
    expect(readCachedRoomPreset("room_1")).toBe("hd_1080p30");
    writeCachedRoomPreset("room_1", "nope");
    expect(readCachedRoomPreset("room_1")).toBe("hd_1080p30");
    expect(readCachedRoomPreset("room_2")).toBeNull();
  });
});
