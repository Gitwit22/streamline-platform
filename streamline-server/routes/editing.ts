/**
 * Editing API (/api/editing)
 *
 *   POST   /upload                              — upload to the content library (editing_assets)
 *   GET    /assets                              — unified MediaAsset list (recordings, uploads, saved/exported videos)
 *   GET    /assets/:id                          — one MediaAsset with a playable URL
 *   DELETE /assets/:id                          — delete a recording / upload / saved video (owner, ungated)
 *   POST   /export                              — export the canonical project timeline (projects/{id})
 *   GET    /exports/:exportId                   — export status
 *   POST   /exports/:exportId/cancel            — cancel
 *   POST   /exports/:exportId/save-to-library   — keep the output as a SavedVideo
 *   DELETE /exports/:exportId                   — delete the rendered output now (owner, ungated)
 *   GET    /recordings/:id                      — recording details with presigned playback URL
 *
 * Projects (create/list/load/save timeline) live under /api/projects.
 */
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { Router, Request, Response } from "express";
import { firestore as db } from "../firebaseAdmin";
import { uploadFileFromPath, getSignedDownloadUrl, deleteFile } from "../lib/storageClient";
import { createDiskUpload, cleanupUploadedFile, MAX_UPLOAD_BYTES, type UploadedDiskFile } from "../lib/diskUpload";
import { getAllowedExportSourceHosts, validateExportSourceUrl } from "../lib/exportSourceUrl";
import { deleteRecordingStorage } from "../lib/recordingDeletion";
import { reserveStorageIfAvailable, releaseReservedStorage, releaseStorageUsage } from "../usageHelper";
import { releaseRecordingStorageOnce } from "../lib/recordingUsage";
import { assertPlatformTranscodeEnabled } from "../lib/platformFlags";
import { requireAuth } from "../middleware/requireAuth";
import { LIMIT_ERRORS } from "../lib/limitErrors";
import { decideProjectCreate, projectCountNeeded } from "../lib/projectCreateGate";
import { getEffectiveEntitlements, getPlatformFlags } from "../lib/entitlements";
import { logger } from "../lib/logger";
import { normalizeExportSettings, resolutionToDimensions } from "../lib/exportTypes";
import { createExportJobWithReservation, getExportJob, cancelJob, getMonthlyExportsUsed } from "../lib/exportQueue";
import {
  EXPORT_FORMATS,
  EXPORT_FPS,
  EXPORT_QUALITIES,
  allowedResolutions,
  parseMaxResolution,
  readExportLimit,
  readPriorityQueue,
  readTransitionAccess,
  firstDisallowedTransition,
  resolutionAllowed,
  type ExportResolution,
} from "../lib/exportPolicyPure";
import { monthKeyUTC } from "../lib/streamingMeterPure";
import { countUserProjects, loadEditorProject } from "../lib/projectStore";
import { buildExportTimeline, type ResolvedClipSource } from "../lib/editorTimeline";
import { listMediaAssets, resolveMediaAsset, resolveMediaAssets, withPlayableUrl } from "../lib/mediaAssets";
import { inferMediaType, publicMediaAsset, uploadToMediaAsset } from "../lib/mediaAssetsPure";
import { probeMedia } from "../lib/mediaProbe";
import { deleteSavedVideo } from "../lib/savedVideos";
import { deleteExportOutput, saveExportToLibrary } from "../lib/exportLibrary";

const router = Router();

type SegmentedPlatformFlags = {
  contentLibraryEnabled: boolean;
  projectsEnabled: boolean;
  editorEnabled: boolean;
  myContentEnabled: boolean;
  myContentRecordingsEnabled: boolean;
};

async function getSegmentedPlatformFlags(): Promise<SegmentedPlatformFlags> {
  // Single platform-flag source (lib/entitlements/flags.ts defaults table:
  // these surface switches default to ENABLED when the doc is missing).
  const flags = await getPlatformFlags();
  return {
    contentLibraryEnabled: flags.contentLibraryEnabled,
    projectsEnabled: flags.projectsEnabled,
    editorEnabled: flags.editorEnabled,
    myContentEnabled: flags.myContentEnabled,
    myContentRecordingsEnabled: flags.myContentRecordingsEnabled,
  };
}

