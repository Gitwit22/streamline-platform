/**
 * Program State – the single source of truth for what the composed output
 * (RTMP / HLS / recording / Instagram) and the in-room stage render.
 *
 * v2 (current): fractional slots per orientation with explicit slot sources
 * (see lib/programPresets.ts).  Stored at rooms/{id}.programState and mirrored
 * into LiveKit room metadata under `programState`.
 *
 * Legacy v1 fields (programLayout, programSlots in 1280×720 px,
 * programParticipants, …) are still accepted on input and still written on
 * output so older clients keep working.
 */

import {
  type StudioLayoutPresetId,
  type LayoutSlot,
  normalizeLayoutSlot,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from "./studioLayout";
import {
  type FracSlot,
  type OrientationLayout,
  type SlotSource,
  MAX_SLOTS,
  buildOrientationLayout,
  findPreset,
  portraitFor,
  suggestPreset,
} from "./programPresets";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type ProgramMode =
  | "standard"
  | "interview"
  | "screen-share"
  | "stacked"
  | "grid";

export type ProgramAspect = "landscape" | "portrait-instagram";

export type ScreenShareMode = "auto" | "manual";

/** Legacy (v1) shape – still accepted on input. */
export type ProgramState = {
  programLayout: StudioLayoutPresetId | "custom" | string | null;
  programSlots: LayoutSlot[];
  programParticipants: string[];
  programMode: ProgramMode;
  programAspect: ProgramAspect;
  screenShareIdentity: string | null;
  featuredParticipantIds: string[];
  updatedAt: string | number | null;
};

export type ProgramStateV2 = {
  version: 2;
  landscape: OrientationLayout;
  portrait: OrientationLayout;
  screenShareMode: ScreenShareMode;
  hostIdentity: string | null;
  updatedAt: number;
  // Legacy mirror (back-compat for older clients / compositors).
  programLayout: string | null;
  programSlots: LayoutSlot[];
  programParticipants: string[];
  programMode: ProgramMode;
  programAspect: ProgramAspect;
  screenShareIdentity: string | null;
  featuredParticipantIds: string[];
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_PROGRAM_STATE: ProgramState = {
  programLayout: null,
  programSlots: [],
  programParticipants: [],
  programMode: "standard",
  programAspect: "landscape",
  screenShareIdentity: null,
  featuredParticipantIds: [],
  updatedAt: null,
};

export const MAX_IDENTITY_LENGTH = 128;
export const MAX_PRESET_ID_LENGTH = 64;
export const MAX_SLOT_ID_LENGTH = 64;

// ---------------------------------------------------------------------------
// Legacy (v1) normalisation
// ---------------------------------------------------------------------------

const VALID_MODES: ProgramMode[] = ["standard", "interview", "screen-share", "stacked", "grid"];
const VALID_ASPECTS: ProgramAspect[] = ["landscape", "portrait-instagram"];

function pickString(v: unknown): string | null {
  return typeof v === "string" ? v.trim() : null;
}

function pickStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => (typeof item === "string" ? item.trim().slice(0, MAX_IDENTITY_LENGTH) : ""))
    .filter(Boolean);
}

/** Validates the legacy (v1) PATCH shape.  Returns null when nothing usable. */
export function normalizeProgramState(input: unknown): Partial<ProgramState> | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;

  const patch: Partial<ProgramState> = {};
  let hasField = false;

  if ("programLayout" in o) {
    const v = pickString(o.programLayout);
    patch.programLayout = v ? v.slice(0, MAX_PRESET_ID_LENGTH) : null;
    hasField = true;
  }

  if ("programSlots" in o && Array.isArray(o.programSlots)) {
    const slots: LayoutSlot[] = [];
    for (const raw of o.programSlots as unknown[]) {
      const s = normalizeLayoutSlot(raw);
      if (s) slots.push(s);
      if (slots.length >= MAX_SLOTS) break;
    }
    patch.programSlots = slots;
    hasField = true;
  }

  if ("programParticipants" in o) {
    patch.programParticipants = pickStringArray(o.programParticipants);
    hasField = true;
  }

  if ("programMode" in o) {
    const v = pickString(o.programMode) as ProgramMode;
    if (VALID_MODES.includes(v)) {
      patch.programMode = v;
      hasField = true;
    }
  }

  if ("programAspect" in o) {
    const v = pickString(o.programAspect) as ProgramAspect;
    if (VALID_ASPECTS.includes(v)) {
      patch.programAspect = v;
      hasField = true;
    }
  }

  if ("screenShareIdentity" in o) {
    const v = pickString(o.screenShareIdentity);
    patch.screenShareIdentity = v ? v.slice(0, MAX_IDENTITY_LENGTH) : null;
    hasField = true;
  }

  if ("featuredParticipantIds" in o) {
    patch.featuredParticipantIds = pickStringArray(o.featuredParticipantIds);
    hasField = true;
  }

  return hasField ? patch : null;
}

