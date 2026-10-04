/**
 * Projects API — canonical Project concept (`projects`).
 *
 * A project holds its editor timeline on the project doc (`timeline`, v2,
 * see lib/editorTimeline.ts) and may own uploaded/attached files in
 * `project_assets`. Timeline clips reference MediaAssets by id (recordings,
 * editing_assets, saved_videos, project_assets).
 *
 * Legacy sources (read-only fallback, migrated lazily on read or by
 * scripts/migrateContentToProjects.ts): editing_projects, Layer 3
 * timeline_clips / editing_project_assets.
 *
 * Routes:
 *   GET    /api/projects                         — List user's projects (+ unmigrated legacy projects)
 *   POST   /api/projects                         — Create a project
 *   GET    /api/projects/:id                     — Project + timeline + resolved media + project assets
 *   PUT    /api/projects/:id/timeline            — Save the editor timeline
 *   PATCH  /api/projects/:id                     — Update project name/status
 *   DELETE /api/projects/:id                     — Archive project (owner, ungated)
 *
 *   GET    /api/projects/:id/assets              — List project_assets
 *   DELETE /api/projects/:id/assets/:assetId     — Delete / detach a project asset (owner, ungated)
 *   GET    /api/projects/:id/assets/:assetId/download — Download asset
 *   POST   /api/projects/:id/assets/upload       — Upload asset to project
 */

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { firestore } from "../firebaseAdmin";
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
  listProjectAssets,
  getProjectAsset,
  deleteProjectAsset,
  addAssetToProject,
  serializeProject,
  serializeAsset,
} from "../lib/projectManager";
import { getSignedDownloadUrl, uploadFileFromPath, deleteFile } from "../lib/storageClient";
import { LIMIT_ERRORS } from "../lib/limitErrors";
import { reserveStorageIfAvailable, releaseReservedStorage } from "../usageHelper";
import { createDiskUpload, cleanupUploadedFile, MAX_UPLOAD_BYTES, type UploadedDiskFile } from "../lib/diskUpload";
import {
  assertCanCreateProject,
  assertEditingAccess,
  assertSegmentEnabled,
  requireContentLibraryUploadsEnabled,
} from "./editing";
import { listUnmigratedLegacyProjects, loadEditorProject, saveEditorTimeline } from "../lib/projectStore";
import { sanitizeEditorTimeline } from "../lib/editorTimeline";
import { resolveMediaAssets, withPlayableUrl } from "../lib/mediaAssets";
import { publicMediaAsset } from "../lib/mediaAssetsPure";

const router = Router();
// Spool uploads to os.tmpdir() (not RAM) and stream them to R2.
const upload = createDiskUpload(MAX_UPLOAD_BYTES);

const db = firestore;

function getAuthUserId(req: any): string | null {
  return req.user?.uid || req.authUid || null;
}

/** Owned project by id, migrating a legacy editing_projects id on first use. */
async function getOwnedProject(uid: string, id: string) {
  const project = await getProject(id);
  if (project) return project.ownerId === uid ? project : null;
  const loaded = await loadEditorProject(uid, id);
  return loaded ? loaded.project : null;
}

// ── GET / — list projects ────────────────────────────────────────────────────
router.get("/", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const [projects, legacy] = await Promise.all([
      listProjects(uid, limit),
      listUnmigratedLegacyProjects(uid).catch(() => [] as Record<string, any>[]),
    ]);
    const rows = [...projects.map(serializeProject), ...legacy]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, limit);
    return res.json({ projects: rows });
  } catch (err: any) {
    console.error("[projects] list error:", err?.message || err);
    return res.status(500).json({ error: "Failed to list projects" });
  }
});

// ── POST / — create project ─────────────────────────────────────────────────
router.post("/", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ error: "Project name is required" });

    // Projects platform switch, the effective plan's projects feature and
    // limits.projects (null = unlimited).
    if (!(await assertCanCreateProject(req, res))) return;

    const project = await createProject({
      ownerId: uid,
      name: name.slice(0, 200),
      createdBy: uid,
    });
    return res.status(201).json({ project: serializeProject(project) });
  } catch (err: any) {
    console.error("[projects] create error:", err?.message || err);
    return res.status(500).json({ error: "Failed to create project" });
  }
});

