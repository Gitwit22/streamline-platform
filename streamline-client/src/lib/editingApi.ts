// ============================================================================
// EDITING API — content library (MediaAssets), recordings, exports
//
// Two working concepts + assets:
//   MediaAsset  GET /api/editing/assets        (recordings, uploads, saved/exported videos)
//   Project     /api/projects (lib/projectsApi.ts) — timeline lives on the project
//   SavedVideo  saved_videos — exports kept via "Save to library"
// ============================================================================

import { API_BASE } from "./apiBase";
import { apiFetchAuth, ApiUnauthorizedError } from "./api";
import { getFirebaseIdToken } from "./firebaseClient";

// ============================================================================
// TYPES
// ============================================================================

export type MediaAssetType = "video" | "audio" | "image" | "recording";

/** One item of the unified content library (any backing collection). */
export type MediaAsset = {
  id: string;
  type: MediaAssetType;
  source: "stream" | "upload" | "export";
  collection: "recordings" | "editing_assets" | "saved_videos" | "project_assets";
  name: string;
  /** Seconds (0 = unknown). */
  duration: number;
  fileSize: number;
  /** Playable (presigned) URL. */
  videoUrl: string;
  thumbnailUrl: string | null;
  thumbnail: string;
  createdAt: string;
  status: string;
  hasVideo: boolean;
  hasAudio: boolean;
  userId: string;
  roomName?: string | null;
  usageType?: "live" | "recording_only" | "live+recording" | null;
  viewerCount?: number;
  peakViewers?: number;
  streamDurationSec?: number;
  avgWatchSeconds?: number | null;
  sourceProjectId?: string | null;
};

/** Back-compat alias used by older components. */
export type Asset = MediaAsset;

export type Recording = {
  id: string;
  title: string;
  duration: number;
  thumbnailUrl?: string;
  videoUrl: string;
  roomName?: string;
  status: "processing" | "ready" | "failed";
  usageType?: "live" | "recording_only" | "live+recording";
  createdAt: string;
  fileSize?: number;
  userId?: string;
  roomId?: string;
  /** Live-session stats copied at finalize (server copyViewerStatsToRecording). */
  viewerCount?: number;
  peakViewers?: number;
  streamDurationSec?: number;
  avgWatchSeconds?: number | null;
};

/** Recording-shaped view of a `recording` MediaAsset (stream cards). */
export function mediaAssetToRecording(a: MediaAsset): Recording {
  return {
    id: a.id,
    title: a.name,
    duration: a.duration,
    thumbnailUrl: a.thumbnailUrl || undefined,
    videoUrl: a.videoUrl,
    roomName: a.roomName || undefined,
    status: (a.status === "ready" || a.status === "failed" ? a.status : "processing") as Recording["status"],
    usageType: a.usageType || undefined,
    createdAt: a.createdAt,
    fileSize: a.fileSize,
    userId: a.userId,
    viewerCount: a.viewerCount,
    peakViewers: a.peakViewers,
    streamDurationSec: a.streamDurationSec,
    avgWatchSeconds: a.avgWatchSeconds ?? null,
  };
}

export type ExportResolution = "720p" | "1080p" | "4k";
export type ExportFormat = "mp4" | "webm" | "mov";
export type ExportQuality = "draft" | "standard" | "high";
export type ExportFps = 24 | 30 | 60;

export type ExportSettings = {
  resolution: ExportResolution;
  format: ExportFormat;
  quality?: ExportQuality;
  fps?: ExportFps;
};

/** What the user's plan allows (GET /api/editing/export-options). */
export type ExportOptions = {
  resolutions: ExportResolution[];
  /** null = no cap */
  maxResolution: ExportResolution | null;
  formats: ExportFormat[];
  qualities: ExportQuality[];
  fpsOptions: ExportFps[];
  exportsUsed: number;
  /** null = unlimited, 0 = none */
  exportsLimit: number | null;
  priority: boolean;
  /** Transition tiers the plan includes (absent on older servers = all). */
  transitions?: { basic: boolean; advanced: boolean };
};

