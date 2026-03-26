/**
 * Studio Layout system – types, presets, normalization, and auto-suggest logic.
 *
 * A "studio layout" defines *where* each participant's video appears on the
 * composed program canvas.  It is independent of the LiveKit room layout
 * (`roomLayout`) which controls how the *viewer/participant* sees the room.
 *
 * Each layout is a list of **LayoutSlot** objects (absolute pixel positions
 * inside a 1280×720 reference canvas) plus metadata.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type LayoutSlot = {
  id: string;
  /** Horizontal offset (px, 0 = left edge of 1280-wide canvas). */
  x: number;
  /** Vertical offset (px, 0 = top edge of 720-high canvas). */
  y: number;
  /** Width in px. */
  width: number;
  /** Height in px. */
  height: number;
  /** Stack order – higher = in front. */
  zIndex: number;
};

export type StudioLayoutPresetId =
  | "solo"
  | "side_by_side"
  | "host_large_guest_small"
  | "two_up_split"
  | "three_grid"
  | "four_grid"
  | "screen_share_speaker"
  | "floating_guest";

export type StudioLayoutAdjustMode = "manual" | "auto" | "suggest";

export type StudioLayout = {
  /** Which preset is active (null when fully custom). */
  presetId: StudioLayoutPresetId | "custom" | null;
  /** The concrete slot positions – may be edited from the preset default. */
  slots: LayoutSlot[];
  /** How the system reacts when participant count changes. */
  adjustMode: StudioLayoutAdjustMode;
  /** If the host saved a custom arrangement, store it here. */
  customSlots?: LayoutSlot[] | null;
};

// ---------------------------------------------------------------------------
// Reference canvas dimensions
// ---------------------------------------------------------------------------

export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;

// ---------------------------------------------------------------------------
// Built-in presets
// ---------------------------------------------------------------------------

const PRESETS: Record<StudioLayoutPresetId, LayoutSlot[]> = {
  solo: [
    { id: "slot1", x: 240, y: 0, width: 800, height: 720, zIndex: 1 },
  ],

  side_by_side: [
    { id: "slot1", x: 20, y: 60, width: 610, height: 600, zIndex: 1 },
    { id: "slot2", x: 650, y: 60, width: 610, height: 600, zIndex: 1 },
  ],

  host_large_guest_small: [
    { id: "slot1", x: 0, y: 0, width: 960, height: 720, zIndex: 1 },
    { id: "slot2", x: 970, y: 400, width: 300, height: 300, zIndex: 2 },
  ],

  two_up_split: [
    { id: "slot1", x: 0, y: 0, width: 640, height: 720, zIndex: 1 },
    { id: "slot2", x: 640, y: 0, width: 640, height: 720, zIndex: 1 },
  ],

  three_grid: [
    { id: "slot1", x: 328, y: 10, width: 625, height: 345, zIndex: 1 },
    { id: "slot2", x: 10, y: 365, width: 625, height: 345, zIndex: 1 },
    { id: "slot3", x: 645, y: 365, width: 625, height: 345, zIndex: 1 },
  ],

  four_grid: [
    { id: "slot1", x: 20, y: 10, width: 610, height: 345, zIndex: 1 },
    { id: "slot2", x: 650, y: 10, width: 610, height: 345, zIndex: 1 },
    { id: "slot3", x: 20, y: 365, width: 610, height: 345, zIndex: 1 },
    { id: "slot4", x: 650, y: 365, width: 610, height: 345, zIndex: 1 },
  ],

  screen_share_speaker: [
    { id: "slot1", x: 0, y: 0, width: 960, height: 720, zIndex: 1 },
    { id: "slot2", x: 970, y: 10, width: 300, height: 170, zIndex: 2 },
  ],

  floating_guest: [
    { id: "slot1", x: 0, y: 0, width: 1280, height: 720, zIndex: 1 },
    { id: "slot2", x: 940, y: 470, width: 320, height: 230, zIndex: 2 },
  ],
};

export function getPresetSlots(presetId: StudioLayoutPresetId): LayoutSlot[] {
  const slots = PRESETS[presetId];
  if (!slots) return [];
  // Return deep copies so callers can't mutate the canonical definitions.
  return slots.map((s) => ({ ...s }));
}

export function getAllPresetIds(): StudioLayoutPresetId[] {
  return Object.keys(PRESETS) as StudioLayoutPresetId[];
}

export function isValidPresetId(v: unknown): v is StudioLayoutPresetId {
  return typeof v === "string" && v in PRESETS;
}

// ---------------------------------------------------------------------------
// Human-readable preset labels
// ---------------------------------------------------------------------------

