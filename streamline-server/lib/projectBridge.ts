/**
 * Project Bridge — Compatibility adapter between the new `projects` collection
 * and the legacy `editing_projects` collection.
 *
 * The editor (editing.ts routes) works against `editing_projects`. The newer
 * project-manager layer writes to `projects`. This bridge:
 *
 *   1. Resolves a project by its *new* `projects` ID.
 *   2. Looks for an existing `editing_projects` doc linked to that project.
 *   3. If missing, auto-creates the legacy backing record so the editor works.
 *   4. Returns one normalized shape the editor can use directly.
 */

import { firestore as db } from "../firebaseAdmin";
import { logger } from "./logger";

// ── Normalized project shape returned by the bridge ─────────────────────────

export interface NormalizedProject {
  id: string;                  // editing_projects doc ID (editor key)
  projectId: string;           // new `projects` collection ID
  name: string;
  assetId: string;
  status: string;
  lastModified: string;
  duration: number;
  thumbnail: string | null;
  userId: string;
  timeline: any | null;
  migrated: boolean;           // true when sourced from the new collection
  sourceCollection: "projects" | "editing_projects";
}

// ── Internal helpers ────────────────────────────────────────────────────────

const EDITING_PROJECTS = "editing_projects";
const PROJECTS = "projects";

