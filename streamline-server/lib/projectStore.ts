/**
 * Project store — `projects` is the canonical project collection; its doc
 * carries the editor timeline (`timeline`, version 2).
 *
 * Backward compatibility until scripts/migrateContentToProjects.ts is
 * applied: reading a project falls back to the legacy sources and migrates
 * that one project lazily (idempotent, transactional, nothing deleted):
 *   - editing_projects/{id}               (standalone legacy project)
 *   - editing_projects where projectId==id (legacy doc linked by the old bridge)
 *   - timeline_clips where projectId==id   (Layer 3 clips -> saved_videos)
 * Writes go to `projects` only; the legacy collections are read-only.
 */
import { FieldValue } from "firebase-admin/firestore";
import { firestore as db } from "../firebaseAdmin";
import { logger } from "./logger";
import type { ProjectDoc } from "./projectManager";
import { isEditorTimeline, timelineDurationSec, type EditorTimeline } from "./editorTimeline";
import {
  LEGACY_EDITING_PROJECTS,
  countProjectsForLimit,
  planEditingProjectMigration,
  planLayeredTimelineMigration,
  projectNeedsTimeline,
  type EditingProjectMigrationStep,
} from "./contentMigrationPure";

const PROJECTS = "projects";

export type MigrationSource = "editing_projects" | "timeline_clips";

export interface EditorProject {
  project: ProjectDoc;
  timeline: EditorTimeline | null;
  migratedFrom: MigrationSource | null;
}

function toProject(id: string, data: any): ProjectDoc {
  return { id, ...(data || {}) } as ProjectDoc;
}

/**
 * Apply one planned editing_projects migration. Transactional: creates the
 * target project (or fills its missing timeline) and stamps the legacy doc.
 * Returns false when skipped (already migrated / owner mismatch).
 */
export async function applyEditingProjectMigration(
  legacyRef: FirebaseFirestore.DocumentReference,
  step: EditingProjectMigrationStep,
): Promise<{ applied: boolean; reason?: string }> {
  if (step.action !== "create_project" && step.action !== "migrate_into_linked") {
    return { applied: false, reason: step.action };
  }
  const projRef = db.collection(PROJECTS).doc(step.targetProjectId);
  return db.runTransaction(async (tx) => {
    const [legacy, proj] = await Promise.all([tx.get(legacyRef), tx.get(projRef)]);
    const ld = (legacy.data() || {}) as any;
    if (!legacy.exists || ld.migratedToProjectId) return { applied: false, reason: "already_migrated" };
    if (proj.exists) {
      const pd = (proj.data() || {}) as any;
      if (pd.ownerId !== step.ownerId) return { applied: false, reason: "owner_mismatch" };
      if (step.timeline && projectNeedsTimeline(pd)) {
        tx.set(projRef, { timeline: step.timeline, durationSec: timelineDurationSec(step.timeline), timelineMigratedAt: new Date() }, { merge: true });
      }
    } else if (step.projectCreate) {
      tx.create(projRef, {
        ...step.projectCreate,
        ...(step.timeline ? { timeline: step.timeline, durationSec: timelineDurationSec(step.timeline), timelineMigratedAt: new Date() } : {}),
      });
    }
    if (step.legacyPatch) tx.set(legacyRef, step.legacyPatch, { merge: true });
    return { applied: true };
  });
}

/** Seed duration for an empty legacy project opened from an asset (best effort). */
async function seedDurationFor(data: any): Promise<number | undefined> {
  const assetId = typeof data?.assetId === "string" ? data.assetId.trim() : "";
  if (!assetId || assetId.includes("/")) return undefined;
  try {
    const rec = await db.collection("recordings").doc(assetId).get();
    const d = rec.exists ? (rec.data() as any) : null;
    const dur = Number(d?.duration);
    return Number.isFinite(dur) && dur > 0 ? dur : undefined;
  } catch {
    return undefined;
  }
}

export async function migrateEditingProjectSnap(
  snap: FirebaseFirestore.DocumentSnapshot,
  opts: { apply: boolean; now?: Date },
): Promise<{ step: EditingProjectMigrationStep; applied: boolean; reason?: string }> {
  const data = (snap.data() || {}) as any;
  const step = planEditingProjectMigration(snap.id, data, opts.now ?? new Date(), {
    seedAssetDurationSec: await seedDurationFor(data),
  });
  if (!opts.apply) return { step, applied: false, reason: "dry_run" };
  const r = await applyEditingProjectMigration(snap.ref, step);
  return { step, ...r };
}

/** Layer 3 clips for a project -> canonical timeline (null when none). */
export async function loadLayeredTimeline(projectId: string): Promise<EditorTimeline | null> {
  const clipsSnap = await db.collection("timeline_clips").where("projectId", "==", projectId).get();
  if (clipsSnap.empty) return null;
  const paSnap = await db.collection("editing_project_assets").where("projectId", "==", projectId).get();
  const projectAssets = paSnap.docs.map((d) => ({ id: d.id, savedVideoId: (d.data() as any)?.savedVideoId }));
  const names = new Map<string, string>();
  await Promise.all(
    projectAssets.map(async (pa) => {
      if (!pa.savedVideoId) return;
      try {
        const sv = await db.collection("saved_videos").doc(pa.savedVideoId).get();
        if (sv.exists) names.set(pa.savedVideoId, String((sv.data() as any)?.title || "Clip"));
      } catch { /* name only */ }
    }),
  );
  return planLayeredTimelineMigration(clipsSnap.docs.map((d) => ({ id: d.id, ...d.data() })), projectAssets, names);
}

