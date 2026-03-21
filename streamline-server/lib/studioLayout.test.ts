import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Re-implement pure helpers here to avoid pulling in Firebase dependencies.
// (Same pattern as monetization.test.ts, presenceMode.test.ts, etc.)
// ---------------------------------------------------------------------------

// -- LayoutSlot type --------------------------------------------------------

type LayoutSlot = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
};

// -- Preset IDs -------------------------------------------------------------

const ALL_PRESET_IDS = [
  "solo",
  "side_by_side",
  "host_large_guest_small",
  "two_up_split",
  "three_grid",
  "four_grid",
  "screen_share_speaker",
  "floating_guest",
] as const;

type StudioLayoutPresetId = (typeof ALL_PRESET_IDS)[number];

function isValidPresetId(v: unknown): v is StudioLayoutPresetId {
  return typeof v === "string" && (ALL_PRESET_IDS as readonly string[]).includes(v);
}

// -- suggestPreset ----------------------------------------------------------

function suggestPreset(participantCount: number): StudioLayoutPresetId {
  if (participantCount <= 1) return "solo";
  if (participantCount === 2) return "side_by_side";
  if (participantCount === 3) return "three_grid";
  return "four_grid";
}

// -- shouldSuggestChange ----------------------------------------------------

const PRESETS_SLOT_COUNT: Record<StudioLayoutPresetId, number> = {
  solo: 1,
  side_by_side: 2,
  host_large_guest_small: 2,
  two_up_split: 2,
  three_grid: 3,
  four_grid: 4,
  screen_share_speaker: 2,
  floating_guest: 2,
};

function shouldSuggestChange(
  currentPresetId: StudioLayoutPresetId | "custom" | null,
  participantCount: number,
): StudioLayoutPresetId | null {
  const suggestion = suggestPreset(participantCount);
  if (currentPresetId === "custom" || currentPresetId === null) return null;
  if (currentPresetId === "screen_share_speaker" || currentPresetId === "floating_guest") return null;
  const count = PRESETS_SLOT_COUNT[currentPresetId];
  if (count !== undefined && count >= participantCount) return null;
  return suggestion === currentPresetId ? null : suggestion;
}

// -- normalizeLayoutSlot ----------------------------------------------------

function pickFiniteNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function normalizeLayoutSlot(input: unknown): LayoutSlot | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;

  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id) return null;

  const x = pickFiniteNumber(o.x);
  const y = pickFiniteNumber(o.y);
  const width = pickFiniteNumber(o.width);
  const height = pickFiniteNumber(o.height);
  const zIndex = pickFiniteNumber(o.zIndex);

  if (x === undefined || y === undefined || width === undefined || height === undefined) return null;

  return {
    id,
    x,
    y,
    width: Math.max(0, width),
    height: Math.max(0, height),
    zIndex: zIndex ?? 1,
  };
}

// -- normalizeStudioLayout --------------------------------------------------

type StudioLayoutAdjustMode = "manual" | "auto" | "suggest";

type StudioLayout = {
  presetId: StudioLayoutPresetId | "custom" | null;
  slots: LayoutSlot[];
  adjustMode: StudioLayoutAdjustMode;
  customSlots?: LayoutSlot[] | null;
};

function normalizeStudioLayout(input: unknown): StudioLayout | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;

  const rawPresetId = o.presetId;
  let presetId: StudioLayout["presetId"] = null;
  if (rawPresetId === "custom") {
    presetId = "custom";
  } else if (typeof rawPresetId === "string" && isValidPresetId(rawPresetId)) {
    presetId = rawPresetId;
  }

  let slots: LayoutSlot[] = [];
  if (Array.isArray(o.slots)) {
    for (const raw of o.slots) {
      const s = normalizeLayoutSlot(raw);
      if (s) slots.push(s);
    }
  }

  const rawAdjust = String(o.adjustMode ?? "suggest").toLowerCase();
  const adjustMode: StudioLayoutAdjustMode =
    rawAdjust === "auto" || rawAdjust === "manual" || rawAdjust === "suggest"
      ? rawAdjust
      : "suggest";

  let customSlots: LayoutSlot[] | null = null;
  if (Array.isArray(o.customSlots)) {
    const parsed: LayoutSlot[] = [];
    for (const raw of o.customSlots) {
      const s = normalizeLayoutSlot(raw);
      if (s) parsed.push(s);
    }
    if (parsed.length > 0) customSlots = parsed;
  }

  return { presetId, slots, adjustMode, customSlots };
}

// -- validateSlots ----------------------------------------------------------

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

function validateSlots(slots: LayoutSlot[]): string[] {
  const warnings: string[] = [];
  const ids = new Set<string>();
  for (const s of slots) {
    if (ids.has(s.id)) warnings.push(`Duplicate slot id "${s.id}".`);
    ids.add(s.id);
    if (s.width <= 0 || s.height <= 0) warnings.push(`Slot "${s.id}" has non-positive dimensions.`);
    if (s.x < 0 || s.y < 0) warnings.push(`Slot "${s.id}" has negative position.`);
    if (s.x + s.width > CANVAS_WIDTH + 20) warnings.push(`Slot "${s.id}" extends beyond canvas width.`);
    if (s.y + s.height > CANVAS_HEIGHT + 20) warnings.push(`Slot "${s.id}" extends beyond canvas height.`);
  }
  return warnings;
}

