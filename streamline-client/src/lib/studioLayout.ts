/**
 * Studio Layout – client-side types, preset definitions, and helpers.
 *
 * These mirror the server-side definitions in `streamline-server/lib/studioLayout.ts`
 * but are kept separate so the client bundle stays independent from the server.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type LayoutSlot = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
  | "floating_guest"
  | "floating_host";

export type StudioLayoutAdjustMode = "manual" | "auto" | "suggest";

export type StudioLayout = {
  presetId: StudioLayoutPresetId | "custom" | null;
  slots: LayoutSlot[];
  adjustMode: StudioLayoutAdjustMode;
  customSlots?: LayoutSlot[] | null;
};

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;

// ---------------------------------------------------------------------------
// Built-in presets
// ---------------------------------------------------------------------------

const PRESETS: Record<StudioLayoutPresetId, LayoutSlot[]> = {
  solo: [
    { id: "slot1", x: 0, y: 0, width: 1280, height: 720, zIndex: 1 },
  ],

  side_by_side: [
    { id: "slot1", x: 0, y: 0, width: 640, height: 720, zIndex: 1 },
    { id: "slot2", x: 640, y: 0, width: 640, height: 720, zIndex: 1 },
  ],

  host_large_guest_small: [
    { id: "slot1", x: 0, y: 0, width: 960, height: 720, zIndex: 1 },
    { id: "slot2", x: 970, y: 400, width: 300, height: 300, zIndex: 2 },
  ],

  two_up_split: [
    { id: "slot1", x: 20, y: 20, width: 732, height: 680, zIndex: 1 },
    { id: "slot2", x: 772, y: 20, width: 488, height: 680, zIndex: 1 },
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

  floating_host: [
    { id: "slot1", x: 0, y: 0, width: 1280, height: 720, zIndex: 1 },
    { id: "slot2", x: 940, y: 470, width: 320, height: 230, zIndex: 2 },
  ],
};

function buildAdaptiveGridSlots(participantCount: number): LayoutSlot[] {
  const count = Math.max(1, Math.floor(participantCount));
  if (count <= 4) return PRESETS.four_grid.map((s) => ({ ...s }));

  const outerX = 20;
  const outerY = 10;
  const gapX = 10;
  const gapY = 10;

  const cols = Math.max(2, Math.ceil(Math.sqrt(count * (CANVAS_WIDTH / CANVAS_HEIGHT))));
  const rows = Math.ceil(count / cols);

  const usableWidth = CANVAS_WIDTH - outerX * 2;
  const usableHeight = CANVAS_HEIGHT - outerY * 2;
  const tileWidth = Math.floor((usableWidth - gapX * (cols - 1)) / cols);
  const tileHeight = Math.floor((usableHeight - gapY * (rows - 1)) / rows);

  const slots: LayoutSlot[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const isLastRow = row === rows - 1;
    const itemsInLastRow = count - cols * (rows - 1);
    const rowCols = isLastRow && itemsInLastRow > 0 ? itemsInLastRow : cols;
    const rowWidth = rowCols * tileWidth + (rowCols - 1) * gapX;
    const startX = Math.floor((CANVAS_WIDTH - rowWidth) / 2);

    slots.push({
      id: `slot${i + 1}`,
      x: startX + col * (tileWidth + gapX),
      y: outerY + row * (tileHeight + gapY),
      width: tileWidth,
      height: tileHeight,
      zIndex: 1,
    });
  }

  return slots;
}

export function getPresetSlots(presetId: StudioLayoutPresetId, participantCount?: number): LayoutSlot[] {
  if (presetId === "four_grid" && typeof participantCount === "number" && participantCount > 4) {
    return buildAdaptiveGridSlots(participantCount);
  }
  const slots = PRESETS[presetId];
  if (!slots) return [];
  return slots.map((s) => ({ ...s }));
}

export const ALL_PRESET_IDS: StudioLayoutPresetId[] = [
  "solo",
  "side_by_side",
  "host_large_guest_small",
  "two_up_split",
  "three_grid",
  "four_grid",
  "screen_share_speaker",
  "floating_guest",
  "floating_host",
];

export function isValidPresetId(v: unknown): v is StudioLayoutPresetId {
  return typeof v === "string" && (ALL_PRESET_IDS as string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Preset metadata for the UI
// ---------------------------------------------------------------------------

export type PresetInfo = {
  id: StudioLayoutPresetId;
  label: string;
  description: string;
  slotCount: number;
  icon: string; // Emoji for quick visual reference
};

export const PRESET_INFO: PresetInfo[] = [
  { id: "solo", label: "Solo", description: "Single full-screen participant", slotCount: 1, icon: "👤" },
  { id: "side_by_side", label: "Side by Side", description: "Two participants equally sized", slotCount: 2, icon: "👥" },
  { id: "host_large_guest_small", label: "Host + Guest", description: "Host large, guest small overlay", slotCount: 2, icon: "🎙️" },
  { id: "two_up_split", label: "2-Up Split", description: "Two participants with larger primary split", slotCount: 2, icon: "◼️◻️" },
  { id: "three_grid", label: "3-Person Grid", description: "Three participants in a grid", slotCount: 3, icon: "🔲" },
  { id: "four_grid", label: "4+ Grid", description: "Grid that scales with guest count", slotCount: 4, icon: "⊞" },
  { id: "screen_share_speaker", label: "Screen + Speaker", description: "Screen share with speaker cam", slotCount: 2, icon: "🖥️" },
  { id: "floating_guest", label: "Floating Guest", description: "Full background with floating overlay", slotCount: 2, icon: "💬" },
  { id: "floating_host", label: "Floating Host", description: "Guest full-screen with floating host overlay", slotCount: 2, icon: "🫧" },
];

// ---------------------------------------------------------------------------
// Auto-suggest logic
// ---------------------------------------------------------------------------

export function suggestPreset(participantCount: number): StudioLayoutPresetId {
  if (participantCount <= 1) return "solo";
  if (participantCount === 2) return "side_by_side";
  if (participantCount === 3) return "three_grid";
  return "four_grid";
}

export function shouldSuggestChange(
  currentPresetId: StudioLayoutPresetId | "custom" | null,
  participantCount: number,
): StudioLayoutPresetId | null {
  const suggestion = suggestPreset(participantCount);

  if (currentPresetId === "custom" || currentPresetId === null) return null;
  if (
    currentPresetId === "screen_share_speaker" ||
    currentPresetId === "floating_guest" ||
    currentPresetId === "floating_host"
  ) {
    return null;
  }

  const currentSlots = PRESETS[currentPresetId];
  if (currentSlots && currentSlots.length === participantCount) return null;

  // Suggest both scaling up (too few slots) and scaling down (too many
  // slots -> empty black space on the composed output).
  return suggestion === currentPresetId ? null : suggestion;
}