// ── GET /:id — project + timeline + resolved media ──────────────────────────
router.get("/:id", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const loaded = await loadEditorProject(uid, String(req.params.id || ""));
    if (!loaded) return res.status(404).json({ error: "Project not found" });
    const projectId = loaded.project.id;

    const projectAssets = await listProjectAssets(projectId).catch(() => []);

    // Playable media for every timeline clip and every project asset.
    const ids = new Set<string>([
      ...(loaded.timeline?.clips.map((c) => c.assetId) ?? []),
      ...projectAssets.filter((a) => a.processingStatus === "ready").map((a) => a.id),
    ]);
    const resolved = await resolveMediaAssets(uid, ids);
    const mediaAssets: Record<string, any> = {};
    await Promise.all(
      Array.from(resolved.entries()).map(async ([id, a]) => {
        mediaAssets[id] = publicMediaAsset(await withPlayableUrl(a));
      }),
    );

    return res.json({
      project: serializeProject(loaded.project),
      timeline: loaded.timeline,
      mediaAssets,
      projectAssets: projectAssets.map(serializeAsset),
      migratedFrom: loaded.migratedFrom,
    });
  } catch (err: any) {
    console.error("[projects] get error:", err?.message || err);
    return res.status(500).json({ error: "Failed to get project" });
  }
});

// ── PUT /:id/timeline — save the editor timeline ────────────────────────────
router.put("/:id/timeline", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    if (!(await assertSegmentEnabled(res, "editorEnabled"))) return;
    const access = await assertEditingAccess(req, res);
    if (!access) return;

    const parsed = sanitizeEditorTimeline(req.body?.timeline ?? req.body);
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });

    const saved = await saveEditorTimeline(uid, String(req.params.id || ""), parsed.timeline);
    if (!saved) return res.status(404).json({ error: "Project not found" });

    return res.json({ saved: true, projectId: saved.project.id, clips: parsed.timeline.clips.length });
  } catch (err: any) {
    console.error("[projects] save timeline error:", err?.message || err);
    return res.status(500).json({ error: "Failed to save timeline" });
  }
});

// ── PATCH /:id — update project ─────────────────────────────────────────────
router.patch("/:id", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getOwnedProject(uid, req.params.id);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const updates: Record<string, any> = {};
    if (typeof req.body?.name === "string" && req.body.name.trim()) {
      updates.name = req.body.name.trim().slice(0, 200);
    }
    if (req.body?.status === "active" || req.body?.status === "archived") {
      updates.status = req.body.status;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    await updateProject(project.id, updates);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[projects] update error:", err?.message || err);
    return res.status(500).json({ error: "Failed to update project" });
  }
});

// ── DELETE /:id — archive project (owner cleanup, never plan-gated) ─────────
router.delete("/:id", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getOwnedProject(uid, req.params.id);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    await deleteProject(project.id);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[projects] delete error:", err?.message || err);
    return res.status(500).json({ error: "Failed to delete project" });
  }
});

// =============================================================================
// PROJECT ASSETS (project_assets) — files a project owns / references
// =============================================================================

// ── GET /:projectId/assets — list project assets ────────────────────────────
router.get("/:projectId/assets", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getProject(req.params.projectId);
    if (!project) {
      // Unmigrated legacy project: it owns no project_assets.
      const legacy = await db.collection("editing_projects").doc(String(req.params.projectId)).get();
      if (legacy.exists && (legacy.data() as any)?.userId === uid) return res.json({ assets: [] });
      return res.status(404).json({ error: "Project not found" });
    }
    if (project.ownerId !== uid) {
      return res.status(404).json({ error: "Project not found" });
    }

    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const assets = await listProjectAssets(project.id, limit);
    return res.json({ assets: assets.map(serializeAsset) });
  } catch (err: any) {
    console.error("[projects] list assets error:", err?.message || err);
    return res.status(500).json({ error: "Failed to list assets" });
  }
});

// ── DELETE /:projectId/assets/:assetId — delete / detach (owner, ungated) ───
router.delete("/:projectId/assets/:assetId", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getProject(req.params.projectId);
    if (!project || project.ownerId !== uid) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Uploaded assets live in project_assets and own an R2 object + quota bytes.
    const uploaded = await getProjectAsset(req.params.assetId);
    if (uploaded) {
      if (uploaded.projectId !== req.params.projectId || uploaded.ownerId !== uid) {
        return res.status(404).json({ error: "Project asset not found" });
      }
      const result = await deleteProjectAsset(uploaded.id, req.params.projectId);
      return res.json({ ok: true, clipsRemoved: 0, deleted: result.deleted, storageReleasedBytes: result.releasedBytes });
    }

    // Deprecated Layer 2 link (editing_project_assets -> saved_videos): a
    // reference only (no object). Detach it and its Layer 3 clips.
    const assetRef = db.collection("editing_project_assets").doc(req.params.assetId);
    const assetSnap = await assetRef.get();
    if (!assetSnap.exists || (assetSnap.data() as any)?.projectId !== req.params.projectId) {
      return res.status(404).json({ error: "Project asset not found" });
    }
    const clipSnap = await db
      .collection("timeline_clips")
      .where("projectAssetId", "==", req.params.assetId)
      .get();
    const batch = db.batch();
    batch.delete(assetRef);
    for (const clipDoc of clipSnap.docs) {
      batch.delete(clipDoc.ref);
    }
    await batch.commit();
    return res.json({ ok: true, clipsRemoved: clipSnap.size });
  } catch (err: any) {
    console.error("[projects] delete asset error:", err?.message || err);
    return res.status(500).json({ error: "Failed to delete asset" });
  }
});

