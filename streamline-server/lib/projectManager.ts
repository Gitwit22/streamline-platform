/**
 * Project Manager — Core utility for managing Projects and ProjectAssets
 *
 * Projects are first-class media workspaces that exist independently of editing.
 * The editor timeline lives on the project doc (see lib/projectStore.ts).
 *
 * Firestore collections:
 *   projects          — Project documents (canonical Project concept)
 *   project_assets    — Files a project owns (uploads) or references
 */

import { firestore } from "../firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { deleteFile } from "./storageClient";
import { releaseStorageUsage } from "../usageHelper";

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
  /**
   * Bytes reserved against the owner's storage quota for an object this asset
   * owns (uploads). Released exactly once when the asset is deleted.
   * Absent on recording-backed assets (the recording owns the object/bytes).
   */
  storageBytes?: number | null;
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
  storageBytes?: number | null;
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
    ...(typeof opts.storageBytes === "number" && opts.storageBytes > 0 ? { storageBytes: opts.storageBytes } : {}),
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

/**
 * Delete a project asset. Uploaded assets own their R2 object: it is deleted
 * first (idempotent), then the doc is removed in a transaction and the quota
 * bytes are released only by the call that actually removed the doc, so
 * concurrent deletes can't double-release. Recording-backed assets never
 * delete the recording's object.
 */
export async function deleteProjectAsset(
  assetId: string,
  projectId: string,
): Promise<{ deleted: boolean; releasedBytes: number }> {
  const ref = assetsColl().doc(assetId);
  const snap = await ref.get();
  if (!snap.exists) return { deleted: false, releasedBytes: 0 };
  const data = (snap.data() || {}) as Partial<ProjectAssetDoc>;

  const ownsObject = data.type === "upload" && typeof data.storageKey === "string" && data.storageKey.trim().length > 0;
  if (ownsObject) {
    // Throws on failure: keep the doc so the delete can be retried.
    await deleteFile(String(data.storageKey).trim());
  }

  const deleted = await firestore.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) return false;
    tx.delete(ref);
    tx.set(
      projectsColl().doc(projectId),
      { assetCount: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return true;
  });

  const bytes = Number(data.storageBytes) || 0;
  let releasedBytes = 0;
  if (deleted && ownsObject && bytes > 0 && data.ownerId) {
    try {
      await releaseStorageUsage(String(data.ownerId), bytes, {
        caller: "projectManager.deleteProjectAsset",
        assetId,
        projectId,
      });
      releasedBytes = bytes;
    } catch (e: any) {
      console.error("[projects] STORAGE RELEASE FAILED for deleted asset — needs reconciliation", {
        assetId, projectId, ownerId: data.ownerId, bytes, error: e?.message || e,
      });
    }
  }

  return { deleted, releasedBytes };
}
