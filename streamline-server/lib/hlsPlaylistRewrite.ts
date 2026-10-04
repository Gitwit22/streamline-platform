/**
 * HLS playlist rewriting for authorized playback (pure; unit-tested).
 *
 * Playlists are served by the API (GET /api/hls/play/:roomId/:file?token=);
 * every URI inside is rewritten:
 *   - playlists (variant streams, EXT-X-MEDIA / I-FRAME renditions)
 *       → back through the API with the same token
 *   - media (segments, EXT-X-MAP init sections, EXT-X-KEY keys, parts)
 *       → short-lived presigned R2 GET URLs
 *
 * URIs are resolved relative to the playlist's own object key and must stay
 * inside the HLS output prefix; anything else (absolute URLs, data:/skd: keys,
 * paths escaping the prefix) is left untouched.
 */

export interface RewriteResolvers {
  /** objectKey of a referenced playlist (inside the prefix) → URI to emit. */
  playlist(objectKey: string, relativeToPrefix: string): string;
  /** objectKey of a referenced media object → URI to emit. */
  media(objectKey: string): string;
}

const URI_ATTR_TAGS = [
  "#EXT-X-MAP:",
  "#EXT-X-KEY:",
  "#EXT-X-SESSION-KEY:",
  "#EXT-X-MEDIA:",
  "#EXT-X-I-FRAME-STREAM-INF:",
  "#EXT-X-PART:",
  "#EXT-X-PRELOAD-HINT:",
  "#EXT-X-RENDITION-REPORT:",
];

/** Tags whose URI points at another playlist rather than media bytes. */
const PLAYLIST_URI_TAGS = new Set(["#EXT-X-MEDIA:", "#EXT-X-I-FRAME-STREAM-INF:", "#EXT-X-RENDITION-REPORT:"]);

function isAbsoluteUri(uri: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith("//");
}

/**
 * Resolve `uri` (relative) against the directory of `baseKey`. Returns null
 * when the result is absolute, root-relative, or escapes `prefix`.
 * Query strings / fragments on the reference are dropped (R2 keys have none).
 */
export function resolveObjectKey(prefix: string, baseKey: string, uri: string): string | null {
  const raw = String(uri || "").trim();
  if (!raw || isAbsoluteUri(raw) || raw.startsWith("/")) return null;
  const path = raw.split(/[?#]/)[0];
  if (!path) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  const baseDir = baseKey.includes("/") ? baseKey.slice(0, baseKey.lastIndexOf("/") + 1) : "";
  const stack = baseDir.split("/").filter(Boolean);
  for (const seg of decoded.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  const key = stack.join("/");
  const normPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  if (!key.startsWith(normPrefix) || key.length === normPrefix.length) return null;
  return key;
}

function isPlaylistKey(key: string): boolean {
  return /\.m3u8$/i.test(key);
}

function rewriteUriAttr(line: string, tag: string, prefix: string, baseKey: string, r: RewriteResolvers): string {
  return line.replace(/URI="([^"]*)"/, (whole, uri: string) => {
    const key = resolveObjectKey(prefix, baseKey, uri);
    if (!key) return whole;
    const normPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const out =
      PLAYLIST_URI_TAGS.has(tag) || isPlaylistKey(key)
        ? r.playlist(key, key.slice(normPrefix.length))
        : r.media(key);
    return `URI="${out}"`;
  });
}

/**
 * Rewrite a playlist fetched from `baseKey` (e.g. "hls/<room>/<run>/live.m3u8")
 * whose output lives under `prefix` ("hls/<room>/<run>/").
 */
export function rewritePlaylist(text: string, opts: { prefix: string; baseKey: string }, r: RewriteResolvers): string {
  const normPrefix = opts.prefix.endsWith("/") ? opts.prefix : `${opts.prefix}/`;
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  let nextIsVariant = false;
  const out: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      out.push(rawLine);
      continue;
    }
    if (line.startsWith("#")) {
      if (line.startsWith("#EXT-X-STREAM-INF")) nextIsVariant = true;
      const tag = URI_ATTR_TAGS.find((t) => line.startsWith(t));
      out.push(tag ? rewriteUriAttr(line, tag, normPrefix, opts.baseKey, r) : line);
      continue;
    }
    // URI line: variant playlist (after EXT-X-STREAM-INF) or media segment.
    const key = resolveObjectKey(normPrefix, opts.baseKey, line);
    if (!key) {
      out.push(line);
    } else if (nextIsVariant || isPlaylistKey(key)) {
      out.push(r.playlist(key, key.slice(normPrefix.length)));
    } else {
      out.push(r.media(key));
    }
    nextIsVariant = false;
  }
  return out.join("\n");
}

/** Playlist file names accepted by the play route (relative to the prefix). */
export function isSafePlaylistPath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0 || p.length > 200) return false;
  if (!/\.m3u8$/i.test(p)) return false;
  return p.split("/").every((seg) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(seg) && seg !== ".." && seg !== ".");
}