/** Write a migrated Layer 3 timeline onto the project when it still has none. */
export async function applyLayeredTimeline(projectId: string, timeline: EditorTimeline): Promise<boolean> {
  const ref = db.collection(PROJECTS).doc(projectId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || !projectNeedsTimeline(snap.data())) return false;
    tx.set(ref, { timeline, durationSec: timelineDurationSec(timeline), timelineMigratedAt: new Date(), timelineMigratedFrom: "timeline_clips" }, { merge: true });
    return true;
  });
}

/**
 * Load a project for the editor by id (a `projects` id, or a legacy
 * editing_projects id). Lazily migrates legacy data; owner-checked.
 */
export async function loadEditorProject(uid: string, id: string): Promise<EditorProject | null> {
  if (!id || id.includes("/")) return null;
  const projRef = db.collection(PROJECTS).doc(id);
  let projSnap = await projRef.get();

  if (!projSnap.exists) {
    // Standalone legacy project: migrate into projects/{sameId} (or its link).
    const legacy = await db.collection(LEGACY_EDITING_PROJECTS).doc(id).get();
    if (!legacy.exists) return null;
    const ld = legacy.data() as any;
    if (ld?.userId !== uid) return null;
    const { step, applied, reason } = await migrateEditingProjectSnap(legacy, { apply: true });
    logger.info({ legacyId: id, target: step.targetProjectId, action: step.action, applied, reason }, "lazy editing_projects migration");
    const target = step.targetProjectId;
    if (target !== id) return loadEditorProject(uid, target);
    projSnap = await projRef.get();
    if (!projSnap.exists) return null;
    const pd = projSnap.data() as any;
    if (pd?.ownerId !== uid) return null;
    return { project: toProject(id, pd), timeline: isEditorTimeline(pd.timeline) ? pd.timeline : null, migratedFrom: "editing_projects" };
  }

  const pd = projSnap.data() as any;
  if (pd?.ownerId !== uid) return null;
  if (isEditorTimeline(pd.timeline)) return { project: toProject(id, pd), timeline: pd.timeline, migratedFrom: null };

  // Timeline written through the old bridge onto a linked editing_projects doc.
  const linked = await db
    .collection(LEGACY_EDITING_PROJECTS)
    .where("projectId", "==", id)
    .where("userId", "==", uid)
    .limit(5)
    .get();
  const pending = linked.docs.filter((d) => !(d.data() as any)?.migratedToProjectId);
  for (const doc of pending) {
    const { applied, reason } = await migrateEditingProjectSnap(doc, { apply: true });
    logger.info({ legacyId: doc.id, projectId: id, applied, reason }, "lazy linked editing_projects migration");
  }
  if (pending.length > 0) {
    const fresh = (await projRef.get()).data() as any;
    if (isEditorTimeline(fresh?.timeline)) {
      return { project: toProject(id, fresh), timeline: fresh.timeline, migratedFrom: "editing_projects" };
    }
  }

  // Layer 3 clips (old 3-layer editor).
  try {
    const layered = await loadLayeredTimeline(id);
    if (layered) {
      await applyLayeredTimeline(id, layered);
      return { project: toProject(id, pd), timeline: layered, migratedFrom: "timeline_clips" };
    }
  } catch (e: any) {
    logger.warn({ projectId: id, err: e?.message || String(e) }, "layered timeline fallback failed");
  }

  return { project: toProject(id, pd), timeline: null, migratedFrom: null };
}

/** Persist the editor timeline on the canonical project (migrating first if needed). */
export async function saveEditorTimeline(uid: string, id: string, timeline: EditorTimeline): Promise<EditorProject | null> {
  const loaded = await loadEditorProject(uid, id);
  if (!loaded) return null;
  const ref = db.collection(PROJECTS).doc(loaded.project.id);
  await ref.set(
    { timeline, durationSec: timelineDurationSec(timeline), updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return { ...loaded, timeline };
}

/** Projects for limits.projects: active projects + unmigrated standalone legacy docs. */
export async function countUserProjects(uid: string): Promise<number> {
  const [projectsSnap, legacySnap] = await Promise.all([
    db.collection(PROJECTS).where("ownerId", "==", uid).where("status", "==", "active").get(),
    db.collection(LEGACY_EDITING_PROJECTS).where("userId", "==", uid).get(),
  ]);
  return countProjectsForLimit(projectsSnap.size, legacySnap.docs.map((d) => d.data() || {}));
}

/**
 * Read-only fallback for the project list: standalone legacy projects not yet
 * migrated, in the `projects` list shape (id = legacy id; opening one migrates
 * it into projects/{sameId}).
 */
export async function listUnmigratedLegacyProjects(uid: string): Promise<Record<string, any>[]> {
  const snap = await db.collection(LEGACY_EDITING_PROJECTS).where("userId", "==", uid).get();
  const iso = (v: any) => (typeof v?.toDate === "function" ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : typeof v === "string" ? v : new Date(0).toISOString());
  return snap.docs
    .filter((d) => {
      const x = d.data() as any;
      return !x?.migratedToProjectId && !x?.projectId && x?.status !== "archived";
    })
    .map((d) => {
      const x = d.data() as any;
      return {
        id: d.id,
        ownerId: uid,
        name: x?.name || "Untitled Project",
        createdBy: uid,
        status: "active",
        thumbnail: x?.thumbnail || x?.thumbnailUrl || null,
        createdAt: iso(x?.createdAt),
        updatedAt: iso(x?.updatedAt || x?.createdAt),
        assetCount: 0,
        sourceRoomId: null,
        sourceRoomName: null,
        legacy: true,
      };
    });
}
