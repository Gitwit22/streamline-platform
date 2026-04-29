/**
 * Projects API — Core media-workspace routes
 *
 * These are NOT editing-specific. Projects exist whether editing is on or off.
 * Every paid-tier user gets a project workspace. Free users get read-only
 * access to auto-created recording projects.
 *
 * 3-Layer Architecture:
 *   Layer 2: ProjectAsset — links a SavedVideo to a project
 *   Layer 3: TimelineClip — placed instance on the timeline (video+audio pairs)
 *
 * Routes:
 *   GET    /api/projects           — List user's projects
 *   POST   /api/projects           — Create a project
 *   GET    /api/projects/:id       — Get single project + assets + clips
 *   PATCH  /api/projects/:id       — Update project name/status
 *   DELETE /api/projects/:id       — Archive project
 *
 *   POST   /api/projects/:projectId/assets           — Create project asset link
 *   GET    /api/projects/:projectId/assets            — List project assets
 *   DELETE /api/projects/:projectId/assets/:id        — Detach asset from project
 *
 *   POST   /api/projects/:projectId/timeline/clips    — Create linked video+audio clip pair
 *   GET    /api/projects/:projectId/timeline/clips    — List all clips
 *   PATCH  /api/projects/:projectId/timeline/clips/:id — Trim, move, unlink
 *   DELETE /api/projects/:projectId/timeline/clips/:id — Delete linked clips
 *
 *   GET    /api/projects/:id/assets/:assetId/download — Download asset
 *   POST   /api/projects/:id/assets/upload            — Upload asset to project
 */

import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
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
import { getSignedDownloadUrl, uploadVideo } from "../lib/storageClient";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

const db = firestore;

function getAuthUserId(req: any): string | null {
  return req.user?.uid || req.authUid || null;
}

function tsToIso(ts: any): string | null {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === "string") return ts;
  return null;
}

// ── GET / — list projects ────────────────────────────────────────────────────
router.get("/", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const projects = await listProjects(uid, limit);
    return res.json({ projects: projects.map(serializeProject) });
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

    const project = await createProject({
      ownerId: uid,
      name,
      createdBy: uid,
    });
    return res.status(201).json({ project: serializeProject(project) });
  } catch (err: any) {
    console.error("[projects] create error:", err?.message || err);
    return res.status(500).json({ error: "Failed to create project" });
  }
});

// ── GET /:id — get single project + assets + clips ─────────────────────────
router.get("/:id", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getProject(req.params.id);
    if (!project || project.ownerId !== uid) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Fetch project assets (Layer 2)
    const projectAssetsSnap = await db
      .collection("editing_project_assets")
      .where("projectId", "==", req.params.id)
      .get();

    const projectAssets = projectAssetsSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        projectId: d.projectId,
        savedVideoId: d.savedVideoId,
        sourceInMs: typeof d.sourceInMs === "number" ? d.sourceInMs : 0,
        sourceOutMs: typeof d.sourceOutMs === "number" ? d.sourceOutMs : 0,
        mode: d.mode || "full",
        createdAt: tsToIso(d.createdAt) || new Date().toISOString(),
      };
    });

    // Fetch timeline clips (Layer 3)
    const timelineClipsSnap = await db
      .collection("timeline_clips")
      .where("projectId", "==", req.params.id)
      .get();

    const timelineClips = timelineClipsSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        projectId: d.projectId,
        projectAssetId: d.projectAssetId,
        trackId: d.trackId || "video_1",
        kind: d.kind || "video",
        startMs: typeof d.startMs === "number" ? d.startMs : 0,
        endMs: typeof d.endMs === "number" ? d.endMs : 0,
        trimInMs: typeof d.trimInMs === "number" ? d.trimInMs : 0,
        trimOutMs: typeof d.trimOutMs === "number" ? d.trimOutMs : 0,
        linkGroupId: d.linkGroupId || null,
        lane: typeof d.lane === "number" ? d.lane : 0,
        createdAt: tsToIso(d.createdAt) || new Date().toISOString(),
      };
    });

    // Resolve saved video URLs for project assets
    const savedVideoIds = [...new Set(projectAssets.map((a) => a.savedVideoId).filter(Boolean))];
    const savedVideosMap: Record<string, any> = {};
    for (const svId of savedVideoIds) {
      try {
        const svSnap = await db.collection("saved_videos").doc(svId).get();
        if (svSnap.exists) {
          const svData = svSnap.data() as any;
          savedVideosMap[svId] = {
            id: svSnap.id,
            title: svData.title || "Untitled",
            playbackUrl: svData.playbackUrl || "",
            thumbnailUrl: svData.thumbnailUrl || null,
            durationMs: svData.durationMs || 0,
            sizeBytes: svData.sizeBytes || 0,
            status: svData.status || "ready",
          };
        }
      } catch {
        // Non-critical: skip missing saved videos
      }
    }

    return res.json({
      project: serializeProject(project),
      projectAssets,
      timelineClips,
      savedVideos: savedVideosMap,
    });
  } catch (err: any) {
    console.error("[projects] get error:", err?.message || err);
    return res.status(500).json({ error: "Failed to get project" });
  }
});