const PRESET_LABELS: Record<StudioLayoutPresetId, string> = {
  solo: "Solo",
  side_by_side: "Side by Side",
  host_large_guest_small: "Host Large + Guest Small",
  two_up_split: "2-Up Split",
  three_grid: "3-Person Grid",
  four_grid: "4-Person Grid",
  screen_share_speaker: "Screen Share + Speaker",
  floating_guest: "Floating Guest",
};

export function getPresetLabel(presetId: StudioLayoutPresetId): string {
  return PRESET_LABELS[presetId] ?? presetId;
}

// ---------------------------------------------------------------------------
// Auto-suggest logic
// ---------------------------------------------------------------------------

/**
 * Given a participant count, suggest the best default preset.
 *
 * Rules:
 * - 1 participant  → solo
 * - 2 participants → side_by_side
 * - 3 participants → three_grid
 * - 4+ participants → four_grid
 *
 * Screen-share and floating-guest presets are never auto-suggested – they must
 * be chosen manually.
 */
export function suggestPreset(participantCount: number): StudioLayoutPresetId {
  if (participantCount <= 1) return "solo";
  if (participantCount === 2) return "side_by_side";
  if (participantCount === 3) return "three_grid";
  return "four_grid";
}

/**
 * Check whether the current preset is still suitable for the new participant
 * count.  Returns the suggested preset if a change is recommended, or `null`
 * if the current preset is already a good fit.
 */
export function shouldSuggestChange(
  currentPresetId: StudioLayoutPresetId | "custom" | null,
  participantCount: number,
): StudioLayoutPresetId | null {
  const suggestion = suggestPreset(participantCount);

  // Never suggest a change away from manual/custom layouts.
  if (currentPresetId === "custom" || currentPresetId === null) return null;

  // Never suggest screen-share or floating presets be auto-replaced.
  if (
    currentPresetId === "screen_share_speaker" ||
    currentPresetId === "floating_guest"
  ) {
    return null;
  }

  // If the number of slots in the current preset already fits, keep it.
  const currentSlots = PRESETS[currentPresetId];
  if (currentSlots && currentSlots.length >= participantCount) return null;

  // The current preset does not have enough slots – suggest a better one.
  return suggestion === currentPresetId ? null : suggestion;
}

// ---------------------------------------------------------------------------
// Normalisation / validation helpers
// ---------------------------------------------------------------------------

function pickFiniteNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

export function normalizeLayoutSlot(input: unknown): LayoutSlot | null {
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

export function normalizeStudioLayout(input: unknown): StudioLayout | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;

  // presetId
  const rawPresetId = o.presetId;
  let presetId: StudioLayout["presetId"] = null;
  if (rawPresetId === "custom") {
    presetId = "custom";
  } else if (typeof rawPresetId === "string" && isValidPresetId(rawPresetId)) {
    presetId = rawPresetId;
  }

  // slots
  let slots: LayoutSlot[] = [];
  if (Array.isArray(o.slots)) {
    for (const raw of o.slots) {
      const s = normalizeLayoutSlot(raw);
      if (s) slots.push(s);
    }
  }

  // If a valid presetId was given but no slots, seed from the preset.
  if (slots.length === 0 && presetId && presetId !== "custom" && isValidPresetId(presetId)) {
    slots = getPresetSlots(presetId);
  }

  // adjustMode
  const rawAdjust = String(o.adjustMode ?? "suggest").toLowerCase();
  const adjustMode: StudioLayoutAdjustMode =
    rawAdjust === "auto" || rawAdjust === "manual" || rawAdjust === "suggest"
      ? rawAdjust
      : "suggest";

  // customSlots
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

/**
 * Validate an array of layout slots against the reference canvas.
 * Returns a list of warning strings (empty = all OK).
 */
export function validateSlots(slots: LayoutSlot[]): string[] {
  const warnings: string[] = [];
  const ids = new Set<string>();

  for (const s of slots) {
    if (ids.has(s.id)) {
      warnings.push(`Duplicate slot id "${s.id}".`);
    }
    ids.add(s.id);

    if (s.width <= 0 || s.height <= 0) {
      warnings.push(`Slot "${s.id}" has non-positive dimensions.`);
    }
    if (s.x < 0 || s.y < 0) {
      warnings.push(`Slot "${s.id}" has negative position.`);
    }
    if (s.x + s.width > CANVAS_WIDTH + 20) {
      warnings.push(`Slot "${s.id}" extends beyond canvas width.`);
    }
    if (s.y + s.height > CANVAS_HEIGHT + 20) {
      warnings.push(`Slot "${s.id}" extends beyond canvas height.`);
    }
  }

  return warnings;
}
