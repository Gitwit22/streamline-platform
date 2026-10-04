/**
 * MediaAsset — one listing shape for every source the editor can place on a
 * timeline (pure, no Firestore).
 *
 * Backing collections (unchanged, nothing is moved):
 *   recordings      -> type "recording" (source "stream")
 *   editing_assets  -> type video | audio | image (source "upload")
 *   saved_videos    -> finalized videos: exports saved to the library
 *                      (source "export") and legacy My Content uploads
 *                      (source "upload"). Recording-backed saved_videos are
 *                      the same file as the recording and are not listed
 *                      twice.
 *   project_assets  -> per-project uploads (resolvable, not listed globally)
 */

export type MediaAssetType = "video" | "audio" | "image" | "recording";
export type MediaAssetSource = "stream" | "upload" | "export";
export type MediaAssetCollection = "recordings" | "editing_assets" | "saved_videos" | "project_assets";

export interface MediaAsset {
  id: string;
  type: MediaAssetType;
  source: MediaAssetSource;
  collection: MediaAssetCollection;
  name: string;
  /** Seconds (0 = unknown). */
  duration: number;
  fileSize: number;
  /** Playable URL (presigned by the route when a storage key exists). */
  videoUrl: string;
  thumbnailUrl: string | null;
  /** Alias kept for older client code. */
  thumbnail: string;
  createdAt: string;
  status: string;
  hasVideo: boolean;
  hasAudio: boolean;
  userId: string;
  /** R2 key used for presigning / rendering; never sent to clients. */
  storageKey?: string | null;
  // recording extras (Recent Streams cards)
  roomName?: string | null;
  usageType?: string | null;
  viewerCount?: number;
  peakViewers?: number;
  streamDurationSec?: number;
  avgWatchSeconds?: number | null;
  // export extras
  sourceProjectId?: string | null;
}

export function tsToIso(v: any): string | null {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  if (typeof v?._seconds === "number") return new Date(v._seconds * 1000).toISOString();
  return null;
}

const AUDIO_EXT = new Set(["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "weba"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

/** video | audio | image from a MIME type, falling back to the file extension. */
export function inferMediaType(mime: unknown, filename?: unknown): "video" | "audio" | "image" {
  const m = typeof mime === "string" ? mime.toLowerCase() : "";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  const ext = typeof filename === "string" ? filename.split("?")[0].split(".").pop()?.toLowerCase() || "" : "";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (IMAGE_EXT.has(ext)) return "image";
  return "video";
}

const n = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const key = (v: unknown) => (typeof v === "string" ? v.trim().replace(/^\/+/, "") : "");

export function isDeletedStatus(status: unknown): boolean {
  const s = String(status || "").toLowerCase();
  return s === "deleted" || s === "deleting";
}

export function recordingToMediaAsset(id: string, d: any): MediaAsset {
  const duration = n(d?.duration) || n(d?.durationMinutes) * 60;
  const thumb = d?.thumbnailUrl || null;
  return {
    id,
    type: "recording",
    source: "stream",
    collection: "recordings",
    name: d?.title || d?.roomName || "Untitled",
    duration,
    fileSize: n(d?.fileSize),
    videoUrl: d?.videoUrl || d?.publicExportUrl || "",
    thumbnailUrl: thumb,
    thumbnail: thumb || "",
    createdAt: tsToIso(d?.createdAt) || new Date(0).toISOString(),
    status: String(d?.status || "processing"),
    hasVideo: true,
    hasAudio: d?.hasEmbeddedAudio !== false,
    userId: String(d?.userId || ""),
    storageKey: key(d?.objectKey) || key(d?.downloadPath) || null,
    roomName: d?.roomName ?? null,
    usageType: d?.usageType ?? null,
    viewerCount: n(d?.viewerCount),
    peakViewers: n(d?.peakViewers),
    streamDurationSec: n(d?.streamDurationSec),
    avgWatchSeconds: typeof d?.avgWatchSeconds === "number" ? d.avgWatchSeconds : null,
  };
}

export function uploadToMediaAsset(id: string, d: any): MediaAsset {
  const type = d?.type === "audio" || d?.type === "image" || d?.type === "video"
    ? d.type
    : inferMediaType(d?.mimeType, d?.storagePath || d?.name);
  const thumb = d?.thumbnailUrl || null;
  return {
    id,
    type,
    source: "upload",
    collection: "editing_assets",
    name: d?.name || "Untitled",
    duration: n(d?.duration),
    fileSize: n(d?.fileSize),
    videoUrl: d?.videoUrl || "",
    thumbnailUrl: thumb,
    thumbnail: thumb || "",
    createdAt: tsToIso(d?.createdAt) || new Date(0).toISOString(),
    status: String(d?.status || "ready"),
    hasVideo: typeof d?.hasVideo === "boolean" ? d.hasVideo : type === "video",
    hasAudio: typeof d?.hasAudio === "boolean" ? d.hasAudio : type !== "image",
    userId: String(d?.userId || ""),
    storageKey: key(d?.storagePath) || null,
  };
}

/** saved_videos -> MediaAsset; null for recording-backed rows (listed as the recording). */
export function savedVideoToMediaAsset(id: string, d: any): MediaAsset | null {
  if (d?.sourceType === "recording") return null;
  const thumb = d?.thumbnailUrl || null;
  return {
    id,
    type: "video",
    source: d?.sourceType === "export" ? "export" : "upload",
    collection: "saved_videos",
    name: d?.title || "Untitled",
    duration: n(d?.durationMs) / 1000,
    fileSize: n(d?.sizeBytes),
    videoUrl: d?.playbackUrl || "",
    thumbnailUrl: thumb,
    thumbnail: thumb || "",
    createdAt: tsToIso(d?.createdAt) || new Date(0).toISOString(),
    status: String(d?.status || "ready"),
    hasVideo: true,
    hasAudio: d?.hasEmbeddedAudio !== false,
    userId: String(d?.userId || ""),
    storageKey: key(d?.storagePath) || null,
    sourceProjectId: d?.sourceProjectId ?? null,
  };
}

export function projectAssetToMediaAsset(id: string, d: any): MediaAsset {
  const type = inferMediaType(null, d?.filename || d?.storageKey);
  return {
    id,
    type,
    source: d?.type === "recording" ? "stream" : "upload",
    collection: "project_assets",
    name: d?.filename || "Asset",
    duration: n(d?.duration),
    fileSize: n(d?.size),
    videoUrl: "",
    thumbnailUrl: null,
    thumbnail: "",
    createdAt: tsToIso(d?.createdAt) || new Date(0).toISOString(),
    status: d?.processingStatus || "ready",
    hasVideo: type === "video",
    hasAudio: type !== "image",
    userId: String(d?.ownerId || ""),
    storageKey: key(d?.storageKey) || null,
  };
}

/** One list: drop deleted, de-duplicate by id (first wins), newest first. */
export function mergeMediaAssets(...lists: MediaAsset[][]): MediaAsset[] {
  const seen = new Set<string>();
  const out: MediaAsset[] = [];
  for (const list of lists) {
    for (const a of list) {
      if (!a || seen.has(a.id) || isDeletedStatus(a.status)) continue;
      seen.add(a.id);
      out.push(a);
    }
  }
  return out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** Strip server-only fields before sending to a client. */
export function publicMediaAsset(a: MediaAsset): Omit<MediaAsset, "storageKey"> {
  const { storageKey: _k, ...rest } = a;
  return rest;
}