// ── PATCH /:id — update project ─────────────────────────────────────────────
router.patch("/:id", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getProject(req.params.id);
    if (!project || project.ownerId !== uid) {
      return res.status(404).json({ error: "Project not found" });
    }

    const updates: Record<string, any> = {};
    if (typeof req.body?.name === "string" && req.body.name.trim()) {
      updates.name = req.body.name.trim();
    }
    if (req.body?.status === "active" || req.body?.status === "archived") {
      updates.status = req.body.status;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    await updateProject(req.params.id, updates);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[projects] update error:", err?.message || err);
    return res.status(500).json({ error: "Failed to update project" });
  }
});

// ── DELETE /:id — archive project ───────────────────────────────────────────
router.delete("/:id", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getProject(req.params.id);
    if (!project || project.ownerId !== uid) {
      return res.status(404).json({ error: "Project not found" });
    }

    await deleteProject(req.params.id);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[projects] delete error:", err?.message || err);
    return res.status(500).json({ error: "Failed to delete project" });
  }
});

// =============================================================================
// PROJECT ASSETS (Layer 2) — Link SavedVideos to projects
// =============================================================================

// ── POST /:projectId/assets — create project asset link ─────────────────────
router.post("/:projectId/assets", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getProject(req.params.projectId);
    if (!project || project.ownerId !== uid) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { savedVideoId, mode, sourceInMs, sourceOutMs } = req.body;

    if (!savedVideoId || typeof savedVideoId !== "string") {
      return res.status(400).json({ error: "savedVideoId is required" });
    }

    // Verify saved video exists and belongs to user
    const svSnap = await db.collection("saved_videos").doc(savedVideoId).get();
    if (!svSnap.exists) {
      return res.status(404).json({ error: "Saved video not found" });
    }
    const svData = svSnap.data() as any;
    if (svData.userId !== uid) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const assetMode = mode === "subclip" ? "subclip" : "full";
    const now = new Date();

    const projectAsset = {
      projectId: req.params.projectId,
      savedVideoId,
      sourceInMs: assetMode === "subclip" && typeof sourceInMs === "number" ? Math.max(0, sourceInMs) : 0,
      sourceOutMs: assetMode === "subclip" && typeof sourceOutMs === "number" ? Math.max(0, sourceOutMs) : (svData.durationMs || 0),
      mode: assetMode,
      createdAt: now,
    };

    const ref = await db.collection("editing_project_assets").add(projectAsset);

    return res.status(201).json({
      id: ref.id,
      ...projectAsset,
      createdAt: now.toISOString(),
    });
  } catch (err: any) {
    console.error("[projects] create asset error:", err?.message || err);
    return res.status(500).json({ error: "Failed to create project asset" });
  }
});

