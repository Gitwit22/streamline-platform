/**
 * Program layout helpers for the client (programState v2).
 *
 * The presets AND the resolution algorithm live in ./programPresets.ts, a
 * byte-for-byte copy of streamline-server/lib/programPresets.ts (the server
 * test lib/programPresetsShared.test.ts fails when they differ).  The egress
 * compositor runs a JS build of that same file, so the in-room stage and the
 * composed output resolve identically.  This module only adds client-side
 * types, picker helpers and adapters around the shared code.
 *
 * Do NOT reimplement resolution or geometry here.
 */

import {
  LANDSCAPE_PRESETS,
  PORTRAIT_PRESETS,
  autoGridSlots,
  buildOrientationLayout as buildShared,
  findPreset,
  isEligibleParticipant,
  orderParticipants,
  portraitFor,
  resolveProgramLayout,
  type FracSlot,
  type Orientation,
  type OrientationLayout,
  type ProgramPreset,
  type ResolverParticipant,
} from "./programPresets";

export { autoGridSlots, orderParticipants, isEligibleParticipant };
export type { ResolverParticipant };

// ---------------------------------------------------------------------------
// programState v2 contract (client view)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Preset lookup / picker helpers
// ---------------------------------------------------------------------------

/**
 * Legacy verticalLayouts.ts ids that the shared PORTRAIT_PRESETS keeps as
 * duplicates of canonical portrait presets (same slots).  The picker hides
 * them; stored states using them still resolve and render normally.
 */
export const PORTRAIT_ALIASES: Record<string, string> = {
  vertical_solo: "solo_vertical",
  vertical_host_guest_stack: "stack_2",
  vertical_3up_panel: "stack_3",
  vertical_screenshare_facecam: "screenshare_facecam",
};

/** Every preset (aliases included) for an orientation. */
export function presetsFor(orientation: Orientation): ProgramPreset[] {
  return orientation === "portrait" ? PORTRAIT_PRESETS : LANDSCAPE_PRESETS;
}

/** Presets offered in the layout picker (portrait aliases hidden). */
export function pickerPresets(orientation: Orientation): ProgramPreset[] {
  return presetsFor(orientation).filter((p) => orientation !== "portrait" || !PORTRAIT_ALIASES[p.id]);
}

/** Canonical id for a (possibly aliased) preset id. */
export function canonicalPresetId(presetId: string | null | undefined, orientation: Orientation): string | null {
  if (!presetId) return null;
  return orientation === "portrait" ? PORTRAIT_ALIASES[presetId] ?? presetId : presetId;
}

export function getPreset(presetId: string, orientation: Orientation): ProgramPreset | null {
  return findPreset(presetId, orientation);
}

/** Shared buildOrientationLayout, but null for an unknown id. */
export function buildLayout(presetId: string, orientation: Orientation): OrientationLayout | null {
  return findPreset(presetId, orientation) ? buildShared(presetId, orientation) : null;
}

export function slotIsScreen(s: FracSlot): boolean {
  return s.source?.kind === "auto-screen" || (s.source?.kind === "participant" && s.source.track === "screen");
}

/** True when a layout has a slot that can show a screen share. */
export function layoutHasScreenSlot(layout: OrientationLayout | null | undefined): boolean {
  if (!layout || !Array.isArray(layout.slots)) return false;
  return layout.slots.some(slotIsScreen);
}

export function presetHasScreenSlot(p: ProgramPreset): boolean {
  return p.slots.some(slotIsScreen);
}

// ---------------------------------------------------------------------------
// Resolution (delegates to the shared resolveProgramLayout)
// ---------------------------------------------------------------------------

export type ResolvedSlot = {
  slot: FracSlot;
  identity: string | null;
  track: "camera" | "screen" | null;
  fit: "cover" | "contain";
  /** Name label to show, or null (empty slot / label === false). */
  label: string | null;
};

export type ProgramResolution = {
  orientation: Orientation;
  /** Preset actually rendered ("auto_grid" for the fallback grid). */
  presetId: string;
  slots: ResolvedSlot[];
  /** True when the screen-share override replaced the chosen layout. */
  screenOverride: boolean;
  /** True when nothing resolved and the automatic grid is shown. */
  fallbackGrid: boolean;
  /** Eligible identities in program order. */
  eligible: string[];
  /** Identities with a screen share, in publish order. */
  screens: string[];
};

