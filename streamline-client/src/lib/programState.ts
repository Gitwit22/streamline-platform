/**
 * Program State – client-side types and defaults.
 *
 * Mirrors the server-side definitions in `streamline-server/lib/programState.ts`.
 * The client bundle stays independent from the server.
 */

import type { StudioLayoutPresetId, LayoutSlot } from "./studioLayout";

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
