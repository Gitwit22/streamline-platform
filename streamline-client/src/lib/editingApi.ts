// ============================================================================
// EDITING API SERVICE - Real Backend Integration
// All calls use real data, returns empty arrays/null when no data available
// ============================================================================

// Use Vite proxy by default (routes /api/* to localhost:5137)
import { API_BASE } from "./apiBase";
import { apiFetchAuth, ApiUnauthorizedError } from "./api";
import { getFirebaseIdToken } from "./firebaseClient";

// ============================================================================
// TYPES
// ============================================================================

export type Asset = {
  id: string;
  name: string;
  duration: number;
  source: "stream" | "upload";
  thumbnail: string;
  videoUrl?: string;
  fileSize?: number;
  createdAt: string;
  userId?: string;
};

export type Project = {
  id: string;
  name: string;
  assetId: string;
  status: "draft" | "rendering" | "complete";
  lastModified: string;
  duration: number;
  thumbnail?: string;
  userId?: string;
  timeline?: TimelineData;
  projectId?: string;           // new `projects` collection ID (when bridged)
  migrated?: boolean;           // true when sourced from the new projects collection
  sourceCollection?: "projects" | "editing_projects";
};

export type TimelineClip = {
  id: string;
  assetId: string;
  trackId: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  name: string;
  videoUrl: string;
};

export type TimelineTrack = {
  id: string;
  name: string;
  type: 'video' | 'audio';
  muted: boolean;
  locked: boolean;
  solo: boolean;
  linkedTrackId: string | null;
};

export type TimelineData = {
  clips: TimelineClip[];
  tracks: TimelineTrack[] | number;
};

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
};

export type ExportSettings = {
  resolution: "720p" | "1080p" | "4k";
  format: "mp4" | "webm" | "mov";
  quality?: "draft" | "standard" | "high";
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

// ============================================================================
// PLAN INFO TYPES
// ============================================================================

export type EditingPlanInfo = {
  planId: string;
  access: boolean;
  maxProjects: number;
  currentProjects: number;
  maxStorageGB: number;
  maxTracks: number | null;
  maxResolution: string | null;
};

// ============================================================================
// PROCESSING JOB TYPES
// ============================================================================

export type ProcessingJobType = "thumbnail" | "waveform" | "transcription";
export type ProcessingJobStatus = "queued" | "processing" | "completed" | "failed";

export type ProcessingJob = {
  id: string;
  userId: string;
  projectId: string;
  assetId: string;
  type: ProcessingJobType;
  status: ProcessingJobStatus;
  progressPercent: number;
  currentStep: string | null;
  errorMessage: string | null;
  outputUrl: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
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
        errorMessage = error.message || errorMessage;
      }
    } catch {
      // Response is not JSON, use status code message
    }
    throw new Error(errorMessage);
  }
  return response.json();
}

// ============================================================================
// ASSETS API
// ============================================================================

