/**
 * Program layout presets (programState v2) – shared, dependency-free data.
 *
 * Every slot is expressed in FRACTIONS (0..1) of the output canvas, so the
 * same layout renders without distortion at any resolution of the given
 * orientation (16:9 landscape, 9:16 portrait).
 *
 * This file is mirrored byte-for-byte by streamline-client/src/lib/programPresets.ts
 * and serialised to streamline-server/public/egress-templates/program-presets.json
 * for the egress compositor.  Keep it pure TypeScript with no imports.
 */

// ---------------------------------------------------------------------------
// Types
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

export type Orientation = "landscape" | "portrait";

export type OrientationLayout = { presetId: string; slots: FracSlot[] };

export type ProgramPreset = { id: string; label: string; slots: FracSlot[] };

// ---------------------------------------------------------------------------
// Landscape (16:9) presets
// ---------------------------------------------------------------------------

const A: SlotSource = { kind: "auto" };
const S: SlotSource = { kind: "auto-screen" };

export const LANDSCAPE_PRESETS: ProgramPreset[] = [
  {
    id: "solo",
    label: "Solo",
    slots: [{ id: "slot1", x: 0, y: 0, w: 1, h: 1, z: 1, source: A }],
  },
  {
    id: "side_by_side",
    label: "Side by Side",
    slots: [
      { id: "slot1", x: 0, y: 0, w: 0.5, h: 1, z: 1, source: A },
      { id: "slot2", x: 0.5, y: 0, w: 0.5, h: 1, z: 1, source: A },
    ],
  },
  {
    id: "grid_2x2",
    label: "2×2 Grid",
    slots: [
      { id: "slot1", x: 0, y: 0, w: 0.5, h: 0.5, z: 1, source: A },
      { id: "slot2", x: 0.5, y: 0, w: 0.5, h: 0.5, z: 1, source: A },
      { id: "slot3", x: 0, y: 0.5, w: 0.5, h: 0.5, z: 1, source: A },
      { id: "slot4", x: 0.5, y: 0.5, w: 0.5, h: 0.5, z: 1, source: A },
    ],
  },
  {
    id: "grid_3x3",
    label: "3×3 Grid",
    slots: [
      { id: "slot1", x: 0, y: 0, w: 0.3333, h: 0.3333, z: 1, source: A },
      { id: "slot2", x: 0.3333, y: 0, w: 0.3334, h: 0.3333, z: 1, source: A },
      { id: "slot3", x: 0.6667, y: 0, w: 0.3333, h: 0.3333, z: 1, source: A },
      { id: "slot4", x: 0, y: 0.3333, w: 0.3333, h: 0.3334, z: 1, source: A },
      { id: "slot5", x: 0.3333, y: 0.3333, w: 0.3334, h: 0.3334, z: 1, source: A },
      { id: "slot6", x: 0.6667, y: 0.3333, w: 0.3333, h: 0.3334, z: 1, source: A },
      { id: "slot7", x: 0, y: 0.6667, w: 0.3333, h: 0.3333, z: 1, source: A },
      { id: "slot8", x: 0.3333, y: 0.6667, w: 0.3334, h: 0.3333, z: 1, source: A },
      { id: "slot9", x: 0.6667, y: 0.6667, w: 0.3333, h: 0.3333, z: 1, source: A },
    ],
  },
  {
    id: "speaker_focus",
    label: "Speaker Focus",
    slots: [
      { id: "main", x: 0, y: 0, w: 0.75, h: 1, z: 1, source: A },
      { id: "side1", x: 0.75, y: 0, w: 0.25, h: 0.3333, z: 1, source: A },
      { id: "side2", x: 0.75, y: 0.3333, w: 0.25, h: 0.3334, z: 1, source: A },
      { id: "side3", x: 0.75, y: 0.6667, w: 0.25, h: 0.3333, z: 1, source: A },
    ],
  },
  {
    // Host (first in order) floats small over the first guest.
    id: "floating_host",
    label: "Floating Host",
    slots: [
      { id: "inset", x: 0.73, y: 0.715, w: 0.25, h: 0.25, z: 2, source: A },
      { id: "main", x: 0, y: 0, w: 1, h: 1, z: 1, source: A },
    ],
  },
  {
    // Host (first in order) full screen, first guest floats small.
    id: "floating_guest",
    label: "Floating Guest",
    slots: [
      { id: "main", x: 0, y: 0, w: 1, h: 1, z: 1, source: A },
      { id: "inset", x: 0.73, y: 0.715, w: 0.25, h: 0.25, z: 2, source: A },
    ],
  },
  {
    id: "host_large_guest_small",
    label: "Host Large + Guest Small",
    slots: [
      { id: "slot1", x: 0, y: 0, w: 0.75, h: 1, z: 1, source: A },
      { id: "slot2", x: 0.7578, y: 0.5556, w: 0.2344, h: 0.4167, z: 2, source: A },
    ],
  },
  {
    id: "two_up_split",
    label: "2-Up Split",
    slots: [
      { id: "slot1", x: 0.0156, y: 0.0278, w: 0.5719, h: 0.9444, z: 1, source: A },
      { id: "slot2", x: 0.6031, y: 0.0278, w: 0.3813, h: 0.9444, z: 1, source: A },
    ],
  },
  {
    id: "three_grid",
    label: "3-Person Grid",
    slots: [
      { id: "slot1", x: 0.2563, y: 0.0139, w: 0.4883, h: 0.4792, z: 1, source: A },
      { id: "slot2", x: 0.0078, y: 0.5069, w: 0.4883, h: 0.4792, z: 1, source: A },
      { id: "slot3", x: 0.5039, y: 0.5069, w: 0.4883, h: 0.4792, z: 1, source: A },
    ],
  },
  {
    id: "four_grid",
    label: "4-Person Grid",
    slots: [
      { id: "slot1", x: 0.0156, y: 0.0139, w: 0.4766, h: 0.4792, z: 1, source: A },
      { id: "slot2", x: 0.5078, y: 0.0139, w: 0.4766, h: 0.4792, z: 1, source: A },
      { id: "slot3", x: 0.0156, y: 0.5069, w: 0.4766, h: 0.4792, z: 1, source: A },
      { id: "slot4", x: 0.5078, y: 0.5069, w: 0.4766, h: 0.4792, z: 1, source: A },
    ],
  },
  {
    id: "screen_share_speaker",
    label: "Screen Share + Speaker",
    slots: [
      { id: "screen", x: 0, y: 0, w: 0.75, h: 1, z: 1, source: S },
      { id: "cam1", x: 0.7578, y: 0.0139, w: 0.2344, h: 0.2361, z: 2, source: A },
    ],
  },
  {
    id: "screen_focus",
    label: "Screen Focus",
    slots: [
      { id: "screen", x: 0, y: 0, w: 0.8, h: 1, z: 1, source: S },
      { id: "cam1", x: 0.8, y: 0, w: 0.2, h: 0.3333, z: 1, source: A },
      { id: "cam2", x: 0.8, y: 0.3333, w: 0.2, h: 0.3334, z: 1, source: A },
      { id: "cam3", x: 0.8, y: 0.6667, w: 0.2, h: 0.3333, z: 1, source: A },
    ],
  },
  {
    id: "screen_side",
    label: "Screen + Side Cam",
    slots: [
      { id: "screen", x: 0, y: 0, w: 0.7, h: 1, z: 1, source: S },
      { id: "cam1", x: 0.7, y: 0.35, w: 0.3, h: 0.3, z: 1, source: A },
    ],
  },
  {
    id: "screen_pip",
    label: "Screen + Picture-in-Picture",
    slots: [
      { id: "screen", x: 0, y: 0, w: 1, h: 1, z: 1, source: S },
      { id: "cam1", x: 0.76, y: 0.75, w: 0.22, h: 0.22, z: 2, source: A },
    ],
  },
];