// ── GET /:projectId/assets — list project assets ────────────────────────────
router.get("/:projectId/assets", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getProject(req.params.projectId);
    if (!project || project.ownerId !== uid) {
      return res.status(404).json({ error: "Project not found" });
    }

    const snap = await db
      .collection("editing_project_assets")
      .where("projectId", "==", req.params.projectId)
      .get();

    const assets = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        projectId: d.projectId,
        savedVideoId: d.savedVideoId,
        sourceInMs: typeof d.sourceInMs === "number" ? d.sourceInMs : 0,
        sourceOutMs: typeof d.sourceOutMs === "number" ? d.sourceOutMs : 0,
        mode: d.mode || "full",
        createdAt: tsToIso(d.createdAt) || new Date().toISOString(),
      };
    });

    // Resolve saved video info for each asset
    const resolvedAssets = [];
    for (const asset of assets) {
      let savedVideo = null;
      try {
        const svSnap = await db.collection("saved_videos").doc(asset.savedVideoId).get();
        if (svSnap.exists) {
          const svData = svSnap.data() as any;
          savedVideo = {
            id: svSnap.id,
            title: svData.title || "Untitled",
            playbackUrl: svData.playbackUrl || "",
            thumbnailUrl: svData.thumbnailUrl || null,
            durationMs: svData.durationMs || 0,
            sizeBytes: svData.sizeBytes || 0,
            status: svData.status || "ready",
          };
        }
      } catch {
        // Non-critical
      }
      resolvedAssets.push({ ...asset, savedVideo });
    }

    return res.json({ assets: resolvedAssets });
  } catch (err: any) {
    console.error("[projects] list assets error:", err?.message || err);
    return res.status(500).json({ error: "Failed to list assets" });
  }
});

// ── DELETE /:projectId/assets/:id — detach asset from project ───────────────
router.delete("/:projectId/assets/:assetId", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getProject(req.params.projectId);
    if (!project || project.ownerId !== uid) {
      return res.status(404).json({ error: "Project not found" });
    }

    const assetRef = db.collection("editing_project_assets").doc(req.params.assetId);
    const assetSnap = await assetRef.get();
    if (!assetSnap.exists) {
      return res.status(404).json({ error: "Project asset not found" });
    }

    const assetData = assetSnap.data() as any;
    if (assetData.projectId !== req.params.projectId) {
      return res.status(404).json({ error: "Asset not in this project" });
    }

    // Also delete any timeline clips referencing this asset
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

// =============================================================================
// TIMELINE CLIPS (Layer 3) — Placed instances on the timeline
// =============================================================================

// ── POST /:projectId/timeline/clips — create linked video+audio clip pair ───
router.post("/:projectId/timeline/clips", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getProject(req.params.projectId);
    if (!project || project.ownerId !== uid) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { projectAssetId, startMs } = req.body;

    if (!projectAssetId || typeof projectAssetId !== "string") {
      return res.status(400).json({ error: "projectAssetId is required" });
    }

    // Verify asset exists and belongs to this project
    const assetSnap = await db.collection("editing_project_assets").doc(projectAssetId).get();
    if (!assetSnap.exists) {
      return res.status(404).json({ error: "Project asset not found" });
    }

    const assetData = assetSnap.data() as any;
    if (assetData.projectId !== req.params.projectId) {
      return res.status(404).json({ error: "Asset not in this project" });
    }

    // Resolve saved video for duration info
    let durationMs = 0;
    try {
      const svSnap = await db.collection("saved_videos").doc(assetData.savedVideoId).get();
      if (svSnap.exists) {
        const svData = svSnap.data() as any;
        durationMs = svData.durationMs || 0;
      }
    } catch {
      // Use asset's source range if available
    }

    // Use subclip range if in subclip mode
    if (assetData.mode === "subclip") {
      durationMs = (assetData.sourceOutMs || 0) - (assetData.sourceInMs || 0);
    }

    const clipStartMs = typeof startMs === "number" ? Math.max(0, startMs) : 0;
    const clipEndMs = clipStartMs + durationMs;
    const trimInMs = assetData.mode === "subclip" ? (assetData.sourceInMs || 0) : 0;
    const trimOutMs = assetData.mode === "subclip" ? (assetData.sourceOutMs || 0) : durationMs;

    // Create linked pair with shared linkGroupId
    const linkGroupId = crypto.randomUUID();
    const now = new Date();

    const videoClip = {
      projectId: req.params.projectId,
      projectAssetId,
      trackId: "video_1",
      kind: "video" as const,
      startMs: clipStartMs,
      endMs: clipEndMs,
      trimInMs,
      trimOutMs,
      linkGroupId,
      lane: 0,
      createdAt: now,
    };

    const audioClip = {
      projectId: req.params.projectId,
      projectAssetId,
      trackId: "audio_1",
      kind: "audio" as const,
      startMs: clipStartMs,
      endMs: clipEndMs,
      trimInMs,
      trimOutMs,
      linkGroupId,
      lane: 0,
      createdAt: now,
    };

    const videoRef = await db.collection("timeline_clips").add(videoClip);
    const audioRef = await db.collection("timeline_clips").add(audioClip);

    return res.status(201).json({
      videoClip: { id: videoRef.id, ...videoClip, createdAt: now.toISOString() },
      audioClip: { id: audioRef.id, ...audioClip, createdAt: now.toISOString() },
      linkGroupId,
    });
  } catch (err: any) {
    console.error("[projects] create timeline clip error:", err?.message || err);
    return res.status(500).json({ error: "Failed to create timeline clips" });
  }
});

