/**
 * Project Manager — Core utility for managing Projects and ProjectAssets
 *
 * Projects are first-class media workspaces that exist independently of editing.
 * Every recording automatically lands in a project. Editing is optional.
 *
 * Firestore collections:
 *   projects          — Project documents
 *   project_assets    — Assets belonging to projects
 */

import { firestore } from "../firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProjectDoc {
  id: string;
  ownerId: string;        // userId or orgId
  name: string;
  createdBy: string;      // userId who created it
  status: "active" | "archived";
  thumbnail: string | null;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  assetCount: number;
  sourceRoomId: string | null;   // if auto-created from a room
  sourceRoomName: string | null;
}

export type AssetType =
  | "recording"
  | "upload"
  | "render"
  | "clip"
  | "thumbnail"
  | "transcript";

export type ProcessingStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed";

export interface ProjectAssetDoc {
  id: string;
  projectId: string;
  ownerId: string;
  type: AssetType;
  sourceRoomId: string | null;
  sourceRecordingId: string | null;
  filename: string;
  storageKey: string;       // R2 object key
  duration: number | null;  // seconds
  resolution: string | null;
  size: number | null;      // bytes
  processingStatus: ProcessingStatus;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

// ── Collections ──────────────────────────────────────────────────────────────

const projectsColl = () => firestore.collection("projects");
const assetsColl   = () => firestore.collection("project_assets");

/** Convert Firestore Timestamp fields to ISO strings for JSON responses */
function tsToIso(ts: any): string | null {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === "string") return ts;
  return null;
}

export function serializeProject(p: ProjectDoc): Record<string, any> {
  return {
    ...p,
    createdAt: tsToIso(p.createdAt) || new Date().toISOString(),
    updatedAt: tsToIso(p.updatedAt) || new Date().toISOString(),
  };
}

export function serializeAsset(a: ProjectAssetDoc): Record<string, any> {
  return {
    ...a,
    createdAt: tsToIso(a.createdAt) || new Date().toISOString(),
    updatedAt: tsToIso(a.updatedAt) || new Date().toISOString(),
  };
}

// ── Project CRUD ─────────────────────────────────────────────────────────────

export async function createProject(opts: {
  ownerId: string;
  name: string;
  createdBy: string;
  sourceRoomId?: string | null;
  sourceRoomName?: string | null;
}): Promise<ProjectDoc> {
  const ref = projectsColl().doc();
  const now = FieldValue.serverTimestamp() as any;
  const doc: Omit<ProjectDoc, "id"> = {
    ownerId: opts.ownerId,
    name: opts.name,
    createdBy: opts.createdBy,
    status: "active",
    thumbnail: null,
    createdAt: now,
    updatedAt: now,
    assetCount: 0,
    sourceRoomId: opts.sourceRoomId ?? null,
    sourceRoomName: opts.sourceRoomName ?? null,
  };
  await ref.set(doc);
  return { id: ref.id, ...doc } as ProjectDoc;
}

export async function getProject(projectId: string): Promise<ProjectDoc | null> {
  const snap = await projectsColl().doc(projectId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as any) } as ProjectDoc;
}

export async function listProjects(ownerId: string, limit = 50): Promise<ProjectDoc[]> {
  try {
    const snap = await projectsColl()
      .where("ownerId", "==", ownerId)
      .where("status", "==", "active")
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProjectDoc));
  } catch (err: any) {
    // Fallback if composite index isn't created yet
    console.warn(`[listProjects] Compound query failed (missing index?): ${err?.message}`);
    const snap = await projectsColl()
      .where("ownerId", "==", ownerId)
      .get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as ProjectDoc))
      .filter((p) => p.status === "active")
      .sort((a, b) => {
        const aTime = (a.updatedAt as any)?.toMillis?.() || 0;
        const bTime = (b.updatedAt as any)?.toMillis?.() || 0;
        return bTime - aTime;
      })
      .slice(0, limit);
  }
}

