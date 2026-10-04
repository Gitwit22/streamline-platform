/**
 * Program layout resolution (programState v2).
 *
 * Pure module (no LiveKit imports) so it can be unit-tested with mock
 * participants. The egress compositor implements the exact same algorithm:
 *
 *  1. Eligible = participants that are not invisible/hidden, not egress/agents,
 *     and have a published camera/screen track or canPublish permission.
 *  2. Order: hostIdentity, then "producer:" identities, then joinedAt asc,
 *     identity as tiebreak.
 *  3. Screen shares = eligible participants' screen tracks by publish time.
 *  4. screenShareMode "auto" + >=1 screen share + active layout without a
 *     screen slot -> SCREEN_OVERRIDE layout.
 *  5. Explicit participant slots first, then auto-screen slots (screen shares
 *     in order), then auto slots (remaining eligible cameras in order).
 *     Unfilled slots stay empty. If nothing resolves: automatic camera grid.
 *  6. Fit: cover for camera, contain for screen; label unless label===false.
 */

import {
  SCREEN_OVERRIDE,
  buildOrientationLayout,
  getPreset,
  layoutHasScreenSlot,
  portraitFor,
  type FracSlot,
  type Orientation,
  type OrientationLayout,
  type ProgramStateV2,
  type ScreenShareMode,
} from "./programPresets";

export type ResolveParticipant = {
  identity: string;
  name?: string;
  /** Raw participant metadata (JSON string) or parsed object. */
  metadata?: string | Record<string, unknown> | null;
  isAgent?: boolean;
  /** Join time in ms (Infinity / undefined when unknown). */
  joinedAt?: number | null;
  /** LiveKit permissions.canPublish. */
  canPublish?: boolean;
  hasCamera?: boolean;
  hasScreen?: boolean;
  /** Screen share publish time (ms); falls back to list order. */
  screenPublishedAt?: number | null;
};

export type ResolvedSlot = {
  slot: FracSlot;
  identity: string | null;
  track: "camera" | "screen" | null;
  fit: "cover" | "contain";
  label: boolean;
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
  participants: ResolveParticipant[];
  orientation: Orientation;
};