export type ExportJob = {
  id: string;
  projectId?: string;
  status: "queued" | "preparing" | "rendering" | "uploading" | "completed" | "failed" | "canceled";
  progress: number;
  progressPercent?: number;
  currentStep?: string;
  downloadUrl?: string;
  outputUrl?: string;
  outputExpired?: boolean;
  savedVideoId?: string | null;
  error?: string;
  attemptCount?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

/** Statuses that indicate a job is finished (no more polling needed). */
export const EXPORT_TERMINAL_STATUSES: ExportJob["status"][] = [
  "completed", "failed", "canceled",
];

export type UploadResult = {
  ok: boolean;
  assetId: string;
  asset?: MediaAsset;
  publicUrl?: string;
};

// ============================================================================
// AUTH HELPERS
// ============================================================================

function isUnauthorizedError(err: unknown): boolean {
  return (
    err instanceof ApiUnauthorizedError ||
    (!!err && typeof err === "object" && (err as any).name === "ApiUnauthorizedError")
  );
}

function emitUnauthorizedEventOnce(detail?: string) {
  if (typeof window === "undefined") return;
  const w = window as any;
  const now = Date.now();
  if (typeof w.__sl_last_unauthorized_event_ts === "number" && now - w.__sl_last_unauthorized_event_ts < 2000) {
    return;
  }
  w.__sl_last_unauthorized_event_ts = now;
  try {
    window.dispatchEvent(new CustomEvent("sl:unauthorized", { detail: { reason: detail || "unauthorized" } }));
  } catch {
    // ignore
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const error = await response.json();
        errorMessage = error.reason || error.message || error.error || errorMessage;
      }
    } catch {
      // Response is not JSON, use status code message
    }
    throw new Error(errorMessage);
  }
  return response.json();
}

// ============================================================================
// MEDIA ASSETS API
// ============================================================================

export const assetsApi = {
  /** Unified content library: recordings + uploads + saved/exported videos. */
  async list(): Promise<MediaAsset[]> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/assets`, {}, { allowNonOk: true });
      if (!response.ok) return [];
      return handleResponse<MediaAsset[]>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Assets API error:', error);
      return [];
    }
  },

  async getById(id: string): Promise<MediaAsset | null> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/assets/${encodeURIComponent(id)}`, {}, { allowNonOk: true });
      if (!response.ok) return null;
      return handleResponse<MediaAsset>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Asset API error:', error);
      return null;
    }
  },

  /** Upload a video / audio / image file to the content library. */
  async upload(file: File, onProgress?: (percent: number) => void): Promise<UploadResult> {
    const formData = new FormData();
    formData.append('video', file);

    return new Promise((resolve, reject) => {
      const getLegacyToken = (): string | null => {
        try {
          return localStorage.getItem("authToken");
        } catch {
          return null;
        }
      };

      const getBestBearerToken = async (opts?: { forceRefresh?: boolean }): Promise<{ token: string; usedFirebase: boolean } | null> => {
        const firebaseIdToken = await getFirebaseIdToken({ forceRefresh: !!opts?.forceRefresh });
        if (firebaseIdToken) return { token: firebaseIdToken, usedFirebase: true };
        const legacy = getLegacyToken();
        if (legacy) return { token: legacy, usedFirebase: false };
        return null;
      };

      const doUpload = async (opts?: { retry401?: boolean; forceRefresh?: boolean }) => {
        const bearer = await getBestBearerToken({ forceRefresh: !!opts?.forceRefresh });
        if (!bearer?.token) {
          emitUnauthorizedEventOnce("missing_or_invalid_token");
          reject(new ApiUnauthorizedError());
          return;
        }

        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable && onProgress) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.addEventListener('load', async () => {
          if (xhr.status === 401 && bearer.usedFirebase && opts?.retry401) {
            await doUpload({ retry401: false, forceRefresh: true });
            return;
          }

          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              reject(new Error('Invalid response'));
            }
          } else {
            let message = `Upload failed: ${xhr.status}`;
            try {
              const body = JSON.parse(xhr.responseText);
              message = body?.error || body?.details || message;
            } catch { /* not JSON */ }
            reject(new Error(message));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Upload failed')));

        xhr.open('POST', `${API_BASE}/api/editing/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${bearer.token}`);
        xhr.send(formData);
      };

      void doUpload({ retry401: true, forceRefresh: false });
    });
  },

  /** Delete a recording, uploaded asset or saved video (owner cleanup). */
  async delete(id: string): Promise<void> {
    const response = await apiFetchAuth(`${API_BASE}/api/editing/assets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }, { allowNonOk: true });
    if (!response.ok) {
      throw new Error('Failed to delete asset');
    }
  },
};

// ============================================================================
// RECORDINGS API
// ============================================================================

export const recordingsApi = {
  async getById(id: string): Promise<Recording | null> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/recordings/${encodeURIComponent(id)}`, {}, { allowNonOk: true });
      if (!response.ok) {
        return null;
      }
      return handleResponse<Recording>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Recording API error:', error);
      return null;
    }
  },
};