function timestampToISOString(field: any): string {
  if (!field) return new Date().toISOString();
  if (typeof field.toDate === "function") return field.toDate().toISOString();
  if (field instanceof Date) return field.toISOString();
  if (typeof field === "string") return field;
  return new Date().toISOString();
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve a project for the editor by *either* an editing_projects ID or a
 * new projects ID.  The lookup order is:
 *
 *   1. Try `editing_projects/{id}` — fast path for existing editor projects.
 *   2. Try `editing_projects` where `projectId == id` — linked record.
 *   3. Try `projects/{id}` — new project, auto-create editing_projects doc.
 */
export async function resolveProjectForEditor(
  id: string,
  userId: string,
): Promise<NormalizedProject | null> {
  // --- 1. Direct lookup in editing_projects ----------------------------------
  const editSnap = await db.collection(EDITING_PROJECTS).doc(id).get();
  if (editSnap.exists) {
    const data = editSnap.data() as any;
    if (data?.userId !== userId) return null; // ownership check
    return normalizeEditingProject(editSnap.id, data);
  }

  // --- 2. Linked lookup: editing_projects.projectId == id --------------------
  const linkedSnap = await db
    .collection(EDITING_PROJECTS)
    .where("projectId", "==", id)
    .where("userId", "==", userId)
    .limit(1)
    .get();

  if (!linkedSnap.empty) {
    const doc = linkedSnap.docs[0];
    return normalizeEditingProject(doc.id, doc.data() as any);
  }

  // --- 3. Lookup in new projects collection, auto-create legacy doc ----------
  const projSnap = await db.collection(PROJECTS).doc(id).get();
  if (!projSnap.exists) return null;

  const projData = projSnap.data() as any;
  if (projData?.ownerId !== userId) return null; // ownership check

  // Auto-create the legacy editing_projects backing doc
  const editingDoc = await hydrateEditingProject(id, projData, userId);
  return editingDoc;
}

/**
 * List projects for a user, merging both collections into one normalized list.
 * New `projects` records that already have a linked editing_projects doc are
 * de-duplicated.
 */
export async function listProjectsForEditor(userId: string): Promise<NormalizedProject[]> {
  // Fetch both in parallel
  const [editingSnap, projectsSnap] = await Promise.all([
    db.collection(EDITING_PROJECTS).where("userId", "==", userId).get(),
    db.collection(PROJECTS).where("ownerId", "==", userId).where("status", "==", "active").get(),
  ]);

  // Index editing_projects by their linked projectId (if any)
  const linkedProjectIds = new Set<string>();
  const editingById = new Map<string, NormalizedProject>();

  for (const doc of editingSnap.docs) {
    const data = doc.data() as any;
    const norm = normalizeEditingProject(doc.id, data);
    editingById.set(doc.id, norm);
    if (data.projectId) {
      linkedProjectIds.add(data.projectId);
    }
  }

  // Build result starting with editing_projects
  const results: NormalizedProject[] = Array.from(editingById.values());

  // Append new projects that have no linked editing_projects doc yet
  for (const doc of projectsSnap.docs) {
    if (!linkedProjectIds.has(doc.id)) {
      const data = doc.data() as any;
      results.push(normalizeNewProject(doc.id, data, userId));
    }
  }

  // Sort by lastModified descending
  results.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

  return results;
}

/**
 * Count total projects for a user across both collections (de-duped).
 */
export async function countUserProjects(userId: string): Promise<number> {
  const [editingSnap, projectsSnap] = await Promise.all([
    db.collection(EDITING_PROJECTS).where("userId", "==", userId).get(),
    db.collection(PROJECTS).where("ownerId", "==", userId).where("status", "==", "active").get(),
  ]);

  const linkedProjectIds = new Set<string>();
  for (const doc of editingSnap.docs) {
    const data = doc.data();
    if (data?.projectId) linkedProjectIds.add(data.projectId as string);
  }

  let extra = 0;
  for (const doc of projectsSnap.docs) {
    if (!linkedProjectIds.has(doc.id)) extra++;
  }

  return editingSnap.size + extra;
}

// ── Normalization helpers ───────────────────────────────────────────────────

function normalizeEditingProject(docId: string, data: any): NormalizedProject {
  return {
    id: docId,
    projectId: data.projectId || docId,
    name: data.name || "Untitled Project",
    assetId: data.assetId || "",
    status: data.status || "draft",
    lastModified:
      timestampToISOString(data.updatedAt) || timestampToISOString(data.createdAt) || new Date().toISOString(),
    duration: data.duration || 0,
    thumbnail: data.thumbnail || data.thumbnailUrl || null,
    userId: data.userId,
    timeline: data.timeline || null,
    migrated: !!data.projectId,
    sourceCollection: "editing_projects",
  };
}

function normalizeNewProject(docId: string, data: any, userId: string): NormalizedProject {
  return {
    id: docId,
    projectId: docId,
    name: data.name || "Untitled Project",
    assetId: "",
    status: data.status === "archived" ? "archived" : "draft",
    lastModified: timestampToISOString(data.updatedAt) || timestampToISOString(data.createdAt),
    duration: 0,
    thumbnail: data.thumbnail || null,
    userId: userId,
    timeline: null,
    migrated: true,
    sourceCollection: "projects",
  };
}

/**
 * Create a legacy `editing_projects` doc from a new `projects` record so
 * the editor has a document it can write timelines to.
 *
 * Looks up the first recording asset from `project_assets` to pre-populate
 * the assetId and initial timeline clip.
 */
async function hydrateEditingProject(
  newProjectId: string,
  projData: any,
  userId: string,
): Promise<NormalizedProject> {
  const now = new Date();

  // Look up the first recording asset for this project to seed the editor
  let firstAssetId = "";
  let firstAssetDuration = 0;
  let firstAssetName = projData.name || "Untitled Project";
  try {
    const assetsSnap = await db
      .collection("project_assets")
      .where("projectId", "==", newProjectId)
      .where("type", "==", "recording")
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();
    if (!assetsSnap.empty) {
      const assetData = assetsSnap.docs[0].data() as any;
      firstAssetId = assetData.sourceRecordingId || "";
      firstAssetDuration = assetData.duration || 0;
      firstAssetName = assetData.filename || firstAssetName;
    }
  } catch (assetErr: any) {
    // Fallback: try without orderBy in case composite index is missing
    try {
      const fallbackSnap = await db
        .collection("project_assets")
        .where("projectId", "==", newProjectId)
        .where("type", "==", "recording")
        .limit(1)
        .get();
      if (!fallbackSnap.empty) {
        const assetData = fallbackSnap.docs[0].data() as any;
        firstAssetId = assetData.sourceRecordingId || "";
        firstAssetDuration = assetData.duration || 0;
        firstAssetName = assetData.filename || firstAssetName;
      }
    } catch {
      // non-fatal
    }
    logger.warn({ newProjectId, error: assetErr?.message }, "project_assets query failed during hydration");
  }

  const initialClips = firstAssetId
    ? [
        {
          id: `clip_${Date.now()}`,
          assetId: firstAssetId,
          trackId: "video_1",
          startTime: 0,
          duration: firstAssetDuration || 60,
          inPoint: 0,
          outPoint: firstAssetDuration || 60,
          name: firstAssetName,
          videoUrl: "",
        },
      ]
    : [];

  const newDoc: Record<string, any> = {
    userId,
    projectId: newProjectId, // link back to new collection
    name: projData.name || "Untitled Project",
    assetId: firstAssetId,
    createdAt: now,
    updatedAt: now,
    duration: firstAssetDuration,
    status: "draft",
    timeline: { clips: initialClips, tracks: 2 },
  };

  const ref = await db.collection(EDITING_PROJECTS).add(newDoc);
  logger.info({ editingProjectId: ref.id, newProjectId, assetId: firstAssetId }, "Auto-created editing_projects backing doc");

  return {
    id: ref.id,
    projectId: newProjectId,
    name: newDoc.name,
    assetId: firstAssetId,
    status: "draft",
    lastModified: now.toISOString(),
    duration: firstAssetDuration,
    thumbnail: null,
    userId,
    timeline: newDoc.timeline,
    migrated: true,
    sourceCollection: "projects",
  };
}