// ---------------------------------------------------------------------------
// Portrait (9:16) presets – Instagram / Reels / TikTok
// ---------------------------------------------------------------------------

const SOLO_V: FracSlot[] = [{ id: "host", x: 0, y: 0, w: 1, h: 1, z: 1, source: A }];
const STACK_2: FracSlot[] = [
  { id: "host", x: 0, y: 0, w: 1, h: 0.5, z: 1, source: A },
  { id: "guest", x: 0, y: 0.5, w: 1, h: 0.5, z: 1, source: A },
];
const STACK_3: FracSlot[] = [
  { id: "host", x: 0, y: 0, w: 1, h: 0.34, z: 1, source: A },
  { id: "guest1", x: 0, y: 0.34, w: 1, h: 0.33, z: 1, source: A },
  { id: "guest2", x: 0, y: 0.67, w: 1, h: 0.33, z: 1, source: A },
];
const SCREEN_FACECAM: FracSlot[] = [
  { id: "screen", x: 0, y: 0, w: 1, h: 0.65, z: 1, source: S },
  { id: "facecam", x: 0.6, y: 0.65, w: 0.4, h: 0.35, z: 2, source: A },
];

export const PORTRAIT_PRESETS: ProgramPreset[] = [
  { id: "solo_vertical", label: "Solo Vertical", slots: SOLO_V },
  { id: "stack_2", label: "2-Stack", slots: STACK_2 },
  { id: "stack_3", label: "3-Stack", slots: STACK_3 },
  { id: "screenshare_facecam", label: "Screen Share + Face Cam", slots: SCREEN_FACECAM },
  // Ids carried over from lib/verticalLayouts.ts VERTICAL_PRESETS.
  { id: "vertical_solo", label: "Solo Vertical", slots: SOLO_V },
  { id: "vertical_host_guest_stack", label: "Host + Guest Stack", slots: STACK_2 },
  { id: "vertical_3up_panel", label: "3-Up Vertical Panel", slots: STACK_3 },
  {
    id: "vertical_featured_2small",
    label: "Featured Speaker + 2 Small Guests",
    slots: [
      { id: "featured", x: 0, y: 0, w: 1, h: 0.6, z: 1, source: A },
      { id: "guest1", x: 0, y: 0.6, w: 0.5, h: 0.4, z: 1, source: A },
      { id: "guest2", x: 0.5, y: 0.6, w: 0.5, h: 0.4, z: 1, source: A },
    ],
  },
  { id: "vertical_screenshare_facecam", label: "Screen Share + Face Cam Vertical", slots: SCREEN_FACECAM },
  {
    id: "vertical_interview",
    label: "Interview Layout Vertical",
    slots: [
      { id: "interviewer", x: 0.05, y: 0.02, w: 0.9, h: 0.47, z: 1, source: A },
      { id: "interviewee", x: 0.05, y: 0.51, w: 0.9, h: 0.47, z: 1, source: A },
    ],
  },
];