// ── POST /:id/assets/upload — upload video to existing project ──────────────
router.post(
  "/:id/assets/upload",
  requireAuth,
  requireContentLibraryUploadsEnabled as any,
  upload.single("video") as any,
  async (req: any, res) => {
  const file = (req as any).file as UploadedDiskFile | undefined;
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getProject(req.params.id);
    if (!project || project.ownerId !== uid) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const allowedTypes = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ error: "Invalid file type. MP4, WebM, MOV, and AVI supported." });
    }

    const title = typeof req.body?.title === "string" && req.body.title.trim()
      ? req.body.title.trim()
      : file.originalname.replace(/\.[^/.]+$/, "");

    const timestamp = Date.now();
    const safeName = title.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const ext = (file.originalname.split(".").pop() || "mp4").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "mp4";
    const storagePath = `projects/${uid}/${req.params.id}/${timestamp}-${safeName}.${ext}`;

    // Reserve quota before uploading (atomic check + increment), like the
    // editing and My Content uploads.
    const reservation = await reserveStorageIfAvailable(uid, file.size, {
      caller: "projects.upload",
      projectId: req.params.id,
    });
    if (!reservation.reserved) {
      return res.status(409).json({
        error: LIMIT_ERRORS.LIMIT_EXCEEDED,
        details: reservation.reason || "Storage limit exceeded",
      });
    }

    let uploaded = false;
    try {
      await uploadFileFromPath(file.path, storagePath, file.mimetype);
      uploaded = true;

      const asset = await addAssetToProject({
        projectId: req.params.id,
        ownerId: uid,
        type: "upload",
        filename: `${title}.${ext}`,
        storageKey: storagePath,
        size: file.size,
        storageBytes: file.size,
        processingStatus: "ready",
      });

      return res.status(201).json({ asset: serializeAsset(asset) });
    } catch (err: any) {
      // Roll back: remove the object (if uploaded) and release the reservation.
      if (uploaded) await deleteFile(storagePath).catch(() => {});
      try {
        await releaseReservedStorage(uid, file.size, { caller: "projects.upload.rollback", storagePath });
      } catch (releaseErr: any) {
        console.error("[projects] CRITICAL: failed to release reservation after upload failure", {
          uid, storagePath, fileSizeBytes: file.size, uploadError: err?.message, releaseError: releaseErr?.message,
        });
      }
      throw err;
    }
  } catch (err: any) {
    console.error("[projects] upload asset error:", err?.message || err);
    return res.status(500).json({ error: "Failed to upload asset" });
  } finally {
    await cleanupUploadedFile(file);
  }
});

// ── GET /:id/assets/:assetId/download — download asset ──────────────────────
router.get("/:id/assets/:assetId/download", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getProject(req.params.id);
    if (!project || project.ownerId !== uid) {
      return res.status(404).json({ error: "Project not found" });
    }

    const asset = await getProjectAsset(req.params.assetId);
    if (!asset || asset.projectId !== req.params.id) {
      return res.status(404).json({ error: "Asset not found" });
    }

    if (asset.processingStatus !== "ready") {
      return res.status(409).json({ error: "Asset is not ready yet", status: asset.processingStatus });
    }

    if (!asset.storageKey) {
      return res.status(404).json({ error: "No storage key for this asset" });
    }

    const downloadUrl = await getSignedDownloadUrl(asset.storageKey, 900);
    return res.json({
      downloadUrl,
      filename: asset.filename || "recording.mp4",
      storageKey: asset.storageKey,
      status: asset.processingStatus,
    });
  } catch (err: any) {
    console.error("[projects] download asset error:", err?.message || err);
    return res.status(500).json({ error: "Failed to get download URL" });
  }
});

export default router;
