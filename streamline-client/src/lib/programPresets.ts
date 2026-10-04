/**
 * Program layout presets (programState v2).
 *
 * Pure TypeScript, no dependencies: the server keeps an identical copy at
 * `streamline-server/lib/programPresets.ts` (used by the API and the egress
 * compositor). Keep the two files in sync.
 *
 * All geometry is expressed as fractions (0..1) of the output canvas, so the
 * same layout renders identically in the room stage, the picker previews and
 * the composed stream regardless of pixel size.
 */

// ---------------------------------------------------------------------------
// Types (programState v2 contract)
// ---------------------------------------------------------------------------

export type SlotSource =
  | { kind: "auto" }
  | { kind: "participant"; identity: string; track: "camera" | "screen" }
  | { kind: "auto-screen" };

export type FracSlot = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
  source: SlotSource;
  fit?: "cover" | "contain";
  label?: boolean;
};

export type OrientationLayout = { presetId: string; slots: FracSlot[] };

export type Orientation = "landscape" | "portrait";

export type ScreenShareMode = "auto" | "manual";

export type ProgramStateV2 = {
  version: 2;
  landscape: OrientationLayout;
  portrait: OrientationLayout;
  screenShareMode: ScreenShareMode;
  hostIdentity: string | null;
  updatedAt: number;
  /** Legacy (v1) mirror fields, kept by the server for old clients. */
  programLayout?: string | null;
  programSlots?: unknown[];
  programParticipants?: string[];
};

/** PATCH /api/rooms/:roomId/program-state body. */
export type ProgramStateV2Patch = {
  version: 2;
  landscape: OrientationLayout;
  portrait?: OrientationLayout;
  screenShareMode: ScreenShareMode;
};

