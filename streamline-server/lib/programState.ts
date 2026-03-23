/**
 * Program State – the single source of truth for what the composed output
 * (RTMP / HLS / recording) should render.
 *
 * Both the host preview and the egress compositor read from this state.
 * The host control UI *writes* to it; nothing else does.
 */

import {
  type StudioLayoutPresetId,
  type LayoutSlot,
  normalizeLayoutSlot,
} from "./studioLayout";

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

export type ProgramState = {
  /** Which studio layout preset is active on the program output. */
  programLayout: StudioLayoutPresetId | "custom" | null;
  /** Concrete slot positions for the program output canvas. */
  programSlots: LayoutSlot[];
  /** Ordered list of participant identities mapped to slots. */
  programParticipants: string[];
  /** High-level scene mode. */
  programMode: ProgramMode;
  /** Output aspect ratio / orientation. */
  programAspect: ProgramAspect;
  /** If screen-share is the primary content, which participant identity owns it. */
  screenShareIdentity: string | null;
  /** Participant identities that should be "featured" (e.g. pinned / enlarged). */
  featuredParticipantIds: string[];
  /** ISO timestamp of the last update (set server-side). */
  updatedAt: string | null;
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

// ---------------------------------------------------------------------------
// Normalisation (server-side validation of untrusted input)
// ---------------------------------------------------------------------------

const VALID_MODES: ProgramMode[] = [
  "standard",
  "interview",
  "screen-share",
  "stacked",
  "grid",
];

const VALID_ASPECTS: ProgramAspect[] = ["landscape", "portrait-instagram"];

function pickString(v: unknown): string | null {
  return typeof v === "string" ? v.trim() : null;
}

function pickStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

export function normalizeProgramState(
  input: unknown,
): Partial<ProgramState> | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;

  const patch: Partial<ProgramState> = {};
  let hasField = false;

  // programLayout
  if ("programLayout" in o) {
    const v = pickString(o.programLayout);
    patch.programLayout = v as ProgramState["programLayout"];
    hasField = true;
  }

  // programSlots – delegate to studioLayout normaliser
  if ("programSlots" in o && Array.isArray(o.programSlots)) {
    const slots: LayoutSlot[] = [];
    for (const raw of o.programSlots as unknown[]) {
      const s = normalizeLayoutSlot(raw);
      if (s) slots.push(s);
    }
    patch.programSlots = slots;
    hasField = true;
  }

  // programParticipants
  if ("programParticipants" in o) {
    patch.programParticipants = pickStringArray(o.programParticipants);
    hasField = true;
  }

  // programMode
  if ("programMode" in o) {
    const v = pickString(o.programMode) as ProgramMode;
    if (VALID_MODES.includes(v)) {
      patch.programMode = v;
      hasField = true;
    }
  }

  // programAspect
  if ("programAspect" in o) {
    const v = pickString(o.programAspect) as ProgramAspect;
    if (VALID_ASPECTS.includes(v)) {
      patch.programAspect = v;
      hasField = true;
    }
  }

  // screenShareIdentity
  if ("screenShareIdentity" in o) {
    patch.screenShareIdentity = pickString(o.screenShareIdentity);
    hasField = true;
  }

  // featuredParticipantIds
  if ("featuredParticipantIds" in o) {
    patch.featuredParticipantIds = pickStringArray(
      o.featuredParticipantIds,
    );
    hasField = true;
  }

  return hasField ? patch : null;
}
