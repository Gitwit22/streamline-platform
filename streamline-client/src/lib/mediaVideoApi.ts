/**
 * Server side of the stage videos (lib/mediaVideo.ts): the saved list
 * (GET/PUT /api/media-videos) and the content library (upload + fresh
 * signed URLs via assetsApi), mirroring lib/audioDeckApi.ts.
 */
import { API_BASE } from "./apiBase";
import { apiFetchAuth } from "./api";
import { assetsApi } from "./editingApi";
import { PLAY_MODES, type PlayMode, type SavedVideoItem, type SavedVideos, type VideoPersistence } from "./mediaVideo";

export function asSavedVideos(raw: unknown): SavedVideos {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const videos: SavedVideoItem[] = [];
  for (const x of Array.isArray(o.videos) ? o.videos : []) {
    if (!x || typeof x !== "object") continue;
    const it = x as { assetId?: unknown; youtubeId?: unknown; name?: unknown; volume?: unknown };
    const name = String(it.name || "Video");
    const volume = typeof it.volume === "number" ? it.volume : 1;
    if (typeof it.youtubeId === "string" && it.youtubeId) videos.push({ youtubeId: it.youtubeId, name, volume });
    else if (typeof it.assetId === "string" && it.assetId) videos.push({ assetId: it.assetId, name, volume });
  }
  const playMode = PLAY_MODES.includes(o.playMode as PlayMode) ? (o.playMode as PlayMode) : "once";
  return { videos, playMode };
}

export const videoPersistence: VideoPersistence = {
  async load() {
    const res = await apiFetchAuth(`${API_BASE}/api/media-videos`, { cache: "no-store" }, { allowNonOk: true });
    if (!res.ok) throw new Error(`load failed (${res.status})`);
    const p = await res.json();
    return {
      layout: asSavedVideos(p?.layout),
      assets: p?.assets && typeof p.assets === "object" ? p.assets : {},
      missing: Array.isArray(p?.missing) ? p.missing : [],
    };
  },

  async save(layout) {
    const res = await apiFetchAuth(
      `${API_BASE}/api/media-videos`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(layout) },
      { allowNonOk: true }
    );
    if (!res.ok) throw new Error(`save failed (${res.status})`);
  },

  async upload(file, onProgress) {
    const r = await assetsApi.upload(file, onProgress);
    if (!r?.assetId) throw new Error("Upload failed");
    return { assetId: r.assetId, url: r.asset?.videoUrl || "" };
  },

  async resolveUrl(assetId) {
    const a = await assetsApi.getById(assetId);
    return a?.videoUrl || null;
  },
};