export const assetsApi = {
  async getAll(): Promise<Asset[]> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/assets`, {}, { allowNonOk: true });
      if (!response.ok) {
        return [];
      }
      return handleResponse<Asset[]>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Assets API error:', error);
      return [];
    }
  },

  async getById(id: string): Promise<Asset | null> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/assets/${id}`, {}, { allowNonOk: true });
      if (!response.ok) {
        return null;
      }
      return handleResponse<Asset>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Asset API error:', error);
      return null;
    }
  },

  async upload(file: File, onProgress?: (percent: number) => void): Promise<Asset> {
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
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Upload failed')));

        xhr.open('POST', `${API_BASE}/api/editing/assets/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${bearer.token}`);
        xhr.send(formData);
      };

      void doUpload({ retry401: true, forceRefresh: false });
    });
  },

  async delete(id: string): Promise<void> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/assets/${id}`, {
        method: 'DELETE',
      }, { allowNonOk: true });
      if (!response.ok) {
        throw new Error('Failed to delete asset');
      }
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Delete asset failed:', error);
      throw error;
    }
  }
};

// ============================================================================
// RECORDINGS API
// ============================================================================

export const recordingsApi = {
  async getAll(): Promise<Recording[]> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/list`, {}, { allowNonOk: true });
      if (!response.ok) {
        return [];
      }
      return handleResponse<Recording[]>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Recordings API error:', error);
      return [];
    }
  },

  async getReady(): Promise<Recording[]> {
    const all = await this.getAll();
    return all.filter((r) => r.status === 'ready');
  },

  async getById(id: string): Promise<Recording | null> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/recordings/${id}`, {}, { allowNonOk: true });
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

  async convertToAsset(recordingId: string): Promise<Asset> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/assets/from-recording`, {
        method: 'POST',
        body: JSON.stringify({ recordingId }),
      }, { allowNonOk: true });
      return handleResponse<Asset>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.warn('Convert recording failed:', error);
      throw error;
    }
  },

  async delete(id: string): Promise<void> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/assets/${id}`, { method: 'DELETE' }, { allowNonOk: true });
      if (!response.ok) {
        throw new Error('Failed to delete recording');
      }
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Delete recording failed:', error);
      throw error;
    }
  },
};

// ============================================================================
// PROJECTS API
// ============================================================================

export const projectsApi = {
  async getAll(): Promise<Project[]> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/projects`, {}, { allowNonOk: true });
      if (!response.ok) {
        return [];
      }
      return handleResponse<Project[]>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Projects API error:', error);
      return [];
    }
  },

  async getById(id: string): Promise<Project | null> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/projects/${id}`, {}, { allowNonOk: true });
      if (!response.ok) {
        return null;
      }
      return handleResponse<Project>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Project API error:', error);
      return null;
    }
  },

  async create(data: { name: string; assetId?: string }): Promise<Project> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/projects`, {
        method: 'POST',
        body: JSON.stringify(data),
      }, { allowNonOk: true });
      if (!response.ok) {
        throw new Error(`Failed to create project: HTTP ${response.status}`);
      }
      return handleResponse<Project>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Create project failed:', error);
      throw error;
    }
  },

  async update(id: string, data: Partial<Project>): Promise<Project> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }, { allowNonOk: true });
      return handleResponse<Project>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.warn('Update project failed:', error);
      throw error;
    }
  },

  async saveTimeline(id: string, clips: TimelineClip[], tracks?: TimelineTrack[]): Promise<{ saved: boolean }> {
    try {
      const body: { clips: TimelineClip[]; tracks?: TimelineTrack[] } = { clips };
      if (tracks) {
        body.tracks = tracks;
      }
      const response = await apiFetchAuth(`${API_BASE}/api/editing/projects/${id}/timeline`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }, { allowNonOk: true });
      if (!response.ok) {
        throw new Error('Failed to save timeline');
      }
      return handleResponse<{ saved: boolean }>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Save timeline failed:', error);
      throw error;
    }
  },

  async delete(id: string): Promise<void> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/projects/${id}`, { method: 'DELETE' }, { allowNonOk: true });
      if (!response.ok) {
        throw new Error('Failed to delete project');
      }
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Delete project failed:', error);
      throw error;
    }
  },

  async duplicate(id: string): Promise<Project> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/projects/${id}/duplicate`, {
        method: 'POST',
      }, { allowNonOk: true });
      if (!response.ok) {
        throw new Error(`Failed to duplicate project: HTTP ${response.status}`);
      }
      return handleResponse<Project>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Duplicate project failed:', error);
      throw error;
    }
  },
};

// ============================================================================
// EXPORT API
// ============================================================================

export const exportApi = {
  async start(projectId: string, settings: ExportSettings): Promise<ExportJob> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/export`, {
        method: 'POST',
        body: JSON.stringify({ projectId, settings }),
      }, { allowNonOk: true });
      if (!response.ok) {
        throw new Error('Failed to start export');
      }
      return handleResponse<ExportJob>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Start export failed:', error);
      throw error;
    }
  },

  async getStatus(exportId: string): Promise<ExportJob> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/exports/${exportId}`, {}, { allowNonOk: true });
      return handleResponse<ExportJob>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.warn('Get export status failed:', error);
      throw error;
    }
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
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/exports/${exportId}/cancel`, {
        method: 'POST',
      }, { allowNonOk: true });
      if (!response.ok) {
        throw new Error('Failed to cancel export');
      }
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Cancel export failed:', error);
      throw error;
    }
  },
};

// ============================================================================
// PLAN INFO API
// ============================================================================

export const planInfoApi = {
  async get(): Promise<EditingPlanInfo | null> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/plan-info`, {}, { allowNonOk: true });
      if (!response.ok) return null;
      return handleResponse<EditingPlanInfo>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Plan info API error:', error);
      return null;
    }
  },
};

