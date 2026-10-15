/**
 * Audio deck layout (pure): the host's background-music playlist and
 * soundboard pads, saved per account at audioDecks/{uid}. Items point at the
 * owner's content-library assets (the audio files themselves live there and
 * count toward storage); this document only keeps order, names, volumes and
 * the loop mode. GET resolves each asset for its owner only, so an id that
 * isn't the caller's (or was deleted) simply drops out.
 */

export const AUDIO_DECK_LIMITS = {
  playlist: 50,
  pads: 24,
  name: 80,
  idLength: 64,
} as const;

export const LOOP_MODES = ["off", "one", "all"] as const;
export type LoopMode = (typeof LOOP_MODES)[number];

export type DeckItem = { assetId: string; name: string; volume: number };

export type AudioDeckLayout = {
  playlist: DeckItem[];
  pads: DeckItem[];
  loopMode: LoopMode;
};

export const EMPTY_AUDIO_DECK: AudioDeckLayout = { playlist: [], pads: [], loopMode: "all" };

const ASSET_ID_RE = /^[A-Za-z0-9_-]+$/;

// Flat shape (no strictNullChecks on the server).
export type AudioDeckParse = { ok: boolean; value?: AudioDeckLayout; field?: string; details?: string };

function parseItems(raw: unknown, field: string, max: number): { items?: DeckItem[]; error?: AudioDeckParse } {
  if (raw === undefined) return { items: [] };
  if (!Array.isArray(raw)) return { error: { ok: false, field, details: `${field} must be an array` } };
  if (raw.length > max) return { error: { ok: false, field, details: `at most ${max} items` } };
  const items: DeckItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i] as Record<string, unknown>;
    const f = `${field}[${i}]`;
    if (!it || typeof it !== "object") return { error: { ok: false, field: f, details: "must be an object" } };
    const assetId = typeof it.assetId === "string" ? it.assetId.trim() : "";
    if (!assetId || assetId.length > AUDIO_DECK_LIMITS.idLength || !ASSET_ID_RE.test(assetId)) {
      return { error: { ok: false, field: `${f}.assetId`, details: "invalid assetId" } };
    }
    const name = typeof it.name === "string" ? it.name.trim() : "";
    if (!name || name.length > AUDIO_DECK_LIMITS.name) {
      return { error: { ok: false, field: `${f}.name`, details: `name is required (max ${AUDIO_DECK_LIMITS.name})` } };
    }
    const volume = it.volume === undefined ? 1 : Number(it.volume);
    if (typeof it.volume !== "undefined" && (typeof it.volume !== "number" || !Number.isFinite(volume) || volume < 0 || volume > 1)) {
      return { error: { ok: false, field: `${f}.volume`, details: "volume must be 0–1" } };
    }
    items.push({ assetId, name, volume: Math.round(volume * 100) / 100 });
  }
  return { items };
}

/** Validates a full layout (PUT body). The same asset may appear in both lists. */
export function parseAudioDeckInput(body: unknown): AudioDeckParse {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, field: "body", details: "body must be an object" };
  const b = body as Record<string, unknown>;
  const pl = parseItems(b.playlist, "playlist", AUDIO_DECK_LIMITS.playlist);
  if (pl.error) return pl.error;
  const pads = parseItems(b.pads, "pads", AUDIO_DECK_LIMITS.pads);
  if (pads.error) return pads.error;
  const loopMode = b.loopMode === undefined ? "all" : b.loopMode;
  if (!(LOOP_MODES as readonly unknown[]).includes(loopMode)) {
    return { ok: false, field: "loopMode", details: `loopMode must be one of ${LOOP_MODES.join(", ")}` };
  }
  return { ok: true, value: { playlist: pl.items!, pads: pads.items!, loopMode: loopMode as LoopMode } };
}

/** Stored layout, tolerating missing/old/invalid data. */
export function normalizeAudioDeck(stored: unknown): AudioDeckLayout {
  const parsed = parseAudioDeckInput(stored ?? {});
  return parsed.ok ? parsed.value! : EMPTY_AUDIO_DECK;
}