// ===========================================================================
// Tests
// ===========================================================================

// -- isValidPresetId --------------------------------------------------------

test("isValidPresetId accepts all preset ids", () => {
  for (const id of ALL_PRESET_IDS) {
    assert.ok(isValidPresetId(id), `Expected "${id}" to be valid`);
  }
});

test("isValidPresetId rejects invalid values", () => {
  assert.equal(isValidPresetId(""), false);
  assert.equal(isValidPresetId("unknown"), false);
  assert.equal(isValidPresetId(null), false);
  assert.equal(isValidPresetId(undefined), false);
  assert.equal(isValidPresetId(42), false);
});

// -- suggestPreset ----------------------------------------------------------

test("suggestPreset returns solo for 0 or 1 participants", () => {
  assert.equal(suggestPreset(0), "solo");
  assert.equal(suggestPreset(1), "solo");
});

test("suggestPreset returns side_by_side for 2 participants", () => {
  assert.equal(suggestPreset(2), "side_by_side");
});

test("suggestPreset returns three_grid for 3 participants", () => {
  assert.equal(suggestPreset(3), "three_grid");
});

test("suggestPreset returns four_grid for 4+ participants", () => {
  assert.equal(suggestPreset(4), "four_grid");
  assert.equal(suggestPreset(10), "four_grid");
});

// -- shouldSuggestChange ----------------------------------------------------

test("shouldSuggestChange returns null for custom layouts", () => {
  assert.equal(shouldSuggestChange("custom", 3), null);
  assert.equal(shouldSuggestChange(null, 3), null);
});

test("shouldSuggestChange returns null for screen_share and floating presets", () => {
  assert.equal(shouldSuggestChange("screen_share_speaker", 4), null);
  assert.equal(shouldSuggestChange("floating_guest", 4), null);
});

test("shouldSuggestChange returns null when current preset already fits", () => {
  assert.equal(shouldSuggestChange("side_by_side", 1), null);
  assert.equal(shouldSuggestChange("side_by_side", 2), null);
  assert.equal(shouldSuggestChange("four_grid", 3), null);
});

test("shouldSuggestChange recommends a better preset when current has too few slots", () => {
  assert.equal(shouldSuggestChange("solo", 2), "side_by_side");
  assert.equal(shouldSuggestChange("solo", 3), "three_grid");
  assert.equal(shouldSuggestChange("side_by_side", 3), "three_grid");
  assert.equal(shouldSuggestChange("three_grid", 4), "four_grid");
});

// -- normalizeLayoutSlot ----------------------------------------------------

test("normalizeLayoutSlot returns null for non-object input", () => {
  assert.equal(normalizeLayoutSlot(null), null);
  assert.equal(normalizeLayoutSlot(undefined), null);
  assert.equal(normalizeLayoutSlot("string"), null);
  assert.equal(normalizeLayoutSlot(42), null);
});

test("normalizeLayoutSlot returns null when id is missing or empty", () => {
  assert.equal(normalizeLayoutSlot({ x: 0, y: 0, width: 100, height: 100 }), null);
  assert.equal(normalizeLayoutSlot({ id: "", x: 0, y: 0, width: 100, height: 100 }), null);
  assert.equal(normalizeLayoutSlot({ id: "   ", x: 0, y: 0, width: 100, height: 100 }), null);
});

test("normalizeLayoutSlot returns null when required numeric fields are missing", () => {
  assert.equal(normalizeLayoutSlot({ id: "s1", y: 0, width: 100, height: 100 }), null);
  assert.equal(normalizeLayoutSlot({ id: "s1", x: 0, width: 100, height: 100 }), null);
  assert.equal(normalizeLayoutSlot({ id: "s1", x: 0, y: 0, height: 100 }), null);
  assert.equal(normalizeLayoutSlot({ id: "s1", x: 0, y: 0, width: 100 }), null);
});

test("normalizeLayoutSlot parses a valid slot", () => {
  const result = normalizeLayoutSlot({ id: "s1", x: 10, y: 20, width: 300, height: 200, zIndex: 5 });
  assert.deepStrictEqual(result, { id: "s1", x: 10, y: 20, width: 300, height: 200, zIndex: 5 });
});

test("normalizeLayoutSlot defaults zIndex to 1", () => {
  const result = normalizeLayoutSlot({ id: "s1", x: 0, y: 0, width: 100, height: 100 });
  assert.ok(result);
  assert.equal(result.zIndex, 1);
});

test("normalizeLayoutSlot clamps negative width/height to 0", () => {
  const result = normalizeLayoutSlot({ id: "s1", x: 0, y: 0, width: -50, height: -10 });
  assert.ok(result);
  assert.equal(result.width, 0);
  assert.equal(result.height, 0);
});

// -- normalizeStudioLayout --------------------------------------------------