// ============================================================================
// PROCESSING API
// ============================================================================

export const processingApi = {
  async getJob(jobId: string): Promise<ProcessingJob | null> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/processing/${jobId}`, {}, { allowNonOk: true });
      if (!response.ok) return null;
      return handleResponse<ProcessingJob>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Processing job API error:', error);
      return null;
    }
  },

  async listForProject(projectId: string): Promise<ProcessingJob[]> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/projects/${projectId}/processing`, {}, { allowNonOk: true });
      if (!response.ok) return [];
      return handleResponse<ProcessingJob[]>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Processing list API error:', error);
      return [];
    }
  },
};

// ============================================================================
// CONTENT ITEMS API
// ============================================================================

export type ContentItem = {
  id: string;
  userId: string;
  sourceType: "recording";
  sourceId: string;
  title: string;
  kind: "video";
  playbackUrl: string;
  thumbnailUrl: string;
  durationMs: number;
  roomName: string;
  status: string;
  createdAt: string;
};

export const contentItemsApi = {
  async list(): Promise<ContentItem[]> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/editing/content-items`, {}, { allowNonOk: true });
      if (!response.ok) return [];
      const data = await handleResponse<{ items: ContentItem[] }>(response);
      return data.items;
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Content items API error:', error);
      return [];
    }
  },

  async addFromRecording(recordingId: string): Promise<ContentItem> {
    const response = await apiFetchAuth(`${API_BASE}/api/editing/content-items`, {
      method: 'POST',
      body: JSON.stringify({ recordingId }),
    }, { allowNonOk: true });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).error || `Failed to add content item: HTTP ${response.status}`);
    }
    return handleResponse<ContentItem>(response);
  },

  async remove(id: string): Promise<void> {
    const response = await apiFetchAuth(`${API_BASE}/api/editing/content-items/${id}`, {
      method: 'DELETE',
    }, { allowNonOk: true });
    if (!response.ok) {
      throw new Error('Failed to remove content item');
    }
  },
};

// ============================================================================
// 3-LAYER DATA ARCHITECTURE TYPES
// ============================================================================

/** Layer 1 — SavedVideo (My Content) */
export type SavedVideo = {
  id: string;
  userId: string;
  title: string;
  sourceType: "recording" | "upload";
  sourceId?: string;
  playbackUrl: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
  durationMs: number;
  sizeBytes: number;
  hasEmbeddedAudio: boolean;
  status: "processing" | "ready" | "failed";
  createdAt: string;
};

/** Layer 2 — ProjectAsset (link record connecting SavedVideo to Project) */
export type ProjectAssetRecord = {
  id: string;
  projectId: string;
  savedVideoId: string;
  sourceInMs: number;
  sourceOutMs: number;
  mode: "full" | "subclip";
  createdAt: string;
  savedVideo?: Partial<SavedVideo> | null;
};

/** Layer 3 — TimelineClipRecord (placed instance on the timeline) */
export type TimelineClipRecord = {
  id: string;
  projectId: string;
  projectAssetId: string;
  trackId: string;
  kind: "video" | "audio";
  startMs: number;
  endMs: number;
  trimInMs: number;
  trimOutMs: number;
  linkGroupId: string | null;
  lane: number;
  createdAt: string;
};

/** Recording from the library endpoint */
export type LibraryRecording = {
  id: string;
  title: string;
  roomName: string | null;
  status: string;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  duration: number;
  fileSize: number | null;
  createdAt: string | null;
};

// ============================================================================
// MY CONTENT API (Layer 1 — SavedVideo)
// ============================================================================

export const myContentApi = {
  /** List user's saved videos */
  async list(): Promise<SavedVideo[]> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/my-content`, {}, { allowNonOk: true });
      if (!response.ok) return [];
      return handleResponse<SavedVideo[]>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('My Content list error:', error);
      return [];
    }
  },

  /** Delete a saved video */
  async remove(id: string): Promise<void> {
    const response = await apiFetchAuth(`${API_BASE}/api/my-content/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }, { allowNonOk: true });
    if (!response.ok) throw new Error('Failed to delete saved video');
  },

  /** Batch create SavedVideos from recording IDs */
  async fromRecordings(recordingIds: string[]): Promise<{ created: SavedVideo[]; errors: any[] }> {
    const response = await apiFetchAuth(`${API_BASE}/api/my-content/from-recordings`, {
      method: 'POST',
      body: JSON.stringify({ recordingIds }),
    }, { allowNonOk: true });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).error || `Failed to import recordings: HTTP ${response.status}`);
    }
    return handleResponse<{ created: SavedVideo[]; errors: any[] }>(response);
  },

  /** Upload a video file from device */
  async upload(file: File, onProgress?: (percent: number) => void): Promise<SavedVideo> {
    const token = await getFirebaseIdToken();
    const formData = new FormData();
    formData.append('video', file);
    formData.append('title', file.name.replace(/\.[^/.]+$/, ''));

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api/my-content/upload`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error(`Upload failed: HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed: network error'));
      xhr.send(formData);
    });
  },
};

// ============================================================================
// RECORDINGS LIBRARY API
// ============================================================================

export const recordingsLibraryApi = {
  /** List ready platform recordings for import into My Content */
  async list(): Promise<LibraryRecording[]> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/recordings/library`, {}, { allowNonOk: true });
      if (!response.ok) return [];
      return handleResponse<LibraryRecording[]>(response);
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Recordings library error:', error);
      return [];
    }
  },
};

