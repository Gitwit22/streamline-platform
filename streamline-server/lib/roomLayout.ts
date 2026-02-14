export type RoomLayoutMode = "grid" | "speaker" | "carousel" | "pip";

export type RoomLayout = {
  mode: RoomLayoutMode;
  maxTiles?: number;
  followSpeaker?: boolean;
  pinnedIdentity?: string | null;
};

export type CompositeLayoutMode = "grid" | "speaker";

function pickBoolean(v: any): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

function pickNumber(v: any): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function pickStringOrNull(v: any): string | null | undefined {
  if (v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  return undefined;
}

export function normalizeRoomLayout(input: any): RoomLayout | null {
  if (!input || typeof input !== "object") return null;

  const rawMode = String((input as any).mode || "").toLowerCase();
  const mode: RoomLayoutMode | null =
    rawMode === "grid" || rawMode === "speaker" || rawMode === "carousel" || rawMode === "pip"
      ? (rawMode as RoomLayoutMode)
      : null;

  if (!mode) return null;

  const maxTiles = pickNumber((input as any).maxTiles);
  const followSpeaker = pickBoolean((input as any).followSpeaker);
  const pinnedIdentity = pickStringOrNull((input as any).pinnedIdentity);

  const out: RoomLayout = { mode };
  if (typeof maxTiles === "number") out.maxTiles = maxTiles;
  if (typeof followSpeaker === "boolean") out.followSpeaker = followSpeaker;
  if (pinnedIdentity !== undefined) out.pinnedIdentity = pinnedIdentity;

  return out;
}

export function normalizeCompositeLayoutMode(raw: any): CompositeLayoutMode | null {
  const v = String(raw || "").toLowerCase();
  if (v === "speaker" || v === "grid") return v as CompositeLayoutMode;
  // Composite egress only supports speaker/grid; map room-level modes to the closest composite.
  if (v === "carousel") return "grid";
  if (v === "pip") return "speaker";
  return null;
}

/**
 * Canonical resolution order:
 * 1) rooms/{roomId}.roomLayout.mode
 * 2) legacy rooms/{roomId}.recordingLayout (if present)
 * 3) request body layout (for backwards compatibility)
 * 4) default "speaker"
 */
export function resolveCompositeLayoutFromRoom(params: {
  roomDoc?: any;
  requestLayout?: any;
  defaultMode?: CompositeLayoutMode;
}): {
  mode: CompositeLayoutMode;
  source: "roomLayout" | "legacyRecordingLayout" | "request" | "default";
} {
  const def = params.defaultMode || "speaker";
  const room = params.roomDoc || {};

  const normalizedRoomLayout = normalizeRoomLayout(room.roomLayout);
  const fromRoom = normalizedRoomLayout ? normalizeCompositeLayoutMode(normalizedRoomLayout.mode) : null;
  if (fromRoom) return { mode: fromRoom, source: "roomLayout" };

  const legacy = normalizeCompositeLayoutMode((room as any).recordingLayout);
  if (legacy) return { mode: legacy, source: "legacyRecordingLayout" };

  const req = normalizeCompositeLayoutMode(params.requestLayout);
  if (req) return { mode: req, source: "request" };

  return { mode: def, source: "default" };
}