// ---------------------------------------------------------------------------
// v2 validation
// ---------------------------------------------------------------------------

export type ValidationResult<T> =
  | { ok: true; value: T; error?: undefined }
  | { ok: false; error: string; value?: undefined };

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function finite(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function normalizeSlotSource(input: unknown): SlotSource | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (o.kind === "auto") return { kind: "auto" };
  if (o.kind === "auto-screen") return { kind: "auto-screen" };
  if (o.kind === "participant") {
    const identity = typeof o.identity === "string" ? o.identity.trim() : "";
    if (!identity || identity.length > MAX_IDENTITY_LENGTH) return null;
    if (o.track !== "camera" && o.track !== "screen") return null;
    return { kind: "participant", identity, track: o.track };
  }
  return null;
}

export function normalizeFracSlot(input: unknown): ValidationResult<FracSlot> {
  if (!input || typeof input !== "object") return { ok: false, error: "invalid_slot" };
  const o = input as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id || id.length > MAX_SLOT_ID_LENGTH) return { ok: false, error: "invalid_slot_id" };

  const xr = finite(o.x);
  const yr = finite(o.y);
  const wr = finite(o.w);
  const hr = finite(o.h);
  if (xr === undefined || yr === undefined || wr === undefined || hr === undefined) {
    return { ok: false, error: "invalid_slot_geometry" };
  }
  const x = clamp01(xr);
  const y = clamp01(yr);
  const w = Math.min(clamp01(wr), 1 - x);
  const h = Math.min(clamp01(hr), 1 - y);
  if (!(w > 0) || !(h > 0)) return { ok: false, error: "invalid_slot_geometry" };

  // Missing source defaults to auto; a present-but-invalid source is rejected.
  let source: SlotSource = { kind: "auto" };
  if (o.source !== undefined) {
    const s = normalizeSlotSource(o.source);
    if (!s) return { ok: false, error: "invalid_slot_source" };
    source = s;
  }

  const slot: FracSlot = { id, x, y, w, h, source };
  const z = finite(o.z);
  if (z !== undefined) slot.z = Math.max(0, Math.min(100, Math.round(z)));
  if (o.fit === "cover" || o.fit === "contain") slot.fit = o.fit;
  if (typeof o.label === "boolean") slot.label = o.label;
  return { ok: true, value: slot };
}

export function normalizeOrientationLayout(input: unknown): ValidationResult<OrientationLayout> {
  if (!input || typeof input !== "object") return { ok: false, error: "invalid_layout" };
  const o = input as Record<string, unknown>;
  const presetId = typeof o.presetId === "string" ? o.presetId.trim() : "";
  if (!presetId || presetId.length > MAX_PRESET_ID_LENGTH) return { ok: false, error: "invalid_preset_id" };
  if (o.slots === undefined) return { ok: false, error: "invalid_slots" };
  if (!Array.isArray(o.slots)) return { ok: false, error: "invalid_slots" };
  if (o.slots.length > MAX_SLOTS) return { ok: false, error: "too_many_slots" };
  const slots: FracSlot[] = [];
  const seen = new Set<string>();
  for (const raw of o.slots) {
    const r = normalizeFracSlot(raw);
    if (!r.ok) return { ok: false, error: r.error };
    if (seen.has(r.value.id)) return { ok: false, error: "duplicate_slot_id" };
    seen.add(r.value.id);
    slots.push(r.value);
  }
  return { ok: true, value: { presetId, slots } };
}