// ============================================================================
// EXPORT API
// ============================================================================

export const exportApi = {
  async start(projectId: string, settings: ExportSettings): Promise<ExportJob> {
    const response = await apiFetchAuth(`${API_BASE}/api/editing/export`, {
      method: 'POST',
      body: JSON.stringify({ projectId, settings }),
    }, { allowNonOk: true });
    return handleResponse<ExportJob>(response);
  },

  async getOptions(): Promise<ExportOptions> {
    const response = await apiFetchAuth(`${API_BASE}/api/editing/export-options`, {}, { allowNonOk: true });
    return handleResponse<ExportOptions>(response);
  },

  async getStatus(exportId: string): Promise<ExportJob> {
    const response = await apiFetchAuth(`${API_BASE}/api/editing/exports/${encodeURIComponent(exportId)}`, {}, { allowNonOk: true });
    return handleResponse<ExportJob>(response);
  },

  async waitForComplete(
    exportId: string,
    onProgress?: (job: ExportJob) => void,
    pollInterval = 2000
  ): Promise<ExportJob> {
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const job = await this.getStatus(exportId);

          if (onProgress) {
            onProgress(job);
          }

          if (job.status === 'completed') {
            resolve(job);
          } else if (job.status === 'failed') {
            reject(new Error(job.error || 'Export failed'));
          } else if (job.status === 'canceled') {
            reject(new Error('Export was canceled'));
          } else {
            setTimeout(poll, pollInterval);
          }
        } catch (error) {
          reject(error);
        }
      };

      poll();
    });
  },

  async cancel(exportId: string): Promise<void> {
    const response = await apiFetchAuth(`${API_BASE}/api/editing/exports/${encodeURIComponent(exportId)}/cancel`, {
      method: 'POST',
    }, { allowNonOk: true });
    if (!response.ok) {
      throw new Error('Failed to cancel export');
    }
  },

  /** Keep a completed export as a saved video in the content library. */
  async saveToLibrary(exportId: string, title?: string): Promise<{ savedVideoId: string; asset: MediaAsset | null }> {
    const response = await apiFetchAuth(`${API_BASE}/api/editing/exports/${encodeURIComponent(exportId)}/save-to-library`, {
      method: 'POST',
      body: JSON.stringify(title ? { title } : {}),
    }, { allowNonOk: true });
    return handleResponse<{ savedVideoId: string; asset: MediaAsset | null }>(response);
  },
};

// ============================================================================
// UNIFIED API EXPORT
// ============================================================================

export const editingApi = {
  // Media assets (content library)
  getMediaAssets: () => assetsApi.list(),
  getAsset: (id: string) => assetsApi.getById(id),
  uploadAsset: (file: File, onProgress?: (p: number) => void) => assetsApi.upload(file, onProgress),
  deleteAsset: (id: string) => assetsApi.delete(id),

  // Recordings
  getRecording: (id: string) => recordingsApi.getById(id),

  // Export
  getExportOptions: () => exportApi.getOptions(),
  startExport: (projectId: string, settings: ExportSettings) => exportApi.start(projectId, settings),
  getExportStatus: (id: string) => exportApi.getStatus(id),
  waitForExport: (id: string, onProgress?: (job: ExportJob) => void) =>
    exportApi.waitForComplete(id, onProgress),
  cancelExport: (id: string) => exportApi.cancel(id),
  saveExportToLibrary: (id: string, title?: string) => exportApi.saveToLibrary(id, title),
};

export default editingApi;