test("normalizeStudioLayout returns null for non-object input", () => {
  assert.equal(normalizeStudioLayout(null), null);
  assert.equal(normalizeStudioLayout(""), null);
  assert.equal(normalizeStudioLayout(42), null);
});

test("normalizeStudioLayout normalizes a valid preset", () => {
  const result = normalizeStudioLayout({
    presetId: "solo",
    slots: [{ id: "slot1", x: 0, y: 0, width: 800, height: 720, zIndex: 1 }],
  });
  assert.ok(result);
  assert.equal(result.presetId, "solo");
  assert.equal(result.slots.length, 1);
  assert.equal(result.adjustMode, "suggest"); // default
});

test("normalizeStudioLayout defaults adjustMode to suggest", () => {
  const result = normalizeStudioLayout({ presetId: "solo" });
  assert.ok(result);
  assert.equal(result.adjustMode, "suggest");
});

test("normalizeStudioLayout accepts valid adjustMode values", () => {
  for (const mode of ["manual", "auto", "suggest"]) {
    const result = normalizeStudioLayout({ presetId: "solo", adjustMode: mode });
    assert.ok(result);
    assert.equal(result.adjustMode, mode);
  }
});

test("normalizeStudioLayout rejects unknown adjustMode and defaults to suggest", () => {
  const result = normalizeStudioLayout({ presetId: "solo", adjustMode: "invalid" });
  assert.ok(result);
  assert.equal(result.adjustMode, "suggest");
});

test("normalizeStudioLayout accepts custom presetId", () => {
  const result = normalizeStudioLayout({ presetId: "custom", slots: [] });
  assert.ok(result);
  assert.equal(result.presetId, "custom");
});

test("normalizeStudioLayout rejects unknown presetId", () => {
  const result = normalizeStudioLayout({ presetId: "nonexistent", slots: [] });
  assert.ok(result);
  assert.equal(result.presetId, null);
});

test("normalizeStudioLayout skips invalid slots", () => {
  const result = normalizeStudioLayout({
    presetId: "custom",
    slots: [
      { id: "ok", x: 0, y: 0, width: 100, height: 100 },
      null,
      { id: "", x: 0, y: 0, width: 100, height: 100 },
      { id: "ok2", x: 10, y: 10, width: 200, height: 200 },
    ],
  });
  assert.ok(result);
  assert.equal(result.slots.length, 2);
  assert.equal(result.slots[0].id, "ok");
  assert.equal(result.slots[1].id, "ok2");
});

test("normalizeStudioLayout parses customSlots", () => {
  const result = normalizeStudioLayout({
    presetId: "custom",
    slots: [],
    customSlots: [{ id: "c1", x: 0, y: 0, width: 500, height: 400, zIndex: 2 }],
  });
  assert.ok(result);
  assert.ok(result.customSlots);
  assert.equal(result.customSlots!.length, 1);
  assert.equal(result.customSlots![0].id, "c1");
});

test("normalizeStudioLayout sets customSlots to null when array is empty or all invalid", () => {
  const result = normalizeStudioLayout({
    presetId: "solo",
    customSlots: [null, { id: "" }],
  });
  assert.ok(result);
  assert.equal(result.customSlots, null);
});

// -- validateSlots ----------------------------------------------------------

test("validateSlots returns no warnings for valid slots", () => {
  const warnings = validateSlots([
    { id: "s1", x: 0, y: 0, width: 640, height: 360, zIndex: 1 },
    { id: "s2", x: 640, y: 0, width: 640, height: 360, zIndex: 1 },
  ]);
  assert.equal(warnings.length, 0);
});

test("validateSlots detects duplicate ids", () => {
  const warnings = validateSlots([
    { id: "dup", x: 0, y: 0, width: 100, height: 100, zIndex: 1 },
    { id: "dup", x: 200, y: 0, width: 100, height: 100, zIndex: 1 },
  ]);
  assert.ok(warnings.some((w) => w.includes("Duplicate")));
});

test("validateSlots detects non-positive dimensions", () => {
  const warnings = validateSlots([
    { id: "s1", x: 0, y: 0, width: 0, height: 100, zIndex: 1 },
  ]);
  assert.ok(warnings.some((w) => w.includes("non-positive")));
});

test("validateSlots detects negative position", () => {
  const warnings = validateSlots([
    { id: "s1", x: -10, y: 0, width: 100, height: 100, zIndex: 1 },
  ]);
  assert.ok(warnings.some((w) => w.includes("negative")));
});

test("validateSlots detects overflow beyond canvas", () => {
  const warnings = validateSlots([
    { id: "s1", x: 1200, y: 0, width: 200, height: 100, zIndex: 1 },
  ]);
  assert.ok(warnings.some((w) => w.includes("beyond canvas")));
});

test("validateSlots allows small overflow within tolerance", () => {
  // 1270 + 20 = 1290, within tolerance of 1280 + 20 = 1300
  const warnings = validateSlots([
    { id: "s1", x: 1270, y: 0, width: 20, height: 100, zIndex: 1 },
  ]);
  assert.equal(warnings.length, 0);
});
