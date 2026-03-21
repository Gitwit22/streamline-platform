import type { OutputFormat } from "./api";

/**
 * A layout slot describes where a participant tile is placed inside
 * the reference canvas for a given output format.
 *
 * Coordinates are expressed as fractions (0–1) of the canvas so they
 * work regardless of the actual pixel resolution.
 */
export type VerticalLayoutSlot = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
  label?: string;
};

export type VerticalLayoutPreset = {
  id: string;
  label: string;
  outputFormat: OutputFormat;
  participantCount: number;
  slots: VerticalLayoutSlot[];
};

// ---------------------------------------------------------------------------
// Canvas pixel dimensions for each output format
// ---------------------------------------------------------------------------
export const OUTPUT_FORMAT_DIMENSIONS: Record<OutputFormat, { width: number; height: number }> = {
  landscape_16x9: { width: 1920, height: 1080 },
  vertical_9x16: { width: 1080, height: 1920 },
  square_1x1: { width: 1080, height: 1080 },
};

export const OUTPUT_FORMAT_LABELS: Record<OutputFormat, string> = {
  landscape_16x9: "Widescreen 16:9",
  vertical_9x16: "Vertical 9:16",
  square_1x1: "Square 1:1",
};

export const VALID_OUTPUT_FORMATS: readonly OutputFormat[] = [
  "landscape_16x9",
  "vertical_9x16",
  "square_1x1",
] as const;

// ---------------------------------------------------------------------------
// Vertical (9:16) presets – designed for Instagram / TikTok / Reels
// ---------------------------------------------------------------------------

export const VERTICAL_PRESETS: VerticalLayoutPreset[] = [
  {
    id: "vertical_solo",
    label: "Solo Vertical",
    outputFormat: "vertical_9x16",
    participantCount: 1,
    slots: [
      { id: "host", x: 0, y: 0, width: 1, height: 1, label: "Host" },
    ],
  },
  {
    id: "vertical_host_guest_stack",
    label: "Host + Guest Stack",
    outputFormat: "vertical_9x16",
    participantCount: 2,
    slots: [
      { id: "host", x: 0, y: 0, width: 1, height: 0.5, label: "Host (top)" },
      { id: "guest", x: 0, y: 0.5, width: 1, height: 0.5, label: "Guest (bottom)" },
    ],
  },
  {
    id: "vertical_3up_panel",
    label: "3-Up Vertical Panel",
    outputFormat: "vertical_9x16",
    participantCount: 3,
    slots: [
      { id: "host", x: 0, y: 0, width: 1, height: 0.34, label: "Host (top)" },
      { id: "guest1", x: 0, y: 0.34, width: 1, height: 0.33, label: "Guest 1 (middle)" },
      { id: "guest2", x: 0, y: 0.67, width: 1, height: 0.33, label: "Guest 2 (bottom)" },
    ],
  },
  {
    id: "vertical_featured_2small",
    label: "Featured Speaker + 2 Small Guests",
    outputFormat: "vertical_9x16",
    participantCount: 3,
    slots: [
      { id: "featured", x: 0, y: 0, width: 1, height: 0.6, zIndex: 1, label: "Featured" },
      { id: "guest1", x: 0, y: 0.6, width: 0.5, height: 0.4, label: "Guest 1" },
      { id: "guest2", x: 0.5, y: 0.6, width: 0.5, height: 0.4, label: "Guest 2" },
    ],
  },
  {
    id: "vertical_screenshare_facecam",
    label: "Screen Share + Face Cam Vertical",
    outputFormat: "vertical_9x16",
    participantCount: 2,
    slots: [
      { id: "screen", x: 0, y: 0, width: 1, height: 0.65, label: "Screen share" },
      { id: "facecam", x: 0.6, y: 0.65, width: 0.4, height: 0.35, zIndex: 2, label: "Face cam" },
    ],
  },
  {
    id: "vertical_interview",
    label: "Interview Layout Vertical",
    outputFormat: "vertical_9x16",
    participantCount: 2,
    slots: [
      { id: "interviewer", x: 0.05, y: 0.02, width: 0.9, height: 0.47, label: "Interviewer" },
      { id: "interviewee", x: 0.05, y: 0.51, width: 0.9, height: 0.47, label: "Interviewee" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Square (1:1) presets
// ---------------------------------------------------------------------------

export const SQUARE_PRESETS: VerticalLayoutPreset[] = [
  {
    id: "square_solo",
    label: "Solo Square",
    outputFormat: "square_1x1",
    participantCount: 1,
    slots: [
      { id: "host", x: 0, y: 0, width: 1, height: 1, label: "Host" },
    ],
  },
  {
    id: "square_2up",
    label: "2-Up Square",
    outputFormat: "square_1x1",
    participantCount: 2,
    slots: [
      { id: "host", x: 0, y: 0, width: 1, height: 0.5, label: "Host (top)" },
      { id: "guest", x: 0, y: 0.5, width: 1, height: 0.5, label: "Guest (bottom)" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_PRESETS = [...VERTICAL_PRESETS, ...SQUARE_PRESETS];
const PRESET_MAP = new Map(ALL_PRESETS.map((p) => [p.id, p]));

export function getVerticalPresetById(id: string): VerticalLayoutPreset | undefined {
  return PRESET_MAP.get(id);
}

export function getPresetsForFormat(format: OutputFormat): VerticalLayoutPreset[] {
  return ALL_PRESETS.filter((p) => p.outputFormat === format);
}

export function getPresetsForParticipantCount(
  format: OutputFormat,
  count: number
): VerticalLayoutPreset[] {
  return ALL_PRESETS.filter((p) => p.outputFormat === format && p.participantCount === count);
}

// ---------------------------------------------------------------------------
// Safe-zone helper: check if a 16:9 layout fits inside a vertical safe area.
// ---------------------------------------------------------------------------

export type SafeZoneWarning = {
  slotId: string;
  message: string;
};

/**
 * Given slot positions on a standard 16:9 canvas, check whether each slot
 * fits inside the centred 9:16 vertical safe crop zone.  This helps warn
 * hosts when their widescreen layout will clip on Instagram.
 */
export function checkVerticalSafeZone(
  slots: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  canvasWidth: number,
  canvasHeight: number
): SafeZoneWarning[] {
  const safeWidth = canvasHeight * (9 / 16);
  const safeLeft = (canvasWidth - safeWidth) / 2;
  const safeRight = safeLeft + safeWidth;
  const warnings: SafeZoneWarning[] = [];
  for (const slot of slots) {
    const slotLeft = slot.x * canvasWidth;
    const slotRight = (slot.x + slot.width) * canvasWidth;
    if (slotLeft < safeLeft - 1 || slotRight > safeRight + 1) {
      warnings.push({
        slotId: slot.id,
        message: `Slot "${slot.id}" extends outside the vertical safe zone and may be cropped on Instagram.`,
      });
    }
  }
  return warnings;
}
