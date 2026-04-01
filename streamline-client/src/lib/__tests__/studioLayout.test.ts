import { describe, expect, it } from "vitest";
import {
  isValidPresetId,
  suggestPreset,
  shouldSuggestChange,
  getPresetSlots,
  ALL_PRESET_IDS,
  PRESET_INFO,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from "../studioLayout";

// ---------------------------------------------------------------------------
// isValidPresetId
// ---------------------------------------------------------------------------

describe("isValidPresetId", () => {
  it("accepts all known preset ids", () => {
    for (const id of ALL_PRESET_IDS) {
      expect(isValidPresetId(id)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isValidPresetId("unknown")).toBe(false);
    expect(isValidPresetId("")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidPresetId(null)).toBe(false);
    expect(isValidPresetId(undefined)).toBe(false);
    expect(isValidPresetId(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// suggestPreset
// ---------------------------------------------------------------------------

describe("suggestPreset", () => {
  it("returns solo for 0 or 1 participants", () => {
    expect(suggestPreset(0)).toBe("solo");
    expect(suggestPreset(1)).toBe("solo");
  });

  it("returns side_by_side for 2 participants", () => {
    expect(suggestPreset(2)).toBe("side_by_side");
  });

  it("returns three_grid for 3 participants", () => {
    expect(suggestPreset(3)).toBe("three_grid");
  });

  it("returns four_grid for 4+ participants", () => {
    expect(suggestPreset(4)).toBe("four_grid");
    expect(suggestPreset(8)).toBe("four_grid");
  });
});

// ---------------------------------------------------------------------------
// shouldSuggestChange
// ---------------------------------------------------------------------------

describe("shouldSuggestChange", () => {
  it("returns null for custom or null presets", () => {
    expect(shouldSuggestChange("custom", 3)).toBeNull();
    expect(shouldSuggestChange(null, 3)).toBeNull();
  });

  it("returns null for screen_share and floating presets", () => {
    expect(shouldSuggestChange("screen_share_speaker", 4)).toBeNull();
    expect(shouldSuggestChange("floating_guest", 4)).toBeNull();
    expect(shouldSuggestChange("floating_host", 4)).toBeNull();
  });

  it("returns null when current preset has matching slots", () => {
    expect(shouldSuggestChange("side_by_side", 2)).toBeNull();
    expect(shouldSuggestChange("four_grid", 3)).toBe("three_grid");
  });

  it("suggests a better preset when current has too few slots", () => {
    expect(shouldSuggestChange("solo", 2)).toBe("side_by_side");
    expect(shouldSuggestChange("solo", 3)).toBe("three_grid");
    expect(shouldSuggestChange("side_by_side", 3)).toBe("three_grid");
    expect(shouldSuggestChange("three_grid", 4)).toBe("four_grid");
  });
});

// ---------------------------------------------------------------------------
// getPresetSlots
// ---------------------------------------------------------------------------

describe("getPresetSlots", () => {
  it("returns slots for every known preset", () => {
    for (const id of ALL_PRESET_IDS) {
      const slots = getPresetSlots(id);
      expect(slots.length).toBeGreaterThan(0);
    }
  });

  it("returns deep copies (not the same references)", () => {
    const a = getPresetSlots("solo");
    const b = getPresetSlots("solo");
    expect(a).toEqual(b);
    expect(a[0]).not.toBe(b[0]);
  });

  it("solo has 1 slot, four_grid has 4 slots", () => {
    expect(getPresetSlots("solo")).toHaveLength(1);
    expect(getPresetSlots("four_grid")).toHaveLength(4);
  });

  it("four_grid adapts to participant counts above 4", () => {
    const slots = getPresetSlots("four_grid", 8);
    expect(slots).toHaveLength(8);
    for (const s of slots) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.width).toBeGreaterThan(0);
      expect(s.height).toBeGreaterThan(0);
      expect(s.x + s.width).toBeLessThanOrEqual(CANVAS_WIDTH);
      expect(s.y + s.height).toBeLessThanOrEqual(CANVAS_HEIGHT);
    }
  });

  it("slots stay within canvas bounds", () => {
    for (const id of ALL_PRESET_IDS) {
      const slots = getPresetSlots(id);
      for (const s of slots) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.x + s.width).toBeLessThanOrEqual(CANVAS_WIDTH + 20);
        expect(s.y + s.height).toBeLessThanOrEqual(CANVAS_HEIGHT + 20);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// PRESET_INFO metadata
// ---------------------------------------------------------------------------

describe("PRESET_INFO", () => {
  it("has an entry for every preset id", () => {
    const infoIds = PRESET_INFO.map((p) => p.id);
    for (const id of ALL_PRESET_IDS) {
      expect(infoIds).toContain(id);
    }
  });

  it("slot counts match actual preset slot arrays", () => {
    for (const info of PRESET_INFO) {
      const slots = getPresetSlots(info.id);
      expect(slots).toHaveLength(info.slotCount);
    }
  });
});
