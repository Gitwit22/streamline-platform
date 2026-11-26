/**
 * YouTube links for the Media panel's video playlist (lib/mediaVideo.ts).
 * Only the 11-character video id is kept; the StreamLine Media Player tab
 * (public/media-player.html) builds the embed itself, so no user-supplied
 * URL is ever loaded.
 */

export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

/** The video id from a YouTube link (watch, youtu.be, shorts, live, embed) or a bare id; null otherwise. */
export function parseYouTubeId(input: string): string | null {
  const text = (input || "").trim();
  if (!text) return null;
  if (YOUTUBE_ID_RE.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    id = url.pathname.split("/")[1] || null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch") id = url.searchParams.get("v");
    else if (["shorts", "live", "embed", "v"].includes(parts[0])) id = parts[1] || null;
  }
  return id && YOUTUBE_ID_RE.test(id) ? id : null;
}

/** The video's title via YouTube's public oEmbed endpoint; null when unavailable. */
export async function fetchYouTubeTitle(id: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!YOUTUBE_ID_RE.test(id)) return null;
  try {
    const watch = `https://www.youtube.com/watch?v=${id}`;
    const res = await fetchImpl(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { title?: unknown };
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    return title ? title.slice(0, 80) : null;
  } catch {
    return null;
  }
}