export async function assertSegmentEnabled(
  res: Response,
  key: keyof SegmentedPlatformFlags,
): Promise<boolean> {
  const flags = await getSegmentedPlatformFlags();
  if (flags[key]) return true;
  res.status(403).json({
    error: LIMIT_ERRORS.FEATURE_DISABLED,
    feature: key,
    reason: "Feature disabled platform-wide",
  });
  return false;
}

function getAuthedUid(req: Request): string | null {
  const user = (req as any).user;
  const uid = typeof user?.uid === "string" ? user.uid : null;
  return uid;
}

type EditingPlanInfo = {
  planId: string;
  /** Plan includes the editor (before platform switches). */
  access: boolean;
  /** Plan includes projects (before platform switches). */
  projectsAccess: boolean;
  /** Plan includes the content library (before platform switches). */
  contentLibraryAccess: boolean;
  /** null = unlimited, 0 = none. */
  maxProjects: number | null;
  /** null = unlimited, 0 = none. */
  maxStorageBytes: number | null;
  maxTracks?: number;
  /** Export resolution cap; null = no cap. */
  maxResolution: ExportResolution | null;
  /** Monthly export cap; null = unlimited, 0 = none. */
  exportsPerMonth: number | null;
  /** Plan renders ahead of the FIFO queue. */
  priorityQueue: boolean;
  /** basic = fade / dip to black, advanced = crossfade. */
  transitions: { basic: boolean; advanced: boolean };
};

type EditingPlanFeature = "editing" | "projects" | "contentLibrary";

/** Editing plan info from the EFFECTIVE entitlements (override / admin / base plan). */
async function getEditingPlanInfo(uid: string): Promise<EditingPlanInfo> {
  const ent = await getEffectiveEntitlements(uid);
  const editing = (ent.plan.raw?.editing || {}) as any;
  return {
    planId: ent.planId,
    access: ent.planFeatures.editing,
    projectsAccess: ent.planFeatures.projects,
    contentLibraryAccess: ent.planFeatures.contentLibrary,
    maxProjects: ent.limits.projects,
    maxStorageBytes: ent.limits.storageBytes,
    maxTracks: typeof editing.maxTracks === "number" ? Math.max(0, Math.round(editing.maxTracks)) : undefined,
    maxResolution: parseMaxResolution(editing.maxResolution),
    exportsPerMonth: readExportLimit(editing),
    priorityQueue: readPriorityQueue(editing),
    transitions: readTransitionAccess(editing),
  };
}

/**
 * Plan gate for editing surfaces (create/use). Platform surface switches are
 * checked separately by assertSegmentEnabled (FEATURE_DISABLED). Never use
 * this on delete / cleanup routes.
 */
export async function assertEditingAccess(
  req: Request,
  res: Response,
  feature: EditingPlanFeature = "editing",
): Promise<{ uid: string; plan: EditingPlanInfo } | null> {
  const uid = getAuthedUid(req);
  if (!uid) {
    res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    return null;
  }

  const plan = await getEditingPlanInfo(uid);
  const allowed =
    feature === "projects" ? plan.projectsAccess : feature === "contentLibrary" ? plan.contentLibraryAccess : plan.access;
  if (!allowed) {
    res.status(403).json({
      error: LIMIT_ERRORS.FEATURE_NOT_ENTITLED,
      reason: feature === "projects" ? "Projects are not available on your plan" : "Editing not available on your plan",
      planId: plan.planId,
    });
    return null;
  }

  return { uid, plan };
}

/**
 * Shared gate for creating a project (POST /api/projects): projects
 * platform switch + plan projects feature +
 * limits.projects (null = unlimited, 0 = none). Sends the error and returns
 * false when creation is not allowed.
 */