function parseMeta(raw: ResolveParticipant["metadata"]): Record<string, unknown> | null {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

export function isEligible(p: ResolveParticipant): boolean {
  const id = String(p.identity || "");
  if (!id) return false;
  if (id.startsWith("invisible_")) return false;
  if (id.startsWith("EG_") || p.isAgent) return false;
  const meta = parseMeta(p.metadata);
  if (meta && (meta.presenceMode === "invisible" || meta.hidden === true)) return false;
  return !!p.hasCamera || !!p.hasScreen || p.canPublish === true;
}

function rank(p: ResolveParticipant, hostIdentity: string | null): number {
  if (hostIdentity && p.identity === hostIdentity) return 0;
  if (p.identity.startsWith("producer:")) return 1;
  return 2;
}

function joined(p: ResolveParticipant): number {
  const t = p.joinedAt;
  return typeof t === "number" && Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

export function orderParticipants(list: ResolveParticipant[], hostIdentity: string | null): ResolveParticipant[] {
  return list
    .slice()
    .sort((a, b) => {
      const r = rank(a, hostIdentity) - rank(b, hostIdentity);
      if (r !== 0) return r;
      const ja = joined(a);
      const jb = joined(b);
      if (ja !== jb) return ja < jb ? -1 : 1;
      return a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0;
    });
}

/** Automatic grid used when nothing resolves. */
export function autoGridSlots(count: number, orientation: Orientation): FracSlot[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  let cols: number;
  let rows: number;
  if (orientation === "portrait") {
    cols = n <= 3 ? 1 : 2;
    rows = Math.ceil(n / cols);
  } else {
    cols = Math.ceil(Math.sqrt(n));
    rows = Math.ceil(n / cols);
  }
  const w = 1 / cols;
  const h = 1 / rows;
  const slots: FracSlot[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
    const offset = ((cols - inRow) * w) / 2; // center a short last row
    slots.push({ id: `grid${i + 1}`, x: offset + c * w, y: r * h, w, h, z: 1, source: { kind: "auto" } });
  }
  return slots;
}

function validLayout(l: unknown): l is OrientationLayout {
  return !!l && typeof l === "object" && Array.isArray((l as OrientationLayout).slots);
}

export function resolveProgram({ state, participants, orientation }: ResolveInput): ProgramResolution {
  const hostIdentity = state?.hostIdentity ?? null;
  const mode: ScreenShareMode = state?.screenShareMode === "manual" ? "manual" : "auto";

  const eligibleList = orderParticipants(participants.filter(isEligible), hostIdentity);
  const eligible = eligibleList.map((p) => p.identity);
  const byId = new Map(eligibleList.map((p) => [p.identity, p] as const));

  const screens = eligibleList
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => !!p.hasScreen)
    .sort((a, b) => {
      const ta = typeof a.p.screenPublishedAt === "number" ? a.p.screenPublishedAt : Number.POSITIVE_INFINITY;
      const tb = typeof b.p.screenPublishedAt === "number" ? b.p.screenPublishedAt : Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.idx - b.idx;
    })
    .map(({ p }) => p.identity);

  const chosen = state ? state[orientation] : null;
  let layout: OrientationLayout | null = validLayout(chosen) ? chosen : null;
  let screenOverride = false;
  if (mode === "auto" && screens.length > 0 && !layoutHasScreenSlot(layout)) {
    const o = buildOrientationLayout(SCREEN_OVERRIDE[orientation], orientation);
    if (o) {
      layout = o;
      screenOverride = true;
    }
  }

  const finish = (slot: FracSlot, identity: string | null, track: "camera" | "screen" | null): ResolvedSlot => ({
    slot,
    identity,
    track,
    fit: slot.fit ?? (track === "screen" ? "contain" : "cover"),
    label: slot.label !== false,
  });

  const out: Array<ResolvedSlot | null> = layout ? layout.slots.map(() => null) : [];
  if (layout) {
    const usedCams = new Set<string>();
    const usedScreens = new Set<string>();
    const slots = layout.slots;
    // Pass 1: explicit participant slots.
    slots.forEach((s, i) => {
      const src = s.source;
      if (src?.kind !== "participant") return;
      const p = byId.get(src.identity);
      if (!p) return;
      if (src.track === "screen") {
        if (!p.hasScreen || usedScreens.has(p.identity)) return;
        usedScreens.add(p.identity);
        out[i] = finish(s, p.identity, "screen");
      } else {
        if (usedCams.has(p.identity)) return;
        usedCams.add(p.identity);
        out[i] = finish(s, p.identity, "camera");
      }
    });
    // Pass 2: auto-screen slots.
    const screenQueue = screens.filter((id) => !usedScreens.has(id));
    slots.forEach((s, i) => {
      if (s.source?.kind !== "auto-screen") return;
      const id = screenQueue.shift();
      if (!id) return;
      usedScreens.add(id);
      out[i] = finish(s, id, "screen");
    });
    // Pass 3: auto camera slots.
    const camQueue = eligible.filter((id) => !usedCams.has(id));
    slots.forEach((s, i) => {
      if (s.source?.kind !== "auto") return;
      const id = camQueue.shift();
      if (!id) return;
      usedCams.add(id);
      out[i] = finish(s, id, "camera");
    });
  }

  const anyResolved = out.some((r) => r && r.identity);
  if (!layout || !anyResolved) {
    const grid = autoGridSlots(eligible.length, orientation);
    return {
      orientation,
      presetId: "auto_grid",
      slots: grid.map((s, i) => finish(s, eligible[i], "camera")),
      screenOverride: false,
      fallbackGrid: true,
      eligible,
      screens,
    };
  }

  return {
    orientation,
    presetId: layout.presetId,
    slots: layout.slots.map((s, i) => out[i] ?? finish(s, null, null)),
    screenOverride,
    fallbackGrid: false,
    eligible,
    screens,
  };
}

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
      : buildOrientationLayout(portraitFor(r.landscape.presetId), "portrait");
    if (!portrait) return null;
    return { ...(r as ProgramStateV2), landscape: r.landscape, portrait, screenShareMode, hostIdentity, updatedAt };
  }
  const legacyId = typeof r.programLayout === "string" ? r.programLayout : null;
  if (legacyId && getPreset(legacyId, "landscape")) {
    const landscape = buildOrientationLayout(legacyId, "landscape");
    const portrait = buildOrientationLayout(portraitFor(legacyId), "portrait");
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