/** Layouts renderers switch to while a screen share is active and the
 *  current layout has no screen slot (screenShareMode === "auto"). */
export const SCREEN_OVERRIDE: Record<Orientation, string> = {
  landscape: "screen_focus",
  portrait: "screenshare_facecam",
};

export const MAX_SLOTS = 9;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneSource(s: SlotSource): SlotSource {
  if (s.kind === "participant") return { kind: "participant", identity: s.identity, track: s.track };
  return { kind: s.kind };
}

export function cloneSlot(s: FracSlot): FracSlot {
  const out: FracSlot = { id: s.id, x: s.x, y: s.y, w: s.w, h: s.h, source: cloneSource(s.source) };
  if (s.z !== undefined) out.z = s.z;
  if (s.fit !== undefined) out.fit = s.fit;
  if (s.label !== undefined) out.label = s.label;
  return out;
}

export function getPresets(orientation: Orientation): ProgramPreset[] {
  return orientation === "portrait" ? PORTRAIT_PRESETS : LANDSCAPE_PRESETS;
}

export function findPreset(presetId: string, orientation: Orientation): ProgramPreset | null {
  const list = getPresets(orientation);
  for (const p of list) if (p.id === presetId) return p;
  return null;
}

/** Deep copy of a preset's slots as an OrientationLayout.  Unknown ids yield
 *  an empty slot list (renderers then show the automatic grid). */
export function buildOrientationLayout(presetId: string, orientation: Orientation): OrientationLayout {
  const p = findPreset(presetId, orientation);
  return { presetId, slots: p ? p.slots.map(cloneSlot) : [] };
}

export function suggestPreset(count: number, orientation: Orientation): string {
  const n = Math.max(0, Math.floor(count || 0));
  if (orientation === "portrait") {
    if (n <= 1) return "solo_vertical";
    if (n === 2) return "stack_2";
    return "stack_3";
  }
  if (n <= 1) return "solo";
  if (n === 2) return "side_by_side";
  if (n === 3) return "three_grid";
  if (n === 4) return "grid_2x2";
  return "grid_3x3";
}

