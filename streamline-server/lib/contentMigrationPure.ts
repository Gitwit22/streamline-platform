/**
 * Content consolidation (Stage 6b) — pure mapping for the controlled
 * migration from five content models to two working concepts:
 *
 *   Project    = `projects` (+ `timeline` v2 on the project doc)
 *                <- editing_projects (+ its timeline), Layer 3 timeline_clips
 *   SavedVideo = `saved_videos` (finalized / exported videos)
 *                <- content_items (recording references), export outputs
 *
 * Nothing here deletes data. Legacy docs are only stamped
 * (`migratedToProjectId` / `migratedToSavedVideoId`) so reads stop falling
 * back to them and re-runs are no-ops.
 */
import {
  EDITOR_TIMELINE_VERSION,
  defaultEditorTracks,
  layeredClipsToEditor,
  legacyTimelineToEditor,
  type EditorTimeline,
} from "./editorTimeline";

export const LEGACY_EDITING_PROJECTS = "editing_projects";

export type EditingProjectMigrationAction = "skip_already_migrated" | "skip_no_owner" | "create_project" | "migrate_into_linked";

export interface EditingProjectMigrationStep {
  action: EditingProjectMigrationAction;
  /** projects/{targetProjectId}: the linked project, or the same id as the legacy doc. */
  targetProjectId: string;
  ownerId: string;
  /** Full projects doc when the target does not exist yet. */
  projectCreate: Record<string, any> | null;
  timeline: EditorTimeline | null;
  legacyPatch: Record<string, any> | null;
}

/**
 * Plan the migration of one editing_projects doc.
 * - linked doc (data.projectId)  -> timeline goes onto projects/{projectId}
 * - standalone doc               -> projects/{sameId} is created (URLs keep working)
 * An empty legacy timeline with an `assetId` (old "new project from asset")
 * is seeded with one clip of that asset, as the old editor did on open.
 */
export function planEditingProjectMigration(
  editingId: string,
  data: Record<string, any>,
  now: Date,
  opts: { seedAssetDurationSec?: number } = {},
): EditingProjectMigrationStep {
  const ownerId = typeof data?.userId === "string" ? data.userId : "";
  const linked = typeof data?.projectId === "string" && data.projectId.trim() ? data.projectId.trim() : "";
  const targetProjectId = linked || editingId;
  const base = { targetProjectId, ownerId };

  if (typeof data?.migratedToProjectId === "string" && data.migratedToProjectId) {
    return { ...base, targetProjectId: data.migratedToProjectId, action: "skip_already_migrated", projectCreate: null, timeline: null, legacyPatch: null };
  }
  if (!ownerId) {
    return { ...base, action: "skip_no_owner", projectCreate: null, timeline: null, legacyPatch: null };
  }

  let timeline: EditorTimeline | null = data?.timeline ? legacyTimelineToEditor(data.timeline) : null;
  const seedAsset = typeof data?.assetId === "string" ? data.assetId.trim() : "";
  if ((!timeline || timeline.clips.length === 0) && seedAsset) {
    const dur = opts.seedAssetDurationSec && opts.seedAssetDurationSec > 0
      ? opts.seedAssetDurationSec
      : Number(data?.duration) > 0 ? Number(data.duration) : 60;
    timeline = {
      version: EDITOR_TIMELINE_VERSION,
      tracks: timeline?.tracks?.length ? timeline.tracks : defaultEditorTracks(),
      clips: [{
        id: `clip_${editingId}_seed`,
        assetId: seedAsset,
        trackId: (timeline?.tracks || defaultEditorTracks()).find((t) => t.type === "video")?.id || "video_1",
        type: "video",
        timelineStart: 0,
        timelineEnd: dur,
        sourceStart: 0,
        sourceEnd: dur,
        linkedGroupId: null,
        isMuted: false,
        isHidden: false,
        displayName: String(data?.name || "Video").slice(0, 200),
        volume: 1,
      }],
    };
  }

  const projectCreate = {
    ownerId,
    name: String(data?.name || "Untitled Project").slice(0, 200),
    createdBy: ownerId,
    status: data?.status === "archived" ? "archived" : "active",
    thumbnail: data?.thumbnail || data?.thumbnailUrl || null,
    createdAt: data?.createdAt ?? now,
    updatedAt: data?.updatedAt ?? now,
    assetCount: 0,
    sourceRoomId: null,
    sourceRoomName: null,
    migratedFrom: { collection: LEGACY_EDITING_PROJECTS, id: editingId },
  };

  return {
    ...base,
    action: linked ? "migrate_into_linked" : "create_project",
    projectCreate,
    timeline,
    legacyPatch: { migratedToProjectId: targetProjectId, migratedAt: now },
  };
}

/** Layer 3 (timeline_clips + editing_project_assets) -> canonical, or null when empty. */
export function planLayeredTimelineMigration(
  timelineClips: Array<Record<string, any>>,
  projectAssets: Array<{ id: string; savedVideoId?: string }>,
  names: Map<string, string> = new Map(),
): EditorTimeline | null {
  const map = new Map<string, string>();
  for (const pa of projectAssets) {
    if (pa?.id && typeof pa.savedVideoId === "string" && pa.savedVideoId) map.set(pa.id, pa.savedVideoId);
  }
  const t = layeredClipsToEditor(timelineClips, map, names);
  return t.clips.length > 0 ? t : null;
}

/** Whether a project doc still needs a timeline from a legacy source. */
export function projectNeedsTimeline(projectData: Record<string, any> | null | undefined): boolean {
  const t = projectData?.timeline;
  return !(t && t.version === EDITOR_TIMELINE_VERSION && Array.isArray(t.clips));
}

/**
 * content_items/{id} (a reference to a recording, no storage of its own) ->
 * saved_videos doc. Callers skip when a saved_video for the same
 * (userId, recording) already exists — recordings auto-create one.
 */
export function contentItemToSavedVideo(id: string, item: Record<string, any>, now: Date): Record<string, any> | null {
  const userId = typeof item?.userId === "string" ? item.userId : "";
  const sourceId = typeof item?.sourceId === "string" ? item.sourceId : "";
  if (!userId || !sourceId || (item?.sourceType && item.sourceType !== "recording")) return null;
  return {
    userId,
    title: String(item?.title || item?.roomName || "Untitled Recording").slice(0, 200),
    sourceType: "recording",
    sourceId,
    playbackUrl: item?.playbackUrl || "",
    downloadUrl: item?.playbackUrl || null,
    thumbnailUrl: item?.thumbnailUrl || null,
    durationMs: typeof item?.durationMs === "number" ? item.durationMs : 0,
    sizeBytes: 0,
    hasEmbeddedAudio: true,
    status: "ready",
    createdAt: item?.createdAt ?? now,
    migratedFrom: { collection: "content_items", id },
  };
}

/** Count projects for limits: active projects + legacy docs not yet migrated or linked. */
export function countProjectsForLimit(
  activeProjects: number,
  legacyDocs: Array<Record<string, any>>,
): number {
  let extra = 0;
  for (const d of legacyDocs) {
    if (d?.migratedToProjectId || d?.projectId) continue;
    if (d?.status === "archived") continue;
    extra++;
  }
  return activeProjects + extra;
}
