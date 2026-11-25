/**
 * Media videos (pure): the host's saved list of videos they can play on
 * stage from the in-room Media panel, saved per account at
 * mediaVideoDecks/{uid}. Like the audio deck (lib/audioDeckPure.ts), items
 * point at the owner's content-library assets (the files live there and
 * count toward storage); this document keeps order, names and volumes.
 *
 * Kept in its own document (not audioDecks/{uid}) so the audio deck's
 * full-replace PUT, including from older clients, can never drop videos.
 */
import { AUDIO_DECK_LIMITS, parseDeckItems, type DeckItem } from "./audioDeckPure";

export const MEDIA_VIDEO_LIMITS = {
  videos: 20,
  name: AUDIO_DECK_LIMITS.name,
} as const;

export type MediaVideosLayout = { videos: DeckItem[]; loop: boolean };

export const EMPTY_MEDIA_VIDEOS: MediaVideosLayout = { videos: [], loop: false };

// Flat shape (no strictNullChecks on the server).
export type MediaVideosParse = { ok: boolean; value?: MediaVideosLayout; field?: string; details?: string };

/** Validates a full list (PUT body). */
export function parseMediaVideosInput(body: unknown): MediaVideosParse {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, field: "body", details: "body must be an object" };
  const b = body as Record<string, unknown>;
  const parsed = parseDeckItems(b.videos, "videos", MEDIA_VIDEO_LIMITS.videos);
  if (parsed.error) return { ok: false, field: parsed.error.field, details: parsed.error.details };
  if (b.loop !== undefined && typeof b.loop !== "boolean") return { ok: false, field: "loop", details: "loop must be a boolean" };
  return { ok: true, value: { videos: parsed.items!, loop: b.loop === true } };
}

/** Stored list, tolerating missing/old/invalid data. */
export function normalizeMediaVideos(stored: unknown): MediaVideosLayout {
  const parsed = parseMediaVideosInput(stored ?? {});
  return parsed.ok ? parsed.value! : EMPTY_MEDIA_VIDEOS;
}
