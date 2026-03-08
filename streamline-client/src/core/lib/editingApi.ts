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
};

export type TimelineClip = {
  id: string;
  assetId: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  name: string;
  videoUrl: string;
};

export type TimelineData = {
  clips: TimelineClip[];
  tracks: number;
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
  projectId: string;
  status: "queued" | "processing" | "complete" | "failed";
  progress: number;
  downloadUrl?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
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
      const response = await apiFetchAuth(`${API_BASE}/editing/assets`, {}, { allowNonOk: true });
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
      const response = await apiFetchAuth(`${API_BASE}/editing/assets/${id}`, {}, { allowNonOk: true });
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

        xhr.open('POST', `${API_BASE}/editing/assets/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${bearer.token}`);
        xhr.send(formData);
      };

      void doUpload({ retry401: true, forceRefresh: false });
    });
  },

  async delete(id: string): Promise<void> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/editing/assets/${id}`, {
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
      const response = await apiFetchAuth(`${API_BASE}/editing/list`, {}, { allowNonOk: true });
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
      const response = await apiFetchAuth(`${API_BASE}/editing/recordings/${id}`, {}, { allowNonOk: true });
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
      const response = await apiFetchAuth(`${API_BASE}/editing/assets/from-recording`, {
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
      const response = await apiFetchAuth(`${API_BASE}/editing/assets/${id}`, { method: 'DELETE' }, { allowNonOk: true });
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
      const response = await apiFetchAuth(`${API_BASE}/editing/projects`, {}, { allowNonOk: true });
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
      const response = await apiFetchAuth(`${API_BASE}/editing/projects/${id}`, {}, { allowNonOk: true });
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

  async create(data: { name: string; assetId: string }): Promise<Project> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/editing/projects`, {
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
      const response = await apiFetchAuth(`${API_BASE}/editing/projects/${id}`, {
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

  async saveTimeline(id: string, clips: TimelineClip[]): Promise<{ saved: boolean }> {
    try {
      const response = await apiFetchAuth(`${API_BASE}/editing/projects/${id}/timeline`, {
        method: 'PUT',
        body: JSON.stringify({ clips }),
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
      const response = await apiFetchAuth(`${API_BASE}/editing/projects/${id}`, { method: 'DELETE' }, { allowNonOk: true });
      if (!response.ok) {
        throw new Error('Failed to delete project');
      }
    } catch (error) {
      if (isUnauthorizedError(error)) throw error;
      console.error('Delete project failed:', error);
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
      const response = await apiFetchAuth(`${API_BASE}/editing/export`, {
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
      const response = await apiFetchAuth(`${API_BASE}/editing/exports/${exportId}`, {}, { allowNonOk: true });
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

          if (job.status === 'complete') {
            resolve(job);
          } else if (job.status === 'failed') {
            reject(new Error(job.error || 'Export failed'));
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
  createProject: (data: { name: string; assetId: string }) => projectsApi.create(data),
  updateProject: (id: string, data: Partial<Project>) => projectsApi.update(id, data),
  saveTimeline: (id: string, clips: TimelineClip[]) => projectsApi.saveTimeline(id, clips),
  deleteProject: (id: string) => projectsApi.delete(id),

  // Export
  startExport: (projectId: string, settings: ExportSettings) => exportApi.start(projectId, settings),
  getExportStatus: (id: string) => exportApi.getStatus(id),
  waitForExport: (id: string, onProgress?: (job: ExportJob) => void) =>
    exportApi.waitForComplete(id, onProgress),
};

export default editingApi;
