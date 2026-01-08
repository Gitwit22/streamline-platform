// ============================================================================
// EDITING API SERVICE - Real Backend Integration
// All calls use real data, returns empty arrays/null when no data available
// ============================================================================

// Use Vite proxy by default (routes /api/* to localhost:5137)
import { API_BASE } from "./apiBase";

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

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('sl_token') || localStorage.getItem('auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
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
      const response = await fetch(`${API_BASE}/editing/assets`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        return [];
      }
      return handleResponse<Asset[]>(response);
    } catch (error) {
      console.error('Assets API error:', error);
      return [];
    }
  },

  async getById(id: string): Promise<Asset | null> {
    try {
      const response = await fetch(`${API_BASE}/editing/assets/${id}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        return null;
      }
      return handleResponse<Asset>(response);
    } catch (error) {
      console.error('Asset API error:', error);
      return null;
    }
  },

  async upload(file: File, onProgress?: (percent: number) => void): Promise<Asset> {
    const formData = new FormData();
    formData.append('video', file);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
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

      const token = localStorage.getItem('sl_token') || localStorage.getItem('auth_token');
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      xhr.send(formData);
    });
  },

  async delete(id: string): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/editing/assets/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error('Failed to delete asset');
      }
    } catch (error) {
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
      const response = await fetch(`${API_BASE}/editing/list`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        return [];
      }
      return handleResponse<Recording[]>(response);
    } catch (error) {
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
      const response = await fetch(`${API_BASE}/editing/recordings/${id}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        return null;
      }
      return handleResponse<Recording>(response);
    } catch (error) {
      console.error('Recording API error:', error);
      return null;
    }
  },

  async convertToAsset(recordingId: string): Promise<Asset> {
    try {
      const response = await fetch(`${API_BASE}/editing/assets/from-recording`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ recordingId }),
      });
      if (response.status === 401) {
        throw new Error('Unauthorized');
      }
      return handleResponse<Asset>(response);
    } catch (error) {
      console.warn('Convert recording failed:', error);
      throw error;
    }
  },

  async delete(id: string): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/editing/assets/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error('Failed to delete recording');
      }
    } catch (error) {
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
      const response = await fetch(`${API_BASE}/editing/projects`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        return [];
      }
      return handleResponse<Project[]>(response);
    } catch (error) {
      console.error('Projects API error:', error);
      return [];
    }
  },

  async getById(id: string): Promise<Project | null> {
    try {
      const response = await fetch(`${API_BASE}/editing/projects/${id}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        return null;
      }
      return handleResponse<Project>(response);
    } catch (error) {
      console.error('Project API error:', error);
      return null;
    }
  },

  async create(data: { name: string; assetId: string }): Promise<Project> {
    try {
      const response = await fetch(`${API_BASE}/editing/projects`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        throw new Error(`Failed to create project: HTTP ${response.status}`);
      }
      return handleResponse<Project>(response);
    } catch (error) {
      console.error('Create project failed:', error);
      throw error;
    }
  },

  async update(id: string, data: Partial<Project>): Promise<Project> {
    try {
      const response = await fetch(`${API_BASE}/editing/projects/${id}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });
      if (response.status === 401) {
        throw new Error('Unauthorized');
      }
      return handleResponse<Project>(response);
    } catch (error) {
      console.warn('Update project failed:', error);
      throw error;
    }
  },

  async saveTimeline(id: string, clips: TimelineClip[]): Promise<{ saved: boolean }> {
    try {
      const response = await fetch(`${API_BASE}/editing/projects/${id}/timeline`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ clips }),
      });
      if (!response.ok) {
        throw new Error('Failed to save timeline');
      }
      return handleResponse<{ saved: boolean }>(response);
    } catch (error) {
      console.error('Save timeline failed:', error);
      throw error;
    }
  },

  async delete(id: string): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/editing/projects/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error('Failed to delete project');
      }
    } catch (error) {
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
      const response = await fetch(`${API_BASE}/editing/export`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ projectId, settings }),
      });
      if (!response.ok) {
        throw new Error('Failed to start export');
      }
      return handleResponse<ExportJob>(response);
    } catch (error) {
      console.error('Start export failed:', error);
      throw error;
    }
  },

  async getStatus(exportId: string): Promise<ExportJob> {
    try {
      const response = await fetch(`${API_BASE}/editing/exports/${exportId}`, {
        headers: getAuthHeaders(),
      });
      if (response.status === 401) {
        throw new Error('Unauthorized');
      }
      return handleResponse<ExportJob>(response);
    } catch (error) {
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
