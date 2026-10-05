/**
 * Projects API Client — Core media-workspace access
 *
 * Calls /api/projects endpoints. Independent of editing feature flags.
 */

import { API_BASE } from "./apiBase";
import { apiFetchAuth } from "./api";
import type { MediaAsset } from "./editingApi";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  createdBy: string;
  status: "active" | "archived";
  thumbnail: string | null;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  sourceRoomId: string | null;
  sourceRoomName: string | null;
  /** Unmigrated legacy (editing_projects) project; opening it migrates it. */
  legacy?: boolean;
}

// ── Editor timeline (stored on the project, version 2, seconds) ─────────────

export interface EditorTrackDTO {
  id: string;
  name: string;
  type: "video" | "audio";
  order: number;
  isMuted: boolean;
  isSolo: boolean;
  isLocked: boolean;
}

export interface EditorClipDTO {
  id: string;
  assetId: string;
  trackId: string;
  type: "video" | "audio";
  timelineStart: number;
  timelineEnd: number;
  sourceStart: number;
  sourceEnd: number;
  linkedGroupId: string | null;
  isMuted: boolean;
  isHidden: boolean;
  displayName: string;
  /** Linear gain 0..2 (1 = unity). */
  volume: number;
  audioDetached?: boolean;
  transitionIn?: { type: 'fade' | 'dip_to_black' | 'crossfade'; durationMs: number };
}

export interface EditorTimelineDTO {
  version: 2;
  tracks: EditorTrackDTO[];
  clips: EditorClipDTO[];
}

export interface EditorProjectPayload {
  project: Project;
  timeline: EditorTimelineDTO | null;
  /** Playable media for every timeline clip and project asset, by asset id. */
  mediaAssets: Record<string, MediaAsset>;
  projectAssets: ProjectAsset[];
  migratedFrom: "editing_projects" | "timeline_clips" | null;
}

export type AssetType =
  | "recording"
  | "upload"
  | "render"
  | "clip"
  | "thumbnail"
  | "transcript";

export interface ProjectAsset {
  id: string;
  projectId: string;
  ownerId: string;
  type: AssetType;
  sourceRoomId: string | null;
  sourceRecordingId: string | null;
  filename: string;
  storageKey: string;
  duration: number | null;
  resolution: string | null;
  size: number | null;
  processingStatus: "pending" | "processing" | "ready" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface AssetDownloadResult {
  downloadUrl: string;
  filename: string;
  storageKey: string;
  status: string;
}

// ── API calls ────────────────────────────────────────────────────────────────

export async function listProjects(limit = 50): Promise<Project[]> {
  const res = await apiFetchAuth(`${API_BASE}/api/projects?limit=${limit}`);
  const data = await res.json();
  return data.projects ?? [];
}

export async function createProject(name: string): Promise<Project> {
  const res = await apiFetchAuth(`${API_BASE}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  return data.project;
}

export async function getProject(id: string): Promise<Project> {
  const res = await apiFetchAuth(`${API_BASE}/api/projects/${encodeURIComponent(id)}`);
  const data = await res.json();
  return data.project;
}

/** Project + timeline + resolved media for the editor (null when not found). */
export async function getProjectForEditor(id: string): Promise<EditorProjectPayload | null> {
  const res = await apiFetchAuth(
    `${API_BASE}/api/projects/${encodeURIComponent(id)}`,
    {},
    { allowNonOk: true },
  );
  if (!res.ok) return null;
  return res.json();
}

export async function saveProjectTimeline(
  id: string,
  timeline: { tracks: EditorTrackDTO[]; clips: EditorClipDTO[] },
): Promise<void> {
  const res = await apiFetchAuth(
    `${API_BASE}/api/projects/${encodeURIComponent(id)}/timeline`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeline: { version: 2, ...timeline } }),
    },
    { allowNonOk: true },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = err as { reason?: string; error?: string };
    throw new Error(e.reason || e.error || `Failed to save timeline (HTTP ${res.status})`);
  }
}

export async function updateProject(
  id: string,
  updates: { name?: string; status?: "active" | "archived" },
): Promise<void> {
  await apiFetchAuth(`${API_BASE}/api/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export async function deleteProject(id: string): Promise<void> {
  await apiFetchAuth(`${API_BASE}/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function listProjectAssets(
  projectId: string,
  limit = 100,
): Promise<ProjectAsset[]> {
  const res = await apiFetchAuth(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/assets?limit=${limit}`,
  );
  const data = await res.json();
  return data.assets ?? [];
}

export async function getAssetDownloadUrl(
  projectId: string,
  assetId: string,
): Promise<AssetDownloadResult> {
  const res = await apiFetchAuth(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/download`,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to get download URL" }));
    throw new Error(err.error || "Failed to get download URL");
  }
  return res.json();
}

export async function deleteProjectAsset(
  projectId: string,
  assetId: string,
): Promise<void> {
  await apiFetchAuth(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`,
    { method: "DELETE" },
  );
}

export async function uploadAssetToProject(
  projectId: string,
  file: File,
  title?: string,
): Promise<ProjectAsset> {
  const formData = new FormData();
  formData.append("video", file);
  if (title) formData.append("title", title);

  const res = await apiFetchAuth(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/assets/upload`,
    { method: "POST", body: formData },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error || "Upload failed");
  }
  const data = await res.json();
  return data.asset;
}
