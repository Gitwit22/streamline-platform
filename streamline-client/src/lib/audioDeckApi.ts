/**
 * Server side of the audio deck (lib/audioDeck.ts): the saved layout
 * (GET/PUT /api/audio-deck) and the content library (upload + fresh signed
 * URLs via assetsApi).
 */
import { API_BASE } from "./apiBase";
import { apiFetchAuth } from "./api";
import { assetsApi } from "./editingApi";
import type { DeckPersistence, LoopMode, SavedLayout } from "./audioDeck";

function asLayout(raw: unknown): SavedLayout {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const items = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .filter((x): x is { assetId: string; name: string; volume?: number } => !!x && typeof x.assetId === "string")
      .map((x) => ({ assetId: x.assetId, name: String(x.name || "Audio"), volume: typeof x.volume === "number" ? x.volume : 1 }));
  const loop = o.loopMode === "off" || o.loopMode === "one" ? (o.loopMode as LoopMode) : "all";
  return { playlist: items(o.playlist), pads: items(o.pads), loopMode: loop };
}

export const deckPersistence: DeckPersistence = {
  async load() {
    const res = await apiFetchAuth(`${API_BASE}/api/audio-deck`, { cache: "no-store" }, { allowNonOk: true });
    if (!res.ok) throw new Error(`load failed (${res.status})`);
    const p = await res.json();
    return {
      layout: asLayout(p?.layout),
      assets: p?.assets && typeof p.assets === "object" ? p.assets : {},
      missing: Array.isArray(p?.missing) ? p.missing : [],
    };
  },

  async save(layout) {
    const res = await apiFetchAuth(
      `${API_BASE}/api/audio-deck`,
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