// ── GET /:projectId/timeline/clips — list all clips ─────────────────────────
router.get("/:projectId/timeline/clips", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getProject(req.params.projectId);
    if (!project || project.ownerId !== uid) {
      return res.status(404).json({ error: "Project not found" });
    }

    const snap = await db
      .collection("timeline_clips")
      .where("projectId", "==", req.params.projectId)
      .get();

    const clips = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        projectId: d.projectId,
        projectAssetId: d.projectAssetId,
        trackId: d.trackId || "video_1",
        kind: d.kind || "video",
        startMs: typeof d.startMs === "number" ? d.startMs : 0,
        endMs: typeof d.endMs === "number" ? d.endMs : 0,
        trimInMs: typeof d.trimInMs === "number" ? d.trimInMs : 0,
        trimOutMs: typeof d.trimOutMs === "number" ? d.trimOutMs : 0,
        linkGroupId: d.linkGroupId || null,
        lane: typeof d.lane === "number" ? d.lane : 0,
        createdAt: tsToIso(d.createdAt) || new Date().toISOString(),
      };
    });

    return res.json({ clips });
  } catch (err: any) {
    console.error("[projects] list timeline clips error:", err?.message || err);
    return res.status(500).json({ error: "Failed to list timeline clips" });
  }
});

// ── PATCH /:projectId/timeline/clips/:id — trim, move, unlink ──────────────
router.patch("/:projectId/timeline/clips/:clipId", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getProject(req.params.projectId);
    if (!project || project.ownerId !== uid) {
      return res.status(404).json({ error: "Project not found" });
    }

    const clipRef = db.collection("timeline_clips").doc(req.params.clipId);
    const clipSnap = await clipRef.get();
    if (!clipSnap.exists) {
      return res.status(404).json({ error: "Clip not found" });
    }

    const clipData = clipSnap.data() as any;
    if (clipData.projectId !== req.params.projectId) {
      return res.status(404).json({ error: "Clip not in this project" });
    }

    const patch: Record<string, any> = {};

    // Move: update start/end
    if (typeof req.body.startMs === "number") {
      patch.startMs = Math.max(0, req.body.startMs);
      if (typeof req.body.endMs === "number") {
        patch.endMs = Math.max(patch.startMs, req.body.endMs);
      }
    }
    if (typeof req.body.endMs === "number" && patch.endMs === undefined) {
      patch.endMs = Math.max(0, req.body.endMs);
    }

    // Trim: update trim points
    if (typeof req.body.trimInMs === "number") {
      patch.trimInMs = Math.max(0, req.body.trimInMs);
    }
    if (typeof req.body.trimOutMs === "number") {
      patch.trimOutMs = Math.max(0, req.body.trimOutMs);
    }

    // Track change
    if (typeof req.body.trackId === "string" && req.body.trackId.trim()) {
      patch.trackId = req.body.trackId.trim();
    }

    // Lane
    if (typeof req.body.lane === "number") {
      patch.lane = Math.max(0, Math.round(req.body.lane));
    }

    // Unlink: break the linkGroupId bond
    if (req.body.unlink === true) {
      patch.linkGroupId = null;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    patch.updatedAt = new Date();

    // If linked and not unlinking, apply movement/trim changes to linked partner(s)
    if (clipData.linkGroupId && !req.body.unlink) {
      const linkedSnap = await db
        .collection("timeline_clips")
        .where("linkGroupId", "==", clipData.linkGroupId)
        .get();

      const batch = db.batch();
      for (const linkedDoc of linkedSnap.docs) {
        if (linkedDoc.id === req.params.clipId) {
          // Current clip: apply all changes (movement, trim, track, lane, unlink)
          batch.update(linkedDoc.ref, patch);
        } else {
          // Linked partner: only sync movement and trim changes
          // (trackId and lane are intentionally excluded — each clip stays on its own track)
          const linkedPatch: Record<string, any> = { updatedAt: patch.updatedAt };
          if (patch.startMs !== undefined) linkedPatch.startMs = patch.startMs;
          if (patch.endMs !== undefined) linkedPatch.endMs = patch.endMs;
          if (patch.trimInMs !== undefined) linkedPatch.trimInMs = patch.trimInMs;
          if (patch.trimOutMs !== undefined) linkedPatch.trimOutMs = patch.trimOutMs;
          batch.update(linkedDoc.ref, linkedPatch);
        }
      }
      await batch.commit();
    } else {
      await clipRef.update(patch);
    }

    return res.json({ ok: true, clipId: req.params.clipId });
  } catch (err: any) {
    console.error("[projects] update timeline clip error:", err?.message || err);
    return res.status(500).json({ error: "Failed to update timeline clip" });
  }
});