// ============================================================================
// PROJECT ASSETS API (Layer 2 — ProjectAsset)
// ============================================================================

export const projectAssetsApi = {
  /** Create a project asset linking a saved video to a project */
  async create(projectId: string, data: {
    savedVideoId: string;
    mode?: "full" | "subclip";
    sourceInMs?: number;
    sourceOutMs?: number;
  }): Promise<ProjectAssetRecord> {
    const response = await apiFetchAuth(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/assets`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, { allowNonOk: true });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).error || `Failed to create project asset: HTTP ${response.status}`);
    }
    return handleResponse<ProjectAssetRecord>(response);
  },

  /** List all project assets for a project */
  async list(projectId: string): Promise<ProjectAssetRecord[]> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/assets`, {}, { allowNonOk: true });
      if (!response.ok) return [];
      const data = await handleResponse<{ assets: ProjectAssetRecord[] }>(response);
      return data.assets;
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Project assets list error:', error);
      return [];
    }
  },

  /** Detach an asset from a project */
  async remove(projectId: string, assetId: string): Promise<void> {
    const response = await apiFetchAuth(
      `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`,
      { method: 'DELETE' },
      { allowNonOk: true },
    );
    if (!response.ok) throw new Error('Failed to remove project asset');
  },
};

// ============================================================================
// TIMELINE CLIPS API (Layer 3 — TimelineClip)
// ============================================================================

export const timelineClipsApi = {
  /** Create a linked video+audio clip pair on the timeline */
  async create(projectId: string, data: {
    projectAssetId: string;
    startMs?: number;
  }): Promise<{ videoClip: TimelineClipRecord; audioClip: TimelineClipRecord; linkGroupId: string }> {
    const response = await apiFetchAuth(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/timeline/clips`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, { allowNonOk: true });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).error || `Failed to create timeline clips: HTTP ${response.status}`);
    }
    return handleResponse<{ videoClip: TimelineClipRecord; audioClip: TimelineClipRecord; linkGroupId: string }>(response);
  },

  /** List all timeline clips for a project */
  async list(projectId: string): Promise<TimelineClipRecord[]> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/timeline/clips`, {}, { allowNonOk: true });
      if (!response.ok) return [];
      const data = await handleResponse<{ clips: TimelineClipRecord[] }>(response);
      return data.clips;
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Timeline clips list error:', error);
      return [];
    }
  },

  /** Update a timeline clip (trim, move, unlink) */
  async update(projectId: string, clipId: string, data: {
    startMs?: number;
    endMs?: number;
    trimInMs?: number;
    trimOutMs?: number;
    trackId?: string;
    lane?: number;
    unlink?: boolean;
  }): Promise<void> {
    const response = await apiFetchAuth(
      `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/timeline/clips/${encodeURIComponent(clipId)}`,
      { method: 'PATCH', body: JSON.stringify(data) },
      { allowNonOk: true },
    );
    if (!response.ok) throw new Error('Failed to update timeline clip');
  },

  /** Delete a timeline clip (and linked partner if linked) */
  async remove(projectId: string, clipId: string): Promise<void> {
    const response = await apiFetchAuth(
      `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/timeline/clips/${encodeURIComponent(clipId)}`,
      { method: 'DELETE' },
      { allowNonOk: true },
    );
    if (!response.ok) throw new Error('Failed to delete timeline clip');
  },
};

