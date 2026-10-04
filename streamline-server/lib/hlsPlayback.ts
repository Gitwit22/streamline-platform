/**
 * Authorized HLS playback (server side).
 *
 * Public channels keep the direct public playlist URL (zero extra cost),
 * unless HLS_PROXY_ALL=1. Every other mode gets a short-lived signed URL to
 * the API playlist proxy:
 *
 *   GET /api/hls/play/<roomId>/<playlist>.m3u8?token=<playback token>
 *
 * which validates the token, reads the playlist from R2 (cached ~2s per
 * playlist, shared by all viewers) and rewrites segment / init / key URIs to
 * presigned R2 GET URLs (TTL HLS_SEGMENT_URL_TTL_SEC, default 10 min,
 * re-minted as the live playlist rolls).
 */
import crypto from "crypto";
import { getObjectText, presignGetQuiet } from "./storageClient";
import { rewritePlaylist } from "./hlsPlaylistRewrite";
import { getPlaybackSecret, getPlaybackTokenTtlSec, signPlaybackToken } from "./playbackToken";
import type { ViewerAccessMode } from "./viewerAccess";

export function hlsProxyAll(env: Record<string, string | undefined> = process.env): boolean {
  const v = String(env.HLS_PROXY_ALL || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Output prefix for a new HLS run: protected runs get an unguessable path. */
export function hlsRunPrefix(roomId: string, protectedRun: boolean): string {
  if (!protectedRun) return `hls/${roomId}/`;
  return `hls/${roomId}/p-${crypto.randomBytes(16).toString("hex")}/`;
}

export function hlsPrefixFor(roomId: string, hls: any): string {
  const p = String(hls?.prefix || "").trim();
  return p && p.startsWith(`hls/${roomId}/`) ? (p.endsWith("/") ? p : `${p}/`) : `hls/${roomId}/`;
}

/** Playlist file name of the live run (last path segment of playlistUrl). */
export function livePlaylistFile(hls: any): string {
  const url = String(hls?.playlistUrl || "").split("?")[0];
  const last = url.slice(url.lastIndexOf("/") + 1);
  return /^[A-Za-z0-9._-]+\.m3u8$/.test(last) ? last : "live.m3u8";
}

export type IssuedPlayback =
  | { ok: true; playbackUrl: string; expiresAt: number | null; protected: boolean }
  | { ok: false; error: "playback_unconfigured" };

/**
 * Playback URL for an AUTHORIZED viewer of a LIVE room. `playbackUrl` is
 * either an absolute public URL or an API path ("/api/hls/play/...") the
 * client prefixes with its API base.
 */
export function issuePlayback(params: {
  roomId: string;
  hls: any;
  mode: ViewerAccessMode;
  entitlementId?: string | null;
}): IssuedPlayback {
  const { roomId, hls } = params;
  if (params.mode === "public" && !hlsProxyAll()) {
    return { ok: true, playbackUrl: String(hls?.playlistUrl || ""), expiresAt: null, protected: false };
  }
  const secret = getPlaybackSecret();
  if (!secret) return { ok: false, error: "playback_unconfigured" };
  const { token, expiresAt } = signPlaybackToken(secret, {
    roomId,
    runId: hls?.runId ?? null,
    ttlSec: getPlaybackTokenTtlSec(),
    entitlementId: params.entitlementId ?? null,
    mode: params.mode,
  });
  const file = livePlaylistFile(hls);
  return {
    ok: true,
    playbackUrl: `/api/hls/play/${encodeURIComponent(roomId)}/${file}?token=${encodeURIComponent(token)}`,
    expiresAt,
    protected: true,
  };
}

// ---------------------------------------------------------------------------
// Playlist proxy (caches)
// ---------------------------------------------------------------------------

export function segmentUrlTtlSec(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.HLS_SEGMENT_URL_TTL_SEC);
  if (!Number.isFinite(n) || n <= 0) return 600;
  return Math.min(Math.max(Math.floor(n), 60), 3600);
}

const PLAYLIST_CACHE_MS = 2_000;
const playlistCache = new Map<string, { at: number; text: string | null }>();
const inflight = new Map<string, Promise<string | null>>();

async function fetchPlaylistCached(key: string): Promise<string | null> {
  const hit = playlistCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < PLAYLIST_CACHE_MS) return hit.text;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = getObjectText(key)
    .then((text) => {
      if (playlistCache.size > 1000) playlistCache.clear();
      playlistCache.set(key, { at: Date.now(), text });
      return text;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Presigned media URLs are reused while they have > half their life left so
// repeated playlist fetches emit identical URIs (browser/CDN cache friendly).
const presignCache = new Map<string, { url: string; exp: number }>();

async function presignMedia(key: string, ttlSec: number): Promise<string> {
  const hit = presignCache.get(key);
  const now = Date.now();
  if (hit && hit.exp - now > (ttlSec * 1000) / 2) return hit.url;
  const url = await presignGetQuiet(key, ttlSec);
  if (presignCache.size > 20000) presignCache.clear();
  presignCache.set(key, { url, exp: now + ttlSec * 1000 });
  return url;
}

/**
 * Fetch + rewrite `<prefix><file>`; null when the playlist doesn't exist yet.
 * `token` is re-attached to nested playlist URIs.
 */
export async function buildAuthorizedPlaylist(params: {
  roomId: string;
  prefix: string;
  file: string;
  token: string;
}): Promise<string | null> {
  const baseKey = `${params.prefix}${params.file}`;
  const text = await fetchPlaylistCached(baseKey);
  if (text === null) return null;

  // Collect media keys first (presigning is async), then rewrite synchronously.
  const mediaKeys = new Set<string>();
  rewritePlaylist(text, { prefix: params.prefix, baseKey }, {
    playlist: (_k, rel) => rel,
    media: (k) => {
      mediaKeys.add(k);
      return k;
    },
  });
  const ttl = segmentUrlTtlSec();
  const signed = new Map<string, string>();
  await Promise.all(
    [...mediaKeys].map(async (k) => {
      signed.set(k, await presignMedia(k, ttl));
    })
  );
  const tokenQs = `token=${encodeURIComponent(params.token)}`;
  return rewritePlaylist(text, { prefix: params.prefix, baseKey }, {
    playlist: (_k, rel) =>
      `/api/hls/play/${encodeURIComponent(params.roomId)}/${rel.split("/").map(encodeURIComponent).join("/")}?${tokenQs}`,
    media: (k) => signed.get(k) || k,
  });
}