// ── DELETE /:projectId/timeline/clips/:id — delete linked clips ─────────────
router.delete("/:projectId/timeline/clips/:clipId", requireAuth, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getProject(req.params.projectId);
    if (!project || project.ownerId !== uid) {
      return res.status(404).json({ error: "Project not found" });
    }

    const clipRef = db.collection("timeline_clips").doc(req.params.clipId);
    const clipSnap = await clipRef.get();
    if (!clipSnap.exists) {
      return res.status(404).json({ error: "Clip not found" });
    }

    const clipData = clipSnap.data() as any;
    if (clipData.projectId !== req.params.projectId) {
      return res.status(404).json({ error: "Clip not in this project" });
    }

    // If linked, delete both clips in the link group
    if (clipData.linkGroupId) {
      const linkedSnap = await db
        .collection("timeline_clips")
        .where("linkGroupId", "==", clipData.linkGroupId)
        .get();

      const batch = db.batch();
      for (const doc of linkedSnap.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();

      return res.json({ ok: true, deleted: linkedSnap.size });
    }

    // No link — delete just this clip
    await clipRef.delete();
    return res.json({ ok: true, deleted: 1 });
  } catch (err: any) {
    console.error("[projects] delete timeline clip error:", err?.message || err);
    return res.status(500).json({ error: "Failed to delete timeline clip" });
  }
});

// =============================================================================
// LEGACY ASSET ROUTES (preserved for backward compatibility)
// =============================================================================

// ── POST /:id/assets/upload — upload video to existing project ──────────────
router.post("/:id/assets/upload", requireAuth, upload.single("video") as any, async (req: any, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const project = await getProject(req.params.id);
    if (!project || project.ownerId !== uid) {
      return res.status(404).json({ error: "Project not found" });
    }

    const file = req.file;
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
    const ext = file.originalname.split(".").pop() || "mp4";
    const storagePath = `projects/${uid}/${req.params.id}/${timestamp}-${safeName}.${ext}`;

    await uploadVideo(file.buffer, storagePath, file.mimetype);

    const asset = await addAssetToProject({
      projectId: req.params.id,
      ownerId: uid,
      type: "upload",
      filename: `${title}.${ext}`,
      storageKey: storagePath,
      size: file.size,
      processingStatus: "ready",
    });

    return res.status(201).json({ asset: serializeAsset(asset) });
  } catch (err: any) {
    console.error("[projects] upload asset error:", err?.message || err);
    return res.status(500).json({ error: "Failed to upload asset" });
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
