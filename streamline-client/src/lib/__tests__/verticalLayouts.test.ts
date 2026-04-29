import { describe, expect, it } from "vitest";
import {
  VERTICAL_PRESETS,
  SQUARE_PRESETS,
  getVerticalPresetById,
  getPresetsForFormat,
  getPresetsForParticipantCount,
  checkVerticalSafeZone,
  OUTPUT_FORMAT_DIMENSIONS,
  OUTPUT_FORMAT_LABELS,
  VALID_OUTPUT_FORMATS,
} from "../verticalLayouts";

describe("VALID_OUTPUT_FORMATS", () => {
  it("contains exactly 3 formats", () => {
    expect(VALID_OUTPUT_FORMATS).toHaveLength(3);
    expect(VALID_OUTPUT_FORMATS).toContain("landscape_16x9");
    expect(VALID_OUTPUT_FORMATS).toContain("vertical_9x16");
    expect(VALID_OUTPUT_FORMATS).toContain("square_1x1");
  });
});

describe("OUTPUT_FORMAT_DIMENSIONS", () => {
  it("has correct dimensions for landscape", () => {
    expect(OUTPUT_FORMAT_DIMENSIONS.landscape_16x9).toEqual({ width: 1920, height: 1080 });
  });

  it("has correct dimensions for vertical", () => {
    expect(OUTPUT_FORMAT_DIMENSIONS.vertical_9x16).toEqual({ width: 1080, height: 1920 });
  });

  it("has correct dimensions for square", () => {
    expect(OUTPUT_FORMAT_DIMENSIONS.square_1x1).toEqual({ width: 1080, height: 1080 });
  });
});

describe("OUTPUT_FORMAT_LABELS", () => {
  it("has human-readable labels", () => {
    expect(OUTPUT_FORMAT_LABELS.landscape_16x9).toBe("Widescreen 16:9");
    expect(OUTPUT_FORMAT_LABELS.vertical_9x16).toBe("Vertical 9:16");
    expect(OUTPUT_FORMAT_LABELS.square_1x1).toBe("Square 1:1");
  });
});

describe("VERTICAL_PRESETS", () => {
  it("has at least 6 vertical presets", () => {
    expect(VERTICAL_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it("all presets have outputFormat vertical_9x16", () => {
    VERTICAL_PRESETS.forEach((p) => {
      expect(p.outputFormat).toBe("vertical_9x16");
    });
  });

  it("all presets have at least one slot", () => {
    VERTICAL_PRESETS.forEach((p) => {
      expect(p.slots.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("slot coordinates are in 0-1 range", () => {
    VERTICAL_PRESETS.forEach((p) => {
      p.slots.forEach((s) => {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.x + s.width).toBeLessThanOrEqual(1.001);
        expect(s.y + s.height).toBeLessThanOrEqual(1.001);
      });
    });
  });
});

describe("SQUARE_PRESETS", () => {
  it("has at least 2 square presets", () => {
    expect(SQUARE_PRESETS.length).toBeGreaterThanOrEqual(2);
  });

  it("all presets have outputFormat square_1x1", () => {
    SQUARE_PRESETS.forEach((p) => {
      expect(p.outputFormat).toBe("square_1x1");
    });
  });
});

describe("getVerticalPresetById", () => {
  it("returns a preset by known ID", () => {
    const preset = getVerticalPresetById("vertical_solo");
    expect(preset).toBeDefined();
    expect(preset?.label).toBe("Solo Vertical");
  });

  it("returns undefined for unknown ID", () => {
    expect(getVerticalPresetById("nonexistent")).toBeUndefined();
  });
});

describe("getPresetsForFormat", () => {
  it("returns only vertical presets for vertical_9x16", () => {
    const presets = getPresetsForFormat("vertical_9x16");
    expect(presets.length).toBeGreaterThanOrEqual(6);
    presets.forEach((p) => expect(p.outputFormat).toBe("vertical_9x16"));
  });

  it("returns only square presets for square_1x1", () => {
    const presets = getPresetsForFormat("square_1x1");
    expect(presets.length).toBeGreaterThanOrEqual(2);
    presets.forEach((p) => expect(p.outputFormat).toBe("square_1x1"));
  });

  it("returns no presets for landscape_16x9", () => {
    const presets = getPresetsForFormat("landscape_16x9");
    expect(presets).toHaveLength(0);
  });
});

describe("getPresetsForParticipantCount", () => {
  it("finds 2-person vertical presets", () => {
    const presets = getPresetsForParticipantCount("vertical_9x16", 2);
    expect(presets.length).toBeGreaterThanOrEqual(1);
    presets.forEach((p) => {
      expect(p.outputFormat).toBe("vertical_9x16");
      expect(p.participantCount).toBe(2);
    });
  });

  it("returns empty array for unsupported count", () => {
    const presets = getPresetsForParticipantCount("vertical_9x16", 10);
    expect(presets).toHaveLength(0);
  });
});

describe("checkVerticalSafeZone", () => {
  const W = 1920;
  const H = 1080;

  it("returns no warnings for slots inside the safe zone", () => {
    const slots = [{ id: "host", x: 0.35, y: 0, width: 0.3, height: 0.5 }];
    const warnings = checkVerticalSafeZone(slots, W, H);
    expect(warnings).toHaveLength(0);
  });

  it("warns when a slot extends beyond the safe zone", () => {
    const slots = [{ id: "host", x: 0, y: 0, width: 0.5, height: 0.5 }];
    const warnings = checkVerticalSafeZone(slots, W, H);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].slotId).toBe("host");
    expect(warnings[0].message).toContain("vertical safe zone");
  });

  it("full-width slot always warns on 16:9 canvas", () => {
    const slots = [{ id: "full", x: 0, y: 0, width: 1, height: 1 }];
    const warnings = checkVerticalSafeZone(slots, W, H);
    expect(warnings).toHaveLength(1);
  });

  it("returns no warnings on a 9:16 vertical canvas", () => {
    const slots = [
      { id: "host", x: 0, y: 0, width: 1, height: 0.5 },
      { id: "guest", x: 0, y: 0.5, width: 1, height: 0.5 },
    ];
    const warnings = checkVerticalSafeZone(slots, 1080, 1920);
    expect(warnings).toHaveLength(0);
  });
});