export async function assertCanCreateProject(req: Request, res: Response): Promise<boolean> {
  if (!(await assertSegmentEnabled(res, "projectsEnabled"))) return false;
  const access = await assertEditingAccess(req, res, "projects");
  if (!access) return false;
  const limit = access.plan.maxProjects;
  const decision = decideProjectCreate({
    planHasProjects: true, // checked by assertEditingAccess above
    planId: access.plan.planId,
    limit,
    existingCount: projectCountNeeded(limit) ? await countUserProjects(access.uid) : 0,
  });
  if (!decision.allowed) {
    res.status(decision.status).json(decision.body);
    return false;
  }
  return true;
}

// Multipart uploads are spooled to os.tmpdir() (not RAM) and streamed to R2.
const upload = createDiskUpload(MAX_UPLOAD_BYTES);

router.use(requireAuth);

/** Feature gate for uploads; runs before multer so a disabled feature never spools a file. */
export async function requireContentLibraryUploadsEnabled(_req: Request, res: Response, next: () => void) {
  if (!(await assertSegmentEnabled(res, "contentLibraryEnabled"))) return;
  next();
}

// ============================================================================
// UPLOAD ENDPOINT — content library upload (editing_assets)
// ============================================================================

router.post(
  "/upload",
  requireContentLibraryUploadsEnabled as any,
  upload.single('video') as any,
  async (req: Request, res: Response) => {
    const file = (req as any).file as UploadedDiskFile | undefined;
    try {
      if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const userId = getAuthedUid(req);
      if (!userId) {
        return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
      }

      const mediaType = inferMediaType(file.mimetype, file.originalname);
      const mime = String(file.mimetype || "").toLowerCase();
      if (mime && !/^(video|audio|image)\//.test(mime) && mime !== "application/octet-stream") {
        return res.status(400).json({ error: "Only video, audio and image files are accepted" });
      }

      const title = req.body.title || file.originalname.replace(/\.[^/.]+$/, "");

      console.log(`[editing] upload ${(file.size / 1024 / 1024).toFixed(2)} MB (${mediaType}) for user ${userId}`);

      // Transactional reservation: atomically check limit + increment counter.
      const reservation = await reserveStorageIfAvailable(userId, file.size, {
        caller: "editing.upload",
      });
      if (!reservation.reserved) {
        return res.status(409).json({
          error: LIMIT_ERRORS.LIMIT_EXCEEDED,
          details: reservation.reason || "Storage limit exceeded",
        });
      }

      // Duration + stream layout (best effort; ffprobe on the spooled file).
      const probe = mediaType === "image" ? null : await probeMedia(file.path);

      // Generate unique filename
      const timestamp = Date.now();
      const safeName = String(title).replace(/[^a-z0-9]/gi, "-").toLowerCase();
      const ext = (file.originalname.split('.').pop() || "mp4").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "mp4";
      const fileName = `${timestamp}-${safeName}.${ext}`;
      const path = `uploads/${userId}/${fileName}`;

      let publicUrl: string | null = null;
      try {
        publicUrl = await uploadFileFromPath(file.path, path, file.mimetype);

        const assetData = {
          userId,
          name: title,
          type: mediaType,
          mimeType: file.mimetype || null,
          fileSize: file.size,
          videoUrl: publicUrl,
          storagePath: path,
          thumbnailUrl: null,
          duration: probe ? probe.durationMs / 1000 : 0,
          hasVideo: probe ? probe.hasVideo : mediaType === "video",
          hasAudio: probe ? probe.hasAudio : mediaType !== "image",
          createdAt: new Date(),
          source: 'upload'
        };

        const assetRef = await db.collection('editing_assets').add(assetData);
        const asset = await withPlayableUrl(uploadToMediaAsset(assetRef.id, assetData));

        return res.json({
          ok: true,
          assetId: assetRef.id,
          publicUrl,
          storagePath: path,
          asset: publicMediaAsset(asset),
          message: "Upload successful"
        });
      } catch (uploadErr: any) {
        // Upload (or the asset record) failed: remove the object and release
        // the reserved bytes so they aren't stranded.
        if (publicUrl) {
          await deleteFile(path).catch(() => {});
        }
        try {
          await releaseReservedStorage(userId, file.size, {
            caller: "editing.upload.rollback",
            storagePath: path,
          });
        } catch (releaseErr: any) {
          console.error("[editing] CRITICAL: failed to release reservation after upload failure", {
            userId, storagePath: path, fileSizeBytes: file.size,
            uploadError: uploadErr?.message, releaseError: releaseErr?.message,
          });
        }
        throw uploadErr;
      }
    } catch (err: any) {
      console.error("[editing] upload error:", err?.message || err);
      res.status(500).json({ error: "Upload failed" });
    } finally {
      await cleanupUploadedFile(file);
    }
  }
);