export async function updateProject(
  projectId: string,
  updates: Partial<Pick<ProjectDoc, "name" | "status" | "thumbnail">>,
): Promise<void> {
  await projectsColl().doc(projectId).update({
    ...updates,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  // Soft-delete: archive, don't destroy
  await projectsColl().doc(projectId).update({
    status: "archived",
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// ── ProjectAsset CRUD ────────────────────────────────────────────────────────

export async function addAssetToProject(opts: {
  projectId: string;
  ownerId: string;
  type: AssetType;
  sourceRoomId?: string | null;
  sourceRecordingId?: string | null;
  filename: string;
  storageKey: string;
  duration?: number | null;
  resolution?: string | null;
  size?: number | null;
  processingStatus?: ProcessingStatus;
}): Promise<ProjectAssetDoc> {
  const ref = assetsColl().doc();
  const now = FieldValue.serverTimestamp() as any;
  const doc: Omit<ProjectAssetDoc, "id"> = {
    projectId: opts.projectId,
    ownerId: opts.ownerId,
    type: opts.type,
    sourceRoomId: opts.sourceRoomId ?? null,
    sourceRecordingId: opts.sourceRecordingId ?? null,
    filename: opts.filename,
    storageKey: opts.storageKey,
    duration: opts.duration ?? null,
    resolution: opts.resolution ?? null,
    size: opts.size ?? null,
    processingStatus: opts.processingStatus ?? "ready",
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);

  // Increment asset count on project
  await projectsColl().doc(opts.projectId).update({
    assetCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { id: ref.id, ...doc } as ProjectAssetDoc;
}

export async function listProjectAssets(
  projectId: string,
  limit = 100,
): Promise<ProjectAssetDoc[]> {
  try {
    const snap = await assetsColl()
      .where("projectId", "==", projectId)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProjectAssetDoc));
  } catch (err: any) {
    // Fallback if composite index isn't created yet
    console.warn(`[listProjectAssets] Compound query failed (missing index?): ${err?.message}`);
    const snap = await assetsColl()
      .where("projectId", "==", projectId)
      .get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as ProjectAssetDoc))
      .sort((a, b) => {
        const aTime = (a.createdAt as any)?.toMillis?.() || 0;
        const bTime = (b.createdAt as any)?.toMillis?.() || 0;
        return bTime - aTime;
      })
      .slice(0, limit);
  }
}

export async function getProjectAsset(assetId: string): Promise<ProjectAssetDoc | null> {
  const snap = await assetsColl().doc(assetId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as any) } as ProjectAssetDoc;
}

export async function deleteProjectAsset(assetId: string, projectId: string): Promise<void> {
  await assetsColl().doc(assetId).delete();
  await projectsColl().doc(projectId).update({
    assetCount: FieldValue.increment(-1),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// ── Auto-project from recording ──────────────────────────────────────────────

/**
 * Called when a recording reaches "ready".
 * Finds or creates a project for the room session, then adds the recording as
 * a ProjectAsset.
 */
export async function attachRecordingToProject(opts: {
  userId: string;
  recordingId: string;
  roomId: string;
  roomName: string;
  objectKey: string;
  fileSize: number | null;
  durationSeconds: number | null;
}): Promise<{ projectId: string; assetId: string }> {
  const { userId, recordingId, roomId, roomName, objectKey, fileSize, durationSeconds } = opts;

  console.log(`[attachRecordingToProject] Starting: recording=${recordingId}, userId=${userId}, roomId=${roomId}`);

  // Re-use existing project for this room if one exists (Option A — per-room project)
  let project: ProjectDoc | null = null;
  try {
    const existingSnap = await projectsColl()
      .where("ownerId", "==", userId)
      .where("sourceRoomId", "==", roomId)
      .where("status", "==", "active")
      .orderBy("updatedAt", "desc")
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      project = { id: existingSnap.docs[0].id, ...(existingSnap.docs[0].data() as any) } as ProjectDoc;
    }
  } catch (queryErr: any) {
    // Firestore composite index may be missing — fall back to simpler query
    console.warn(`[attachRecordingToProject] Compound query failed (missing index?): ${queryErr?.message}`);
    try {
      const fallbackSnap = await projectsColl()
        .where("ownerId", "==", userId)
        .where("sourceRoomId", "==", roomId)
        .get();
      const activeProjects = fallbackSnap.docs
        .filter((d) => (d.data() as any).status === "active")
        .sort((a, b) => {
          const aTime = (a.data() as any).updatedAt?.toMillis?.() || 0;
          const bTime = (b.data() as any).updatedAt?.toMillis?.() || 0;
          return bTime - aTime;
        });
      if (activeProjects.length > 0) {
        project = { id: activeProjects[0].id, ...(activeProjects[0].data() as any) } as ProjectDoc;
      }
    } catch (fallbackErr: any) {
      console.error(`[attachRecordingToProject] Fallback query also failed:`, fallbackErr);
    }
  }

  // No existing project for this room — create one
  if (!project) {
    const datePart = new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    project = await createProject({
      ownerId: userId,
      name: `${roomName || "Room"} – ${datePart}`,
      createdBy: userId,
      sourceRoomId: roomId,
      sourceRoomName: roomName,
    });
  }

  // Check idempotency — don't double-add the same recording
  const dupCheck = await assetsColl()
    .where("projectId", "==", project.id)
    .where("sourceRecordingId", "==", recordingId)
    .limit(1)
    .get();

  if (!dupCheck.empty) {
    return { projectId: project.id, assetId: dupCheck.docs[0].id };
  }

  // Derive a human filename
  const ext = objectKey.split(".").pop() || "mp4";
  const filename = `${roomName || "recording"}-${recordingId.slice(0, 8)}.${ext}`;

  const asset = await addAssetToProject({
    projectId: project.id,
    ownerId: userId,
    type: "recording",
    sourceRoomId: roomId,
    sourceRecordingId: recordingId,
    filename,
    storageKey: objectKey,
    duration: durationSeconds,
    size: fileSize,
    processingStatus: "ready",
  });

  return { projectId: project.id, assetId: asset.id };
}