export type ProgramPreset = {
  id: string;
  label: string;
  description: string;
  orientation: Orientation;
  /** True when the preset has a slot reserved for a screen share. */
  screen: boolean;
  slots: FracSlot[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LW = 1280;
const LH = 720;

const round4 = (v: number) => Math.round(v * 10000) / 10000;

const AUTO: SlotSource = { kind: "auto" };
const AUTO_SCREEN: SlotSource = { kind: "auto-screen" };

/** Fractional slot from a 1280x720 pixel rectangle (legacy studio presets). */
function px(id: string, x: number, y: number, w: number, h: number, z = 1, source: SlotSource = AUTO): FracSlot {
  return { id, x: round4(x / LW), y: round4(y / LH), w: round4(w / LW), h: round4(h / LH), z, source };
}

function frac(id: string, x: number, y: number, w: number, h: number, z = 1, source: SlotSource = AUTO): FracSlot {
  return { id, x: round4(x), y: round4(y), w: round4(w), h: round4(h), z, source };
}

function preset(
  id: string,
  label: string,
  description: string,
  orientation: Orientation,
  slots: FracSlot[],
): ProgramPreset {
  return {
    id,
    label,
    description,
    orientation,
    screen: slots.some((s) => s.source.kind === "auto-screen"),
    slots,
  };
}

// ---------------------------------------------------------------------------
// Landscape (16:9) presets
// ---------------------------------------------------------------------------

export const LANDSCAPE_PRESETS: ProgramPreset[] = [
  preset("solo", "Solo", "Single full-screen participant", "landscape", [px("slot1", 0, 0, 1280, 720)]),
  preset("side_by_side", "Side by Side", "Two participants equally sized", "landscape", [
    px("slot1", 0, 0, 640, 720),
    px("slot2", 640, 0, 640, 720),
  ]),
  preset("host_large_guest_small", "Host + Guest", "Host large, guest small overlay", "landscape", [
    px("slot1", 0, 0, 960, 720),
    px("slot2", 970, 400, 300, 300, 2),
  ]),
  preset("two_up_split", "2-Up Split", "Two participants with larger primary split", "landscape", [
    px("slot1", 20, 20, 732, 680),
    px("slot2", 772, 20, 488, 680),
  ]),
  preset("three_grid", "3-Person Grid", "Three participants in a grid", "landscape", [
    px("slot1", 328, 10, 625, 345),
    px("slot2", 10, 365, 625, 345),
    px("slot3", 645, 365, 625, 345),
  ]),
  preset("four_grid", "4 Grid", "Four participants in a 2x2 grid", "landscape", [
    px("slot1", 20, 10, 610, 345),
    px("slot2", 650, 10, 610, 345),
    px("slot3", 20, 365, 610, 345),
    px("slot4", 650, 365, 610, 345),
  ]),
  preset("screen_share_speaker", "Screen + Speaker", "Large main slot with a small speaker slot", "landscape", [
    px("slot1", 0, 0, 960, 720),
    px("slot2", 970, 10, 300, 170, 2),
  ]),
  preset("floating_guest", "Floating Guest", "Full background with floating overlay", "landscape", [
    px("slot1", 0, 0, 1280, 720),
    px("slot2", 940, 470, 320, 230, 2),
  ]),
  preset("floating_host", "Floating Host", "Full background with floating overlay", "landscape", [
    px("slot1", 0, 0, 1280, 720),
    px("slot2", 940, 470, 320, 230, 2),
  ]),
  preset("screen_focus", "Screen Focus", "Screen share large, up to 3 cameras on the right", "landscape", [
    frac("screen", 0, 0, 0.8, 1, 1, AUTO_SCREEN),
    frac("cam1", 0.8, 0, 0.2, 1 / 3),
    frac("cam2", 0.8, 1 / 3, 0.2, 1 / 3),
    frac("cam3", 0.8, 2 / 3, 0.2, 1 / 3),
  ]),
  preset("screen_side", "Screen + Side Cam", "Screen share 70%, one camera 30%", "landscape", [
    frac("screen", 0, 0, 0.7, 1, 1, AUTO_SCREEN),
    frac("cam1", 0.7, 0, 0.3, 1),
  ]),
  preset("screen_pip", "Screen + PiP", "Full screen share with a camera inset", "landscape", [
    frac("screen", 0, 0, 1, 1, 1, AUTO_SCREEN),
    frac("cam1", 0.76, 0.76, 0.22, 0.22, 2),
  ]),
];

// ---------------------------------------------------------------------------
// Portrait (9:16) presets (from verticalLayouts.ts VERTICAL_PRESETS)
// ---------------------------------------------------------------------------

export const PORTRAIT_PRESETS: ProgramPreset[] = [
  preset("solo_vertical", "Solo Vertical", "Single full-screen participant", "portrait", [frac("host", 0, 0, 1, 1)]),
  preset("stack_2", "2 Stack", "Two participants stacked", "portrait", [
    frac("host", 0, 0, 1, 0.5),
    frac("guest", 0, 0.5, 1, 0.5),
  ]),
  preset("stack_3", "3 Stack", "Three participants stacked", "portrait", [
    frac("host", 0, 0, 1, 0.34),
    frac("guest1", 0, 0.34, 1, 0.33),
    frac("guest2", 0, 0.67, 1, 0.33),
  ]),
  preset("vertical_featured_2small", "Featured + 2", "Featured speaker with two small guests", "portrait", [
    frac("featured", 0, 0, 1, 0.6),
    frac("guest1", 0, 0.6, 0.5, 0.4),
    frac("guest2", 0.5, 0.6, 0.5, 0.4),
  ]),
  preset("screenshare_facecam", "Screen + Face Cam", "Screen share on top, face cam below", "portrait", [
    frac("screen", 0, 0, 1, 0.65, 1, AUTO_SCREEN),
    frac("facecam", 0.6, 0.65, 0.4, 0.35, 2),
  ]),
  preset("vertical_interview", "Interview", "Two framed participants", "portrait", [
    frac("interviewer", 0.05, 0.02, 0.9, 0.47),
    frac("interviewee", 0.05, 0.51, 0.9, 0.47),
  ]),
];

/** Original verticalLayouts.ts ids -> canonical portrait ids. */
export const PORTRAIT_ALIASES: Record<string, string> = {
  vertical_solo: "solo_vertical",
  vertical_host_guest_stack: "stack_2",
  vertical_3up_panel: "stack_3",
  vertical_screenshare_facecam: "screenshare_facecam",
};

export const SCREEN_OVERRIDE: Record<Orientation, string> = {
  landscape: "screen_focus",
  portrait: "screenshare_facecam",
};

// ---------------------------------------------------------------------------
// Lookup / build
// ---------------------------------------------------------------------------

export function presetsFor(orientation: Orientation): ProgramPreset[] {
  return orientation === "portrait" ? PORTRAIT_PRESETS : LANDSCAPE_PRESETS;
}

export function getPreset(presetId: string, orientation: Orientation): ProgramPreset | null {
  const id = orientation === "portrait" ? PORTRAIT_ALIASES[presetId] ?? presetId : presetId;
  return presetsFor(orientation).find((p) => p.id === id) ?? null;
}

function cloneSlot(s: FracSlot): FracSlot {
  return { ...s, source: { ...s.source } as SlotSource };
}

/** Builds a fresh layout for a preset, or null for an unknown id. */
export function buildOrientationLayout(presetId: string, orientation: Orientation): OrientationLayout | null {
  const p = getPreset(presetId, orientation);
  if (!p) return null;
  return { presetId: p.id, slots: p.slots.map(cloneSlot) };
}

export function suggestPreset(count: number, orientation: Orientation): string {
  if (orientation === "portrait") {
    if (count <= 1) return "solo_vertical";
    if (count === 2) return "stack_2";
    return "stack_3";
  }
  if (count <= 1) return "solo";
  if (count === 2) return "side_by_side";
  if (count === 3) return "three_grid";
  return "four_grid";
}

/** Default portrait preset for a landscape preset. */
export function portraitFor(landscapeId: string): string {
  const id = String(landscapeId || "");
  if (id === "solo") return "solo_vertical";
  if (id.startsWith("screen_")) return "screenshare_facecam";
  if (id === "side_by_side" || id.startsWith("two_up") || id === "host_large_guest_small") return "stack_2";
  if (id.startsWith("floating_")) return "stack_2";
  if (id.includes("grid") || id === "speaker_focus") return "stack_3";
  return "stack_2";
}

/** True when a layout has a slot that can show a screen share. */
export function layoutHasScreenSlot(layout: OrientationLayout | null | undefined): boolean {
  if (!layout || !Array.isArray(layout.slots)) return false;
  return layout.slots.some(
    (s) => s.source?.kind === "auto-screen" || (s.source?.kind === "participant" && s.source.track === "screen"),
  );
}