// ============================================================================
// UNIFIED API EXPORT
// ============================================================================

export const editingApi = {
  // Assets
  getAssets: () => assetsApi.getAll(),
  getAsset: (id: string) => assetsApi.getById(id),
  uploadAsset: (file: File, onProgress?: (p: number) => void) => assetsApi.upload(file, onProgress),
  deleteAsset: (id: string) => assetsApi.delete(id),

  // Recordings
  getRecordings: () => recordingsApi.getAll(),
  getReadyRecordings: () => recordingsApi.getReady(),
  getRecording: (id: string) => recordingsApi.getById(id),
  deleteRecording: (id: string) => recordingsApi.delete(id),
  convertRecordingToAsset: (id: string) => recordingsApi.convertToAsset(id),

  // Projects
  getProjects: () => projectsApi.getAll(),
  getProject: (id: string) => projectsApi.getById(id),
  createProject: (data: { name: string; assetId?: string }) => projectsApi.create(data),
  updateProject: (id: string, data: Partial<Project>) => projectsApi.update(id, data),
  saveTimeline: (id: string, clips: TimelineClip[], tracks?: TimelineTrack[]) => projectsApi.saveTimeline(id, clips, tracks),
  deleteProject: (id: string) => projectsApi.delete(id),
  duplicateProject: (id: string) => projectsApi.duplicate(id),

  // Export
  startExport: (projectId: string, settings: ExportSettings) => exportApi.start(projectId, settings),
  getExportStatus: (id: string) => exportApi.getStatus(id),
  waitForExport: (id: string, onProgress?: (job: ExportJob) => void) =>
    exportApi.waitForComplete(id, onProgress),
  cancelExport: (id: string) => exportApi.cancel(id),

  // Plan Info
  getPlanInfo: () => planInfoApi.get(),

  // Processing
  getProcessingJob: (id: string) => processingApi.getJob(id),
  getProjectProcessing: (projectId: string) => processingApi.listForProject(projectId),

  // Content Items
  getContentItems: () => contentItemsApi.list(),
  addContentItem: (recordingId: string) => contentItemsApi.addFromRecording(recordingId),
  removeContentItem: (id: string) => contentItemsApi.remove(id),

  // My Content (Layer 1 — SavedVideo)
  getMyContent: () => myContentApi.list(),
  deleteMyContent: (id: string) => myContentApi.remove(id),
  importRecordings: (ids: string[]) => myContentApi.fromRecordings(ids),
  uploadToMyContent: (file: File, onProgress?: (p: number) => void) => myContentApi.upload(file, onProgress),

  // Recordings Library
  getRecordingsLibrary: () => recordingsLibraryApi.list(),

  // Project Assets (Layer 2 — ProjectAsset)
  createProjectAsset: (projectId: string, data: { savedVideoId: string; mode?: "full" | "subclip"; sourceInMs?: number; sourceOutMs?: number }) =>
    projectAssetsApi.create(projectId, data),
  listProjectAssets: (projectId: string) => projectAssetsApi.list(projectId),
  removeProjectAsset: (projectId: string, assetId: string) => projectAssetsApi.remove(projectId, assetId),

  // Timeline Clips (Layer 3 — TimelineClip)
  createTimelineClips: (projectId: string, data: { projectAssetId: string; startMs?: number }) =>
    timelineClipsApi.create(projectId, data),
  listTimelineClips: (projectId: string) => timelineClipsApi.list(projectId),
  updateTimelineClip: (projectId: string, clipId: string, data: any) =>
    timelineClipsApi.update(projectId, clipId, data),
  removeTimelineClip: (projectId: string, clipId: string) => timelineClipsApi.remove(projectId, clipId),
};

export default editingApi;