// ============================================================================
// MEDIA ASSETS — one listing for recordings, uploads and saved/exported videos
// ============================================================================

// GET /api/editing/assets — unified MediaAsset list (type: recording | video | audio | image)
router.get("/assets", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    // Platform surface switches decide which sources are listed; the client
    // additionally hides sections the plan does not include.
    const flags = await getSegmentedPlatformFlags();
    const recordings = flags.myContentEnabled && flags.myContentRecordingsEnabled;
    const uploads = flags.contentLibraryEnabled;
    if (!recordings && !uploads) {
      return res.status(403).json({
        error: LIMIT_ERRORS.FEATURE_DISABLED,
        feature: "contentLibraryEnabled",
        reason: "Content library is disabled platform-wide",
      });
    }

    const assets = await listMediaAssets(userId, { recordings, uploads });
    res.json(assets.map(publicMediaAsset));
  } catch (err: any) {
    console.error("Get assets error:", err);
    res.status(500).json({ error: "Failed to fetch assets" });
  }
});

// GET /api/editing/assets/:id — one asset (any backing collection) with a playable URL
router.get("/assets/:id", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }
    // Reading the caller's own asset is never gated by plan or platform switches.
    const asset = await resolveMediaAsset(userId, String(req.params.id ?? ""));
    if (!asset) {
      return res.status(404).json({ error: "Asset not found" });
    }
    return res.json(publicMediaAsset(await withPlayableUrl(asset)));
  } catch (err: any) {
    console.error("get asset error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/editing/assets/:id — delete a recording, uploaded asset or saved video
router.delete("/assets/:id", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    const id = String(req.params.id ?? "");

    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    // Cleanup is never gated by plan or platform switches (owner check only).

    // 1) Try recordings-backed assets
    const recordingSnap = await db.collection("recordings").doc(id).get();
    if (recordingSnap.exists) {
      const data = recordingSnap.data();

      // Verify ownership
      if (data?.userId !== userId) {
        return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
      }

      const storage = await deleteRecordingStorage(data);

      // Release counted storage from the recording's billing uid (room owner)
      // exactly once; transactional and gated on storageCounted/storageReleased.
      try {
        await releaseRecordingStorageOnce(recordingSnap.ref, { caller: "editing.DELETE.recording" });
      } catch (e: any) {
        console.error("[editing] storage release failed for recording asset:", {
          userId, docId: id, error: e?.message || e,
        });
      }

      // Delete from Firestore
      await db.collection("recordings").doc(id).delete();

      return res.json({ ok: true, message: "Asset deleted", storage });
    }

    // 2) Try uploaded editing_assets
    const uploadSnap = await db.collection("editing_assets").doc(id).get();
    if (!uploadSnap.exists) {
      // 3) Saved / exported videos (saved_videos)
      const r = await deleteSavedVideo(userId, id, "editing.DELETE.savedVideo");
      if (r.status === 404) return res.status(404).json({ error: "Asset not found" });
      if (r.status === 403) return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
      return res.status(r.status).json({ ...r.body, message: "Asset deleted" });
    }

    const uploadData = uploadSnap.data() as any;

    // Verify ownership
    if (uploadData?.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    // Capture file size before deletion
    const fileSize = typeof uploadData?.fileSize === "number" ? uploadData.fileSize : 0;

    const storagePath = typeof uploadData?.storagePath === "string" ? uploadData.storagePath : null;
    if (storagePath) {
      try {
        await deleteFile(storagePath);
      } catch (e: any) {
        console.warn("[editing] failed to delete asset storage", e?.message || e);
      }

      // Release storage quota after R2 bytes are removed
      if (fileSize > 0) {
        try {
          await releaseStorageUsage(userId, fileSize, {
            caller: "editing.DELETE.upload",
            docId: id,
            storagePath,
          });
        } catch (e: any) {
          console.error("[editing] storage release failed for uploaded asset:", {
            userId, docId: id, fileSize, storagePath, error: e?.message || e,
          });
        }
      }
    }

    await db.collection("editing_assets").doc(id).delete();
    return res.json({ ok: true, message: "Asset deleted" });
  } catch (err: any) {
    console.error("delete asset error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// EXPORTS — render the canonical project timeline (projects/{id}.timeline)
// ============================================================================

// POST /api/editing/export - Create an export job for a project
router.post("/export", async (req: Request, res: Response) => {
  try {
    if (!(await assertSegmentEnabled(res, "editorEnabled"))) {
      return;
    }
    if (!assertPlatformTranscodeEnabled(res)) {
      return;
    }

    const userId = getAuthedUid(req);
    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    const access = await assertEditingAccess(req, res);
    if (!access) return;

    const { projectId, settings: rawSettings } = (req.body || {}) as any;
    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    // projects/{id} (canonical); legacy editing_projects ids migrate lazily.
    const loaded = await loadEditorProject(userId, projectId);
    if (!loaded) {
      return res.status(404).json({ error: "Project not found" });
    }
    if (!loaded.timeline || loaded.timeline.clips.length === 0) {
      return res.status(400).json({ error: "timeline_empty", reason: "Add clips and save the project before exporting" });
    }

    // Normalise settings, then apply the plan's resolution cap (refuse,
    // don't silently downgrade, so the UI and the output always agree).
    const settings = normalizeExportSettings(rawSettings);
    if (!resolutionAllowed(settings.resolution, access.plan.maxResolution)) {
      return res.status(403).json({
        error: LIMIT_ERRORS.FEATURE_NOT_ENTITLED,
        reason: `Your plan exports up to ${String(access.plan.maxResolution).toUpperCase()}`,
        maxResolution: access.plan.maxResolution,
      });
    }
    const { width, height } = resolutionToDimensions(settings.resolution);
    const blockedTransition = firstDisallowedTransition(loaded.timeline.clips, access.plan.transitions);
    if (blockedTransition) {
      return res.status(403).json({
        error: LIMIT_ERRORS.FEATURE_NOT_ENTITLED,
        reason:
          blockedTransition === "crossfade"
            ? "Crossfade transitions aren't included in your plan"
            : "Transitions aren't included in your plan",
        transition: blockedTransition,
      });
    }

    // Resolve every clip's source from the caller's own MediaAssets (storage
    // key preferred; the worker presigns it). A stored URL is used only when
    // it is on an allowlisted storage host (SSRF guard).
    const allowedHosts = getAllowedExportSourceHosts();
    const assets = await resolveMediaAssets(userId, loaded.timeline.clips.map((c) => c.assetId));
    const sources = new Map<string, ResolvedClipSource>();
    for (const [id, a] of assets) {
      const mediaType = a.type === "recording" ? "video" : a.type;
      if (a.storageKey) {
        sources.set(id, { sourceKey: a.storageKey, mediaType });
      } else if (a.videoUrl && validateExportSourceUrl(a.videoUrl, allowedHosts).ok) {
        sources.set(id, { sourceUrl: a.videoUrl, mediaType });
      }
    }

    const built = buildExportTimeline(loaded.timeline, sources, { width, height, fps: settings.fps || 30 });
    if ("error" in built) {
      return res.status(400).json({
        error: built.error,
        clipId: built.clipId,
        reason: built.error === "clip_source_unavailable"
          ? "A clip's media is missing, deleted or not on an allowed storage host"
          : "Nothing to export",
      });
    }

    // Create the durable export job, counting it against the monthly cap.
    const created = await createExportJobWithReservation({
      userId,
      projectId: loaded.project.id,
      settings,
      timeline: built.timeline,
      monthKey: monthKeyUTC(),
      limit: access.plan.exportsPerMonth,
      priority: access.plan.priorityQueue,
    });
    if ("limitReached" in created) {
      return res.status(403).json({
        error: LIMIT_ERRORS.LIMIT_EXCEEDED,
        reason: `You've used all ${access.plan.exportsPerMonth} exports for this month`,
        limit: access.plan.exportsPerMonth,
        used: created.used,
      });
    }
    const job = created.job;

    return res.json({
      id: job.id,
      projectId: loaded.project.id,
      status: job.status,
      progressPercent: job.progressPercent,
      currentStep: job.currentStep,
      createdAt: job.createdAt instanceof Date ? job.createdAt.toISOString() : String(job.createdAt),
    });
  } catch (err: any) {
    logger.error({ err: err?.message || String(err) }, "Export creation error");
    res.status(500).json({ error: "Failed to start export" });
  }
});

// GET /api/editing/export-options - What this user's plan allows for exports
router.get("/export-options", async (req: Request, res: Response) => {
  try {
    if (!(await assertSegmentEnabled(res, "editorEnabled"))) return;
    const access = await assertEditingAccess(req, res);
    if (!access) return;
    const used = await getMonthlyExportsUsed(access.uid, monthKeyUTC());
    return res.json({
      resolutions: allowedResolutions(access.plan.maxResolution),
      maxResolution: access.plan.maxResolution,
      formats: [...EXPORT_FORMATS],
      qualities: [...EXPORT_QUALITIES],
      fpsOptions: [...EXPORT_FPS],
      exportsUsed: used,
      exportsLimit: access.plan.exportsPerMonth,
      priority: access.plan.priorityQueue,
      transitions: access.plan.transitions,
    });
  } catch (err: any) {
    logger.error({ err: err?.message || String(err) }, "Export options error");
    res.status(500).json({ error: "Failed to load export options" });
  }
});

// GET /api/editing/exports/:exportId - Get export job status
router.get("/exports/:exportId", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    const exportId = String(req.params.exportId ?? "");
    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    const job = await getExportJob(exportId);
    if (!job) {
      return res.status(404).json({ error: "Export job not found" });
    }
    if (job.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const toISO = (d: any) => {
      if (!d) return undefined;
      if (d instanceof Date) return d.toISOString();
      if (typeof d?.toDate === "function") return d.toDate().toISOString();
      return String(d);
    };

    // The bucket is private: hand out a short-lived presigned link while the
    // rendered file still exists (not expired / moved to the library).
    const raw = job as any;
    let url: string | undefined;
    if (job.status === "completed" && job.outputPath && raw.outputExpired !== true && !raw.savedVideoId) {
      url = await getSignedDownloadUrl(job.outputPath, 3600).catch(() => job.outputUrl || undefined);
    }

    return res.json({
      id: job.id,
      projectId: job.projectId,
      status: job.status,
      progressPercent: job.progressPercent,
      progress: job.progressPercent,       // alias for backward compat
      currentStep: job.currentStep,
      outputUrl: url,
      downloadUrl: url,                    // alias for backward compat
      outputExpired: raw.outputExpired === true,
      savedVideoId: raw.savedVideoId || null,
      error: job.errorMessage || undefined,
      attemptCount: job.attemptCount,
      createdAt: toISO(job.createdAt),
      startedAt: toISO(job.startedAt),
      completedAt: toISO(job.completedAt),
    });
  } catch (err: any) {
    logger.error({ err: err?.message || String(err) }, "Get export status error");
    res.status(500).json({ error: "Failed to fetch export status" });
  }
});

// POST /api/editing/exports/:exportId/cancel - Cancel a pending export
router.post("/exports/:exportId/cancel", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    const exportId = String(req.params.exportId ?? "");
    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    const job = await getExportJob(exportId);
    if (!job) {
      return res.status(404).json({ error: "Export job not found" });
    }
    if (job.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const canceled = await cancelJob(exportId);
    if (!canceled) {
      return res.status(409).json({ error: "Job cannot be canceled (already terminal)" });
    }

    return res.json({ id: exportId, status: "canceled" });
  } catch (err: any) {
    logger.error({ err: err?.message || String(err) }, "Cancel export error");
    res.status(500).json({ error: "Failed to cancel export" });
  }
});

// POST /api/editing/exports/:exportId/save-to-library — keep the rendered
// video as a SavedVideo (stable key, storage stays on the owner).
router.post("/exports/:exportId/save-to-library", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }
    if (!(await assertSegmentEnabled(res, "editorEnabled"))) return;
    const access = await assertEditingAccess(req, res);
    if (!access) return;

    const title = typeof req.body?.title === "string" ? req.body.title.slice(0, 200) : undefined;
    const result = await saveExportToLibrary(userId, String(req.params.exportId ?? ""), title);
    if ("error" in result) {
      if (result.status === 403) return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
      return res.status(result.status).json({ error: result.error });
    }
    const asset = await resolveMediaAsset(userId, result.savedVideoId);
    return res.status(result.created ? 201 : 200).json({
      ok: true,
      savedVideoId: result.savedVideoId,
      created: result.created,
      asset: asset ? publicMediaAsset(await withPlayableUrl(asset)) : null,
    });
  } catch (err: any) {
    logger.error({ err: err?.message || String(err) }, "Save export to library error");
    res.status(500).json({ error: "Failed to save export to library" });
  }
});

