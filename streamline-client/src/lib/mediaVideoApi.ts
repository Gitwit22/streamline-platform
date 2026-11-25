/**
 * Server side of the stage videos (lib/mediaVideo.ts): the saved list
 * (GET/PUT /api/media-videos) and the content library (upload + fresh
 * signed URLs via assetsApi), mirroring lib/audioDeckApi.ts.
 */
import { API_BASE } from "./apiBase";
import { apiFetchAuth } from "./api";
import { assetsApi } from "./editingApi";
import type { SavedVideos, VideoPersistence } from "./mediaVideo";

export function asSavedVideos(raw: unknown): SavedVideos {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const videos = (Array.isArray(o.videos) ? o.videos : [])
    .filter((x): x is { assetId: string; name: string; volume?: number } => !!x && typeof x.assetId === "string")
    .map((x) => ({ assetId: x.assetId, name: String(x.name || "Video"), volume: typeof x.volume === "number" ? x.volume : 1 }));
  return { videos, loop: o.loop === true };
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