const PORTRAIT_FOR: Record<string, string> = {
  solo: "solo_vertical",
  side_by_side: "stack_2",
  two_up_split: "stack_2",
  host_large_guest_small: "stack_2",
  floating_host: "stack_2",
  floating_guest: "stack_2",
  grid_2x2: "stack_3",
  grid_3x3: "stack_3",
  three_grid: "stack_3",
  four_grid: "stack_3",
  speaker_focus: "vertical_featured_2small",
  screen_focus: "screenshare_facecam",
  screen_side: "screenshare_facecam",
  screen_pip: "screenshare_facecam",
  screen_share_speaker: "screenshare_facecam",
};

/** Portrait preset that best matches a landscape preset (default "stack_2"). */
export function portraitFor(landscapePresetId: string | null | undefined): string {
  const id = String(landscapePresetId || "");
  return Object.prototype.hasOwnProperty.call(PORTRAIT_FOR, id) ? PORTRAIT_FOR[id] : "stack_2";
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Automatic grid used when a layout resolves to nothing. */
export function autoGridSlots(count: number, orientation: Orientation): FracSlot[] {
  const n = Math.max(0, Math.min(MAX_SLOTS, Math.floor(count || 0)));
  if (n === 0) return [];
  let cols: number;
  if (orientation === "portrait") cols = n <= 3 ? 1 : n <= 8 ? 2 : 3;
  else cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const w = 1 / cols;
  const h = 1 / rows;
  const slots: FracSlot[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = row === rows - 1 ? n - cols * (rows - 1) : cols;
    const offset = ((cols - inRow) * w) / 2;
    slots.push({
      id: `grid${i + 1}`,
      x: round4(offset + col * w),
      y: round4(row * h),
      w: round4(w),
      h: round4(h),
      z: 1,
      source: { kind: "auto" },
    });
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Resolution (identical algorithm in the egress compositor and in-room stage)
// ---------------------------------------------------------------------------

export type ResolverParticipant = {
  identity: string;
  name?: string | null;
  /** Raw participant metadata JSON (presenceMode / hidden flags). */
  metadata?: string | null;
  isAgent?: boolean;
  /** permissions.canPublish; undefined = unknown. */
  canPublish?: boolean;
  joinedAt?: number | null;
  /** Present when the participant has a published camera track. */
  camera?: { publishedAt?: number | null } | null;
  /** Present when the participant has a published screen-share track. */
  screen?: { publishedAt?: number | null } | null;
};

export type ResolvedSlot = {
  slot: FracSlot;
  identity: string | null;
  track: "camera" | "screen" | null;
  fit: "cover" | "contain";
  label: string | null;
};

export type ResolvedLayout = {
  presetId: string;
  /** True when SCREEN_OVERRIDE replaced the stored layout. */
  overridden: boolean;
  /** True when nothing resolved and the automatic grid is shown. */
  autoGrid: boolean;
  slots: ResolvedSlot[];
};

export function isHiddenParticipant(p: ResolverParticipant): boolean {
  if (p.identity.indexOf("invisible_") === 0) return true;
  if (p.metadata) {
    try {
      const m = JSON.parse(p.metadata);
      if (m && typeof m === "object" && (m.presenceMode === "invisible" || m.hidden === true)) return true;
    } catch {
      /* ignore malformed metadata */
    }
  }
  return false;
}

export function isEligibleParticipant(p: ResolverParticipant): boolean {
  if (!p || !p.identity) return false;
  if (p.isAgent || p.identity.indexOf("EG_") === 0) return false;
  if (isHiddenParticipant(p)) return false;
  if (p.canPublish === false) return false;
  return !!p.camera || !!p.screen || p.canPublish === true;
}

export function orderParticipants(list: ResolverParticipant[], hostIdentity: string | null): ResolverParticipant[] {
  const rank = (p: ResolverParticipant) =>
    hostIdentity && p.identity === hostIdentity ? 0 : p.identity.indexOf("producer:") === 0 ? 1 : 2;
  return list.slice().sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const ja = typeof a.joinedAt === "number" ? a.joinedAt : Number.MAX_SAFE_INTEGER;
    const jb = typeof b.joinedAt === "number" ? b.joinedAt : Number.MAX_SAFE_INTEGER;
    if (ja !== jb) return ja - jb;
    return a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0;
  });
}

function layoutHasScreenSlot(slots: FracSlot[]): boolean {
  for (const s of slots) {
    if (s.source.kind === "auto-screen") return true;
    if (s.source.kind === "participant" && s.source.track === "screen") return true;
  }
  return false;
}

export function resolveProgramLayout(input: {
  layout: OrientationLayout | null | undefined;
  orientation: Orientation;
  screenShareMode: "auto" | "manual";
  hostIdentity: string | null;
  participants: ResolverParticipant[];
}): ResolvedLayout {
  const eligible = orderParticipants(input.participants.filter(isEligibleParticipant), input.hostIdentity);
  const byId: Record<string, ResolverParticipant> = {};
  for (const p of eligible) byId[p.identity] = p;

  const screens = eligible
    .map((p, idx) => ({ p, idx }))
    .filter((e) => !!e.p.screen)
    .sort((a, b) => {
      const ta = typeof a.p.screen!.publishedAt === "number" ? a.p.screen!.publishedAt! : Number.MAX_SAFE_INTEGER;
      const tb = typeof b.p.screen!.publishedAt === "number" ? b.p.screen!.publishedAt! : Number.MAX_SAFE_INTEGER;
      return ta !== tb ? ta - tb : a.idx - b.idx;
    })
    .map((e) => e.p.identity);

  let presetId = input.layout ? input.layout.presetId : "";
  let slots: FracSlot[] = input.layout && Array.isArray(input.layout.slots) ? input.layout.slots : [];
  let overridden = false;
  if (input.screenShareMode === "auto" && screens.length > 0 && !layoutHasScreenSlot(slots)) {
    const o = buildOrientationLayout(SCREEN_OVERRIDE[input.orientation], input.orientation);
    presetId = o.presetId;
    slots = o.slots;
    overridden = true;
  }

  const assigned: Array<{ identity: string | null; track: "camera" | "screen" | null }> = slots.map(() => ({
    identity: null,
    track: null,
  }));
  const camShown: Record<string, boolean> = {};
  const screenUsed: Record<string, boolean> = {};

  // 1. Explicit participant slots.
  slots.forEach((s, i) => {
    if (s.source.kind !== "participant") return;
    const p = byId[s.source.identity];
    if (!p) return;
    assigned[i] = { identity: p.identity, track: s.source.track };
    if (s.source.track === "camera") camShown[p.identity] = true;
    else screenUsed[p.identity] = true;
  });
  // 2. auto-screen slots take screen shares in publish order.
  const screenQueue = screens.filter((id) => !screenUsed[id]);
  slots.forEach((s, i) => {
    if (s.source.kind !== "auto-screen") return;
    const id = screenQueue.shift();
    if (id) assigned[i] = { identity: id, track: "screen" };
  });
  // 3. auto slots take remaining eligible cameras in order.
  const camQueue = eligible.map((p) => p.identity).filter((id) => !camShown[id]);
  slots.forEach((s, i) => {
    if (s.source.kind !== "auto") return;
    const id = camQueue.shift();
    if (id) assigned[i] = { identity: id, track: "camera" };
  });

  const toResolved = (s: FracSlot, a: { identity: string | null; track: "camera" | "screen" | null }): ResolvedSlot => {
    const p = a.identity ? byId[a.identity] : null;
    return {
      slot: s,
      identity: a.identity,
      track: a.track,
      fit: s.fit || (a.track === "screen" || (!a.track && s.source.kind === "auto-screen") ? "contain" : "cover"),
      label: p && s.label !== false ? String(p.name || p.identity) : null,
    };
  };

  if (assigned.some((a) => !!a.identity)) {
    return { presetId, overridden, autoGrid: false, slots: slots.map((s, i) => toResolved(s, assigned[i])) };
  }

  const grid = autoGridSlots(eligible.length, input.orientation);
  return {
    presetId,
    overridden,
    autoGrid: true,
    slots: grid.map((s, i) => toResolved(s, { identity: eligible[i].identity, track: "camera" })),
  };
}