// DELETE /api/editing/exports/:exportId — delete the rendered output now
// (owner cleanup, never plan-gated; the job doc is kept as history).
router.delete("/exports/:exportId", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }
    const r = await deleteExportOutput(userId, String(req.params.exportId ?? ""));
    if (r.status === 403) return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    return res.status(r.status).json(r.body);
  } catch (err: any) {
    logger.error({ err: err?.message || String(err) }, "Delete export output error");
    res.status(500).json({ error: "Failed to delete export output" });
  }
});

// ============================================================================
// RECORDINGS ENDPOINTS
// ============================================================================

// GET /api/editing/recordings/:id - Get recording details
router.get("/recordings/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    const userId = getAuthedUid(req);

    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!(await assertSegmentEnabled(res, "contentLibraryEnabled"))) {
      return;
    }

    const recordingDoc = await db.collection("recordings").doc(id).get();

    if (!recordingDoc.exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const data = recordingDoc.data();

    if (data?.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    // Generate a presigned playback URL from the R2 object key.
    // The raw videoUrl in Firestore is either empty (stream recordings never
    // set it) or a private bucket URL that 403s.  A short-lived signed URL
    // lets the <video> element play the file directly.
    let videoUrl = data?.videoUrl || "";
    const storageKey = data?.objectKey || data?.downloadPath;
    if (storageKey && data?.status === "ready") {
      try {
        videoUrl = await getSignedDownloadUrl(storageKey, 3600);
      } catch (e) {
        console.warn("[editing] signed-url generation failed for recording", id, e);
      }
    }

    res.json({
      id: recordingDoc.id,
      ...data,
      videoUrl,
      createdAt: data?.createdAt?.toDate?.()?.toISOString()
    });
  } catch (err: any) {
    console.error("Get recording error:", err);
    res.status(500).json({ error: "Failed to fetch recording" });
  }
});

export default router;
