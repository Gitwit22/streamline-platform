/**
 * Media videos (pure): the host's saved video playlist for the in-room Media
 * panel, saved per account at mediaVideoDecks/{uid}. Each item is either a
 * content-library file (`assetId`; the file lives in the library and counts
 * toward storage) or a YouTube video (`youtubeId`; played from the host's
 * StreamLine Media Player tab, nothing is stored). This document keeps
 * order, names, volumes and the play mode.
 *
 * Kept in its own document (not audioDecks/{uid}) so the audio deck's
 * full-replace PUT, including from older clients, can never drop videos.
 */
import { AUDIO_DECK_LIMITS } from "./audioDeckPure";

export const MEDIA_VIDEO_LIMITS = {
  videos: 30,
  name: AUDIO_DECK_LIMITS.name,
  idLength: AUDIO_DECK_LIMITS.idLength,
} as const;

/**
 * once     – play the chosen video, then leave the stage / box
 * loop     – repeat the chosen video
 * next     – continue down the playlist, stop after the last
 * nextLoop – continue down the playlist, then start over
 */
export const PLAY_MODES = ["once", "loop", "next", "nextLoop"] as const;
export type PlayMode = (typeof PLAY_MODES)[number];

export type MediaVideoItem = { assetId?: string; youtubeId?: string; name: string; volume: number };

export type MediaVideosLayout = { videos: MediaVideoItem[]; playMode: PlayMode };

export const EMPTY_MEDIA_VIDEOS: MediaVideosLayout = { videos: [], playMode: "once" };

const ASSET_ID_RE = /^[A-Za-z0-9_-]+$/;
/** YouTube video ids are 11 characters of [A-Za-z0-9_-]. */
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Flat shape (no strictNullChecks on the server).
export type MediaVideosParse = { ok: boolean; value?: MediaVideosLayout; field?: string; details?: string };

function fail(field: string, details: string): MediaVideosParse {
  return { ok: false, field, details };
}

/** Validates a full list (PUT body). */
export function parseMediaVideosInput(body: unknown): MediaVideosParse {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("body", "body must be an object");
  const b = body as Record<string, unknown>;
  const raw = b.videos === undefined ? [] : b.videos;
  if (!Array.isArray(raw)) return fail("videos", "videos must be an array");
  if (raw.length > MEDIA_VIDEO_LIMITS.videos) return fail("videos", `at most ${MEDIA_VIDEO_LIMITS.videos} items`);

  const videos: MediaVideoItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i] as Record<string, unknown>;
    const f = `videos[${i}]`;
    if (!it || typeof it !== "object") return fail(f, "must be an object");
    const assetId = typeof it.assetId === "string" ? it.assetId.trim() : "";
    const youtubeId = typeof it.youtubeId === "string" ? it.youtubeId.trim() : "";
    if (!!assetId === !!youtubeId) return fail(f, "exactly one of assetId or youtubeId is required");
    if (assetId && (assetId.length > MEDIA_VIDEO_LIMITS.idLength || !ASSET_ID_RE.test(assetId))) {
      return fail(`${f}.assetId`, "invalid assetId");
    }
    if (youtubeId && !YOUTUBE_ID_RE.test(youtubeId)) return fail(`${f}.youtubeId`, "invalid youtubeId");
    const name = typeof it.name === "string" ? it.name.trim() : "";
    if (!name || name.length > MEDIA_VIDEO_LIMITS.name) {
      return fail(`${f}.name`, `name is required (max ${MEDIA_VIDEO_LIMITS.name})`);
    }
    if (it.volume !== undefined && (typeof it.volume !== "number" || !Number.isFinite(it.volume) || it.volume < 0 || it.volume > 1)) {
      return fail(`${f}.volume`, "volume must be 0–1");
    }
    const volume = Math.round((it.volume === undefined ? 1 : (it.volume as number)) * 100) / 100;
    videos.push(assetId ? { assetId, name, volume } : { youtubeId, name, volume });
  }

  let playMode: unknown = b.playMode;
  // Lists saved before play modes had a `loop` flag.
  if (playMode === undefined) playMode = b.loop === true ? "loop" : "once";
  if (!(PLAY_MODES as readonly unknown[]).includes(playMode)) {
    return fail("playMode", `playMode must be one of ${PLAY_MODES.join(", ")}`);
  }
  return { ok: true, value: { videos, playMode: playMode as PlayMode } };
}

/** Stored list, tolerating missing/old/invalid data. */
export function normalizeMediaVideos(stored: unknown): MediaVideosLayout {
  const parsed = parseMediaVideosInput(stored ?? {});
  return parsed.ok ? parsed.value! : EMPTY_MEDIA_VIDEOS;
}