export type ResolveInput = {
  state: Pick<ProgramStateV2, "landscape" | "portrait" | "screenShareMode" | "hostIdentity"> | null;
  participants: ResolverParticipant[];
  orientation: Orientation;
};

function validLayout(l: unknown): l is OrientationLayout {
  return !!l && typeof l === "object" && Array.isArray((l as OrientationLayout).slots);
}

export function resolveProgram({ state, participants, orientation }: ResolveInput): ProgramResolution {
  const hostIdentity = state?.hostIdentity ?? null;
  const screenShareMode: ScreenShareMode = state?.screenShareMode === "manual" ? "manual" : "auto";
  const chosen = state ? state[orientation] : null;
  const r = resolveProgramLayout({
    layout: validLayout(chosen) ? chosen : null,
    orientation,
    screenShareMode,
    hostIdentity,
    participants,
  });

  // Informational lists (same ordering rules as the shared resolver).
  const eligibleList = orderParticipants(participants.filter(isEligibleParticipant), hostIdentity);
  const screens = eligibleList
    .map((p, idx) => ({ p, idx }))
    .filter((e) => !!e.p.screen)
    .sort((a, b) => {
      const ta = typeof a.p.screen?.publishedAt === "number" ? a.p.screen.publishedAt : Number.MAX_SAFE_INTEGER;
      const tb = typeof b.p.screen?.publishedAt === "number" ? b.p.screen.publishedAt : Number.MAX_SAFE_INTEGER;
      return ta !== tb ? ta - tb : a.idx - b.idx;
    })
    .map((e) => e.p.identity);

  return {
    orientation,
    presetId: r.autoGrid ? "auto_grid" : r.presetId,
    slots: r.slots,
    screenOverride: r.overridden,
    fallbackGrid: r.autoGrid,
    eligible: eligibleList.map((p) => p.identity),
    screens,
  };
}

// ---------------------------------------------------------------------------
// programState parsing
// ---------------------------------------------------------------------------

/**
 * Normalizes a programState from room metadata or the API into v2.
 * Legacy v1 states (programLayout only) are converted when the layout id is a
 * known landscape preset. Returns null when there is nothing usable.
 */
export function normalizeProgramState(raw: unknown): ProgramStateV2 | null {
  if (!raw || typeof raw !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untrusted JSON, validated field by field
  const r = raw as Record<string, any>;
  const updatedAt =
    typeof r.updatedAt === "number" ? r.updatedAt : typeof r.updatedAt === "string" ? Date.parse(r.updatedAt) || 0 : 0;
  const hostIdentity = typeof r.hostIdentity === "string" && r.hostIdentity ? r.hostIdentity : null;
  const screenShareMode: ScreenShareMode = r.screenShareMode === "manual" ? "manual" : "auto";
  if (r.version === 2 && validLayout(r.landscape)) {
    const portrait = validLayout(r.portrait)
      ? (r.portrait as OrientationLayout)
      : buildLayout(portraitFor(r.landscape.presetId), "portrait");
    if (!portrait) return null;
    return { ...(r as ProgramStateV2), landscape: r.landscape, portrait, screenShareMode, hostIdentity, updatedAt };
  }
  const legacyId = typeof r.programLayout === "string" ? r.programLayout : null;
  if (legacyId && findPreset(legacyId, "landscape")) {
    const landscape = buildLayout(legacyId, "landscape");
    const portrait = buildLayout(portraitFor(legacyId), "portrait");
    if (!landscape || !portrait) return null;
    return { version: 2, landscape, portrait, screenShareMode, hostIdentity, updatedAt };
  }
  return null;
}

/** Extracts programState from LiveKit room metadata (JSON string). */
export function programStateFromRoomMetadata(metadata: string | null | undefined): ProgramStateV2 | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    return normalizeProgramState(parsed?.programState ?? null);
  } catch {
    return null;
  }
}