export function isV2Body(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const o = input as Record<string, unknown>;
  return o.version === 2 || "landscape" in o || "portrait" in o || "screenShareMode" in o;
}

export type ProgramStateV2Patch = {
  landscape?: OrientationLayout;
  portrait?: OrientationLayout;
  screenShareMode?: ScreenShareMode;
};

/** Validates a v2 PATCH body.  At least one of landscape/portrait/screenShareMode. */
export function normalizeProgramStateV2Patch(input: unknown): ValidationResult<ProgramStateV2Patch> {
  if (!input || typeof input !== "object") return { ok: false, error: "invalid_program_state" };
  const o = input as Record<string, unknown>;
  const patch: ProgramStateV2Patch = {};
  if (o.landscape !== undefined) {
    const r = normalizeOrientationLayout(o.landscape);
    if (!r.ok) return { ok: false, error: `landscape:${r.error}` };
    patch.landscape = r.value;
  }
  if (o.portrait !== undefined) {
    const r = normalizeOrientationLayout(o.portrait);
    if (!r.ok) return { ok: false, error: `portrait:${r.error}` };
    patch.portrait = r.value;
  }
  if (o.screenShareMode !== undefined) {
    if (o.screenShareMode !== "auto" && o.screenShareMode !== "manual") {
      return { ok: false, error: "invalid_screen_share_mode" };
    }
    patch.screenShareMode = o.screenShareMode;
  }
  if (!patch.landscape && !patch.portrait && !patch.screenShareMode) {
    return { ok: false, error: "invalid_program_state" };
  }
  return { ok: true, value: patch };
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

function r4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Legacy px slot (1280×720 reference) → fractional auto slot. */
export function pxSlotToFrac(s: LayoutSlot): FracSlot | null {
  const r = normalizeFracSlot({
    id: s.id,
    x: r4(s.x / CANVAS_WIDTH),
    y: r4(s.y / CANVAS_HEIGHT),
    w: r4(s.width / CANVAS_WIDTH),
    h: r4(s.height / CANVAS_HEIGHT),
    z: s.zIndex,
    source: { kind: "auto" },
  });
  return r.ok ? r.value : null;
}

/** Fractional slot → legacy px slot on the 1280×720 reference canvas. */
export function fracSlotToPx(s: FracSlot): LayoutSlot {
  return {
    id: s.id,
    x: Math.round(s.x * CANVAS_WIDTH),
    y: Math.round(s.y * CANVAS_HEIGHT),
    width: Math.round(s.w * CANVAS_WIDTH),
    height: Math.round(s.h * CANVAS_HEIGHT),
    zIndex: s.z ?? 1,
  };
}

/** Landscape layout derived from legacy v1 fields. */
export function landscapeFromLegacy(v1: Partial<ProgramState>): OrientationLayout {
  const presetId = typeof v1.programLayout === "string" && v1.programLayout ? v1.programLayout : null;
  if (presetId && presetId !== "custom" && findPreset(presetId, "landscape")) {
    return buildOrientationLayout(presetId, "landscape");
  }
  const slots: FracSlot[] = [];
  for (const s of v1.programSlots || []) {
    const f = pxSlotToFrac(s);
    if (f) slots.push(f);
    if (slots.length >= MAX_SLOTS) break;
  }
  if (slots.length > 0) return { presetId: presetId || "custom", slots };
  // Nothing usable: empty layout → renderers show the automatic grid.
  return { presetId: presetId || "auto", slots: [] };
}

function legacyMirror(landscape: OrientationLayout, prev: Partial<ProgramState>): Omit<ProgramState, "updatedAt"> {
  const explicit = landscape.slots
    .map((s) => (s.source.kind === "participant" ? s.source.identity : null))
    .filter((v): v is string => !!v);
  return {
    programLayout: landscape.presetId,
    programSlots: landscape.slots.map(fracSlotToPx),
    programParticipants: explicit.length > 0 ? explicit : prev.programParticipants || [],
    programMode: (prev.programMode as ProgramMode) || "standard",
    programAspect: (prev.programAspect as ProgramAspect) || "landscape",
    screenShareIdentity: prev.screenShareIdentity ?? null,
    featuredParticipantIds: prev.featuredParticipantIds || [],
  };
}

function toMillis(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

/**
 * Upgrade whatever is stored (v1, v2, partial, null) into a complete v2 state.
 * Stored v2 layouts are re-validated; invalid ones fall back to legacy fields.
 */
export function upgradeProgramState(stored: unknown, hostIdentity: string | null): ProgramStateV2 {
  const o = (stored && typeof stored === "object" ? stored : {}) as Record<string, any>;
  const legacy: Partial<ProgramState> = { ...DEFAULT_PROGRAM_STATE, ...(normalizeProgramState(o) || {}) };

  let landscape: OrientationLayout | null = null;
  if (o.landscape !== undefined) {
    const r = normalizeOrientationLayout(o.landscape);
    if (r.ok) landscape = r.value;
  }
  if (!landscape) landscape = landscapeFromLegacy(legacy);

  let portrait: OrientationLayout | null = null;
  if (o.portrait !== undefined) {
    const r = normalizeOrientationLayout(o.portrait);
    if (r.ok) portrait = r.value;
  }
  if (!portrait) {
    const pid =
      landscape.slots.length === 0 && (landscape.presetId === "auto" || landscape.presetId === "custom")
        ? suggestPreset(2, "portrait")
        : portraitFor(landscape.presetId);
    portrait = buildOrientationLayout(pid, "portrait");
  }

  const screenShareMode: ScreenShareMode = o.screenShareMode === "manual" ? "manual" : "auto";
  return {
    version: 2,
    landscape,
    portrait,
    screenShareMode,
    hostIdentity: hostIdentity ?? (typeof o.hostIdentity === "string" ? o.hostIdentity : null),
    updatedAt: toMillis(o.updatedAt),
    ...legacyMirror(landscape, legacy),
  };
}

/**
 * Apply a PATCH body (v2 or legacy v1) on top of the stored state.
 * Returns the full v2 state to persist, or a validation error.
 */
export function applyProgramStatePatch(
  stored: unknown,
  body: unknown,
  hostIdentity: string | null,
  now: number,
): ValidationResult<ProgramStateV2> {
  const current = upgradeProgramState(stored, hostIdentity);

  if (isV2Body(body)) {
    const r = normalizeProgramStateV2Patch(body);
    if (!r.ok) return { ok: false, error: r.error };
    const p = r.value;
    const landscape = p.landscape || current.landscape;
    const portrait = p.portrait
      ? p.portrait
      : p.landscape
        ? buildOrientationLayout(portraitFor(p.landscape.presetId), "portrait")
        : current.portrait;
    return {
      ok: true,
      value: {
        ...current,
        landscape,
        portrait,
        screenShareMode: p.screenShareMode || current.screenShareMode,
        hostIdentity,
        updatedAt: now,
        ...legacyMirror(landscape, current),
      },
    };
  }

  const legacyPatch = normalizeProgramState(body);
  if (!legacyPatch) return { ok: false, error: "invalid_program_state" };
  const mergedLegacy: Partial<ProgramState> = { ...current, ...legacyPatch };
  // Changing the preset id without slots: rebuild from the preset.
  if ("programLayout" in legacyPatch && !("programSlots" in legacyPatch)) {
    mergedLegacy.programSlots = [];
  }
  const touchesLayout = "programLayout" in legacyPatch || "programSlots" in legacyPatch;
  const landscape = touchesLayout ? landscapeFromLegacy(mergedLegacy) : current.landscape;
  const portrait = touchesLayout
    ? buildOrientationLayout(portraitFor(landscape.presetId), "portrait")
    : current.portrait;
  const mirror = legacyMirror(landscape, mergedLegacy);
  return {
    ok: true,
    value: {
      ...current,
      landscape,
      portrait,
      hostIdentity,
      updatedAt: now,
      ...mirror,
      // A legacy body's explicit participant list wins over the derived one.
      programParticipants: legacyPatch.programParticipants ?? mirror.programParticipants,
    },
  };
}
