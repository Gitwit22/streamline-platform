// Client copy of the media preset table's ids/labels.
// Server source of truth: streamline-server/lib/mediaPresets.ts (MEDIA_PRESETS /
// MEDIA_PRESET_LABELS). If you change one, update the other to match.

export type MediaPresetId = "standard_720p30" | "hd_1080p30" | "sports_1080p60" | "pro_1440p30" | "ultra_4k30";

export const DEFAULT_MEDIA_PRESET_ID: MediaPresetId = "standard_720p30";

/** Lowest to highest quality. */
export const MEDIA_PRESET_ORDER: MediaPresetId[] = [
  "standard_720p30",
  "hd_1080p30",
  "sports_1080p60",
  "pro_1440p30",
  "ultra_4k30",
];

export const MEDIA_PRESET_LABELS: Record<MediaPresetId, string> = {
  standard_720p30: "Standard (720p30)",
  hd_1080p30: "Full HD (1080p30)",
  sports_1080p60: "Action/Sports (1080p60)",
  pro_1440p30: "Studio (1440p30)",
  ultra_4k30: "Cinema (4K30)",
};

export function isMediaPresetId(id: unknown): id is MediaPresetId {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(MEDIA_PRESET_LABELS, id);
}

/** Human label for a preset id. Never returns the raw id. */
export function mediaPresetLabel(id?: string | null): string {
  if (isMediaPresetId(id)) return MEDIA_PRESET_LABELS[id];
  return MEDIA_PRESET_LABELS[DEFAULT_MEDIA_PRESET_ID];
}

export function mediaPresetRank(id?: string | null): number {
  return isMediaPresetId(id) ? MEDIA_PRESET_ORDER.indexOf(id) : -1;
}

/** Presets at or above 1080p60 (incl. 1440p / 4K) trigger the high-quality warning. */
export function isHighQualityPreset(id?: string | null): boolean {
  return mediaPresetRank(id) >= mediaPresetRank("sports_1080p60");
}

export type PresetOption = { id: string; label: string; allowed: boolean };

/**
 * Normalize /api/account/presets output (or a fallback) into labelled options.
 * `allowed` comes from the server; when absent, `maxPresetId` decides; when
 * neither is known every preset is treated as allowed (the server clamps).
 */
export function toPresetOptions(raw: unknown, maxPresetId?: string | null): PresetOption[] {
  const list: Array<{ id?: unknown; allowed?: unknown } | null | undefined> = Array.isArray(raw) ? raw : [];
  const maxRank = mediaPresetRank(maxPresetId);
  const fromServer: PresetOption[] = [];
  for (const p of list) {
    if (!p || !isMediaPresetId(p.id)) continue;
    fromServer.push({
      id: p.id,
      label: mediaPresetLabel(p.id),
      allowed: typeof p.allowed === "boolean" ? p.allowed : maxRank < 0 || mediaPresetRank(p.id) <= maxRank,
    });
  }
  if (fromServer.length) return fromServer;
  return MEDIA_PRESET_ORDER.map((id) => ({
    id,
    label: MEDIA_PRESET_LABELS[id],
    allowed: maxRank < 0 || mediaPresetRank(id) <= maxRank,
  }));
}

/** Camera capture resolution key for publishers given the host's effective preset. */
export type CaptureResolutionKey = "h720" | "h1080";

export function captureResolutionForPreset(id?: string | null): CaptureResolutionKey {
  return mediaPresetRank(id) >= mediaPresetRank("hd_1080p30") ? "h1080" : "h720";
}

const CAPTURE_CACHE_PREFIX = "sl_capture_preset:";

/** Last known owner preset for a room (per browser); used to pick capture defaults at mount. */
export function readCachedRoomPreset(roomId?: string | null): MediaPresetId | null {
  if (!roomId) return null;
  try {
    const v = window.localStorage.getItem(CAPTURE_CACHE_PREFIX + roomId);
    return isMediaPresetId(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeCachedRoomPreset(roomId: string | null | undefined, id: string | null | undefined) {
  if (!roomId || !isMediaPresetId(id)) return;
  try {
    window.localStorage.setItem(CAPTURE_CACHE_PREFIX + roomId, id);
  } catch {
    // storage unavailable: capture falls back to 720p next time
  }
}
