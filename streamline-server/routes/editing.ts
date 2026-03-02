import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { Router, Request, Response } from "express";
import { firestore as db } from "../firebaseAdmin";
import multer from "multer";
import { uploadVideo, getSignedDownloadUrl, deleteFile } from "../lib/storageClient";
import { deleteRecordingStorage } from "../lib/recordingDeletion";
import { checkStorageLimit, updateStorageUsage } from "../usageHelper";
import { assertPlatformTranscodeEnabled } from "../lib/platformFlags";
import { requireAuth } from "../middleware/requireAuth";
import { LIMIT_ERRORS } from "../lib/limitErrors";
import { canAccessFeature } from "./featureAccess";

const router = Router();

type SegmentedPlatformFlags = {
  contentLibraryEnabled: boolean;
  projectsEnabled: boolean;
  editorEnabled: boolean;
  myContentEnabled: boolean;
  myContentRecordingsEnabled: boolean;
};

let cachedSegmentedFlags: SegmentedPlatformFlags | null = null;
let cachedSegmentedFlagsAt = 0;
const SEGMENTED_FLAGS_TTL_MS = 30 * 1000;

async function getSegmentedPlatformFlags(): Promise<SegmentedPlatformFlags> {
  const now = Date.now();
  if (cachedSegmentedFlags && now - cachedSegmentedFlagsAt < SEGMENTED_FLAGS_TTL_MS) {
    return cachedSegmentedFlags;
  }

  try {
    const [contentLibrarySnap, projectsSnap, editorSnap, myContentSnap, myContentRecordingsSnap] = await Promise.all([
      db.collection("featureFlags").doc("contentLibraryEnabled").get(),
      db.collection("featureFlags").doc("projectsEnabled").get(),
      db.collection("featureFlags").doc("editorEnabled").get(),
      db.collection("featureFlags").doc("myContentEnabled").get(),
      db.collection("featureFlags").doc("myContentRecordingsEnabled").get(),
    ]);

    const contentLibraryData = contentLibrarySnap.exists
      ? ((contentLibrarySnap.data() as any) || {})
      : {};
    const projectsData = projectsSnap.exists ? ((projectsSnap.data() as any) || {}) : {};
    const editorData = editorSnap.exists ? ((editorSnap.data() as any) || {}) : {};
    const myContentData = myContentSnap.exists ? ((myContentSnap.data() as any) || {}) : {};
    const myContentRecordingsData = myContentRecordingsSnap.exists
      ? ((myContentRecordingsSnap.data() as any) || {})
      : {};

    cachedSegmentedFlags = {
      // New segmented flags default to DISABLED when missing.
      contentLibraryEnabled: contentLibraryData.enabled === true,
      projectsEnabled: projectsData.enabled === true,
      editorEnabled: editorData.enabled === true,
      myContentEnabled: myContentData.enabled === true,
      myContentRecordingsEnabled: myContentRecordingsData.enabled === true,
    };
    cachedSegmentedFlagsAt = now;
    return cachedSegmentedFlags;
  } catch (err) {
    console.error("[editing] failed to load segmented platform flags", err);
    cachedSegmentedFlags = {
      contentLibraryEnabled: false,
      projectsEnabled: false,
      editorEnabled: false,
      myContentEnabled: false,
      myContentRecordingsEnabled: false,
    };
    cachedSegmentedFlagsAt = now;
    return cachedSegmentedFlags;
  }
}

async function assertSegmentEnabled(
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

async function assertMyContentRecordingsEnabled(res: Response): Promise<boolean> {
  const flags = await getSegmentedPlatformFlags();
  if (flags.myContentEnabled && flags.myContentRecordingsEnabled) return true;
  res.status(403).json({
    error: LIMIT_ERRORS.FEATURE_DISABLED,
    feature: "myContentRecordingsEnabled",
    reason: "My Content recordings are disabled platform-wide",
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
  access: boolean;
  maxProjects: number; // 0 => unlimited when access=true
  maxStorageGB: number;
  maxTracks?: number;
  maxResolution?: string | null;
};

async function getEditingPlanInfo(uid: string): Promise<EditingPlanInfo> {
  const userSnap = await db.collection("users").doc(uid).get();
  const userData = userSnap.exists ? ((userSnap.data() as any) || {}) : {};
  const planId = String(userData.planId || userData.plan || "free");

  const planSnap = await db.collection("plans").doc(planId).get();
  const planData = planSnap.exists ? ((planSnap.data() as any) || {}) : {};

  const editing = (planData.editing || {}) as any;
  const access = editing.access === true;
  const maxProjects = Number(editing.maxProjects ?? 0);
  const maxStorageGB = (() => {
    const gb = editing.maxStorageGB;
    const bytes = editing.maxStorageBytes;
    if (gb !== undefined && gb !== null) {
      const n = Number(gb);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    }
    if (bytes !== undefined && bytes !== null) {
      const n = Number(bytes);
      return Number.isFinite(n) ? Math.max(0, Math.round(n / (1024 * 1024 * 1024))) : 0;
    }
    return 0;
  })();

  return {
    planId,
    access,
    maxProjects: Number.isFinite(maxProjects) ? Math.max(0, Math.round(maxProjects)) : 0,
    maxStorageGB,
    maxTracks: typeof editing.maxTracks === "number" ? Math.max(0, Math.round(editing.maxTracks)) : undefined,
    maxResolution: typeof editing.maxResolution === "string" ? editing.maxResolution : (editing.maxResolution ?? null),
  };
}

async function assertEditingAccess(req: Request, res: Response): Promise<{ uid: string; plan: EditingPlanInfo } | null> {
  const uid = getAuthedUid(req);
  if (!uid) {
    res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    return null;
  }

  const plan = await getEditingPlanInfo(uid);
  if (!plan.access) {
    res.status(403).json({
      error: LIMIT_ERRORS.FEATURE_NOT_ENTITLED,
      reason: "Editing not available on your plan",
      planId: plan.planId,
    });
    return null;
  }

  return { uid, plan };
}

// Configure multer for memory storage (files stored in RAM temporarily)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB max
});

router.use(requireAuth);

// ============================================================================
// UPLOAD ENDPOINT - ✅ FIXED WITH MULTER
// ============================================================================

router.post(
  "/upload",
  upload.single('video') as any, // ✅ Parse file from FormData (typed as any for TS)
  async (req: Request, res: Response) => {
    try {
      console.log("📤 Upload request received");
      
      const file = (req as any).file;
      if (!file) {
        console.log("❌ No file in request");
        return res.status(400).json({ error: "No file uploaded" });
      }

      const userId = getAuthedUid(req);
      if (!userId) {
        return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
      }

      if (!(await assertSegmentEnabled(res, "contentLibraryEnabled"))) {
        return;
      }
      const title = req.body.title || file.originalname.replace(/\.[^/.]+$/, "");

      console.log(`📹 Uploading: ${title}`);
      console.log(`📦 Size: ${(file.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`👤 User: ${userId}`);

      // Check storage limits
      try {
        await checkStorageLimit(userId, file.size);
      } catch (err: any) {
        return res.status(409).json({
          error: LIMIT_ERRORS.LIMIT_EXCEEDED,
          details: err?.message || "Storage limit exceeded",
        });
      }

      // Generate unique filename
      const timestamp = Date.now();
      const safeName = title.replace(/[^a-z0-9]/gi, "-").toLowerCase();
      const fileName = `${timestamp}-${safeName}.${file.originalname.split('.').pop()}`;
      const path = `uploads/${userId}/${fileName}`;

      console.log(`☁️ Uploading to: ${path}`);

      // Upload to R2/S3
      const publicUrl = await uploadVideo(
        file.buffer,
        path,
        file.mimetype
      );

      console.log(`✅ Upload complete: ${publicUrl}`);

      // Update storage usage (best-effort)
      try {
        await updateStorageUsage(userId, file.size);
      } catch (err) {
        console.log("⚠️ Storage usage update failed (non-critical)");
      }

      // Create asset in Firestore
      const assetData = {
        userId,
        name: title,
        type: 'video',
        fileSize: file.size,
        videoUrl: publicUrl,
        storagePath: path,
        thumbnailUrl: null,
        duration: 0,
        createdAt: new Date(),
        source: 'upload'
      };

      const assetRef = await db.collection('editing_assets').add(assetData);
      console.log(`💾 Asset saved: ${assetRef.id}`);

      res.json({
        ok: true,
        assetId: assetRef.id,
        publicUrl,
        storagePath: path,
        message: "Upload successful"
      });
    } catch (err: any) {
      console.error("❌ Upload error:", err);
      res.status(500).json({ 
        error: err.message || "Upload failed",
        details: err.stack
      });
    }
  }
);

// ============================================================================
// ASSETS ENDPOINTS
// ============================================================================

// GET /api/editing/assets - Get all user's assets
router.get("/assets", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);

    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!(await assertMyContentRecordingsEnabled(res))) {
      return;
    }

    // Fetch all recordings for this user and convert to assets format
    const recordingsSnap = await db
      .collection("recordings")
      .where("userId", "==", userId)
      .get();

    const assets = recordingsSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: data.id || doc.id,
        name: data.title || "Untitled",
        type: 'video' as const,
        duration: data.duration || data.durationMinutes * 60 || 0,
        fileSize: 0,
        videoUrl: data.videoUrl || "",
        thumbnailUrl: data.thumbnailUrl || null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        source: 'stream' as const,
        roomId: data.roomName || data.roomId,
        userId: data.userId
      };
    });

    // Also fetch uploaded assets
    const uploadsSnap = await db
      .collection("editing_assets")
      .where("userId", "==", userId)
      .get();

    const uploads = uploadsSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name || "Untitled",
        type: data.type || 'video',
        duration: data.duration || 0,
        fileSize: data.fileSize || 0,
        videoUrl: data.videoUrl || "",
        thumbnailUrl: data.thumbnailUrl || null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        source: data.source || 'upload',
        userId: data.userId
      };
    });

    const allAssets = [...assets, ...uploads];
    res.json(allAssets);
  } catch (err: any) {
    console.error("Get assets error:", err);
    res.status(500).json({ error: "Failed to fetch assets" });
  }
});

// GET /api/editing/listall - Legacy endpoint
router.get("/listall", async (req: Request, res: Response) => {
  // Same as /assets
  try {
    const userId = getAuthedUid(req);
    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!(await assertMyContentRecordingsEnabled(res))) {
      return;
    }
    const recordingsSnap = await db.collection("recordings").where("userId", "==", userId).get();
    const uploadsSnap = await db.collection("editing_assets").where("userId", "==", userId).get();
    
    const assets = [...recordingsSnap.docs, ...uploadsSnap.docs].map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.title || data.name || "Untitled",
        type: 'video',
        videoUrl: data.videoUrl || "",
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        source: data.source || 'stream'
      };
    });

    res.json(assets);
  } catch (err: any) {
    console.error("listall error:", err);
    res.status(500).json({ error: "Failed to fetch assets" });
  }
});

// GET /api/editing/assets/:id - Get single asset by ID
router.get("/assets/:id", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!(await assertSegmentEnabled(res, "contentLibraryEnabled"))) {
      return;
    }

    // 1) Recordings-backed assets
    const recordingSnap = await db.collection("recordings").doc(id).get();
    if (recordingSnap.exists) {
      const data = recordingSnap.data();

      // Verify ownership
      if (data?.userId !== userId) {
        return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
      }

      const asset = {
        id: data?.id || recordingSnap.id,
        name: data?.title || "Untitled",
        duration: data?.duration || 0,
        source: "stream" as const,
        thumbnail: data?.thumbnailUrl || "",
        thumbnailUrl: data?.thumbnailUrl || null,
        videoUrl: data?.videoUrl || data?.publicExportUrl,
        fileSize: data?.fileSize,
        createdAt: data?.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
        userId: data?.userId,
      };

      return res.json(asset);
    }

    // 2) Uploaded assets
    const uploadSnap = await db.collection("editing_assets").doc(id).get();
    if (!uploadSnap.exists) {
      return res.status(404).json({ error: "Asset not found" });
    }

    const data = uploadSnap.data() as any;
    if (data?.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    return res.json({
      id: uploadSnap.id,
      name: data?.name || "Untitled",
      duration: data?.duration || 0,
      source: data?.source || "upload",
      thumbnail: data?.thumbnailUrl || "",
      thumbnailUrl: data?.thumbnailUrl || null,
      videoUrl: data?.videoUrl || "",
      fileSize: data?.fileSize || 0,
      createdAt: data?.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
      userId: data?.userId,
    });
  } catch (err: any) {
    console.error("get asset error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// DELETE /api/editing/assets/:id - Delete an asset
router.delete("/assets/:id", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!(await assertSegmentEnabled(res, "contentLibraryEnabled"))) {
      return;
    }

    // 1) Try recordings-backed assets
    const recordingSnap = await db.collection("recordings").doc(id).get();
    if (recordingSnap.exists) {
      const data = recordingSnap.data();

      // Verify ownership
      if (data?.userId !== userId) {
        return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
      }

      const storage = await deleteRecordingStorage(data);

      // Delete from Firestore
      await db.collection("recordings").doc(id).delete();

      return res.json({ ok: true, message: "Asset deleted", storage });
    }

    // 2) Try uploaded editing_assets
    const uploadSnap = await db.collection("editing_assets").doc(id).get();
    if (!uploadSnap.exists) {
      return res.status(404).json({ error: "Asset not found" });
    }

    const uploadData = uploadSnap.data() as any;

    // Verify ownership
    if (uploadData?.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const storagePath = typeof uploadData?.storagePath === "string" ? uploadData.storagePath : null;
    if (storagePath) {
      try {
        await deleteFile(storagePath);
      } catch (e: any) {
        console.warn("[editing] failed to delete asset storage", e?.message || e);
      }
    }

    await db.collection("editing_assets").doc(id).delete();
    return res.json({ ok: true, message: "Asset deleted" });
  } catch (err: any) {
    console.error("delete asset error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/editing/assets/from-recording - Convert recording to asset
router.post("/assets/from-recording", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    const { recordingId } = req.body;

    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!(await assertSegmentEnabled(res, "contentLibraryEnabled"))) {
      return;
    }

    if (!recordingId) {
      return res.status(400).json({ error: "recordingId is required" });
    }

    const recordingSnap = await db.collection("recordings").doc(recordingId).get();

    if (!recordingSnap.exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const data = recordingSnap.data();

    // Verify ownership
    if (data?.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const asset = {
      id: data?.id || recordingSnap.id,
      name: data?.title || "Untitled",
      duration: data?.duration || 0,
      source: "stream" as const,
      thumbnail: data?.thumbnailUrl || "",
      videoUrl: data?.videoUrl || data?.publicExportUrl,
      fileSize: data?.fileSize,
      createdAt: data?.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
      userId: data?.userId,
    };

    res.json(asset);
  } catch (err: any) {
    console.error("convert recording error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ============================================================================
// PROJECTS ENDPOINTS
// ============================================================================

// GET /api/editing/projects - List all projects
router.get("/projects", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!(await assertSegmentEnabled(res, "projectsEnabled"))) {
      return;
    }

    // Plan-based gating: projects are part of editing.
    const access = await assertEditingAccess(req, res);
    if (!access) return;
    
    const projectsSnap = await db
      .collection("editing_projects")
      .where("userId", "==", userId)
      .get();

    const projects = projectsSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        assetId: data.assetId,
        createdAt: data.createdAt?.toDate?.()?.toISOString(),
        updatedAt: data.updatedAt?.toDate?.()?.toISOString(),
        lastModified:
          data.updatedAt?.toDate?.()?.toISOString() ||
          data.createdAt?.toDate?.()?.toISOString() ||
          new Date().toISOString(),
        duration: data.duration || 0,
        status: data.status || 'draft',
        userId: data.userId,
        timeline: data.timeline || null,
      };
    });

    res.json(projects);
  } catch (err: any) {
    console.error("Get projects error:", err);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// POST /api/editing/projects - Create new project
router.post("/projects", async (req: Request, res: Response) => {
  try {
    const { name, assetId } = req.body;
    const userId = getAuthedUid(req);

    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    // Creating projects requires the editor surface.
    if (!(await assertSegmentEnabled(res, "projectsEnabled"))) {
      return;
    }
    if (!(await assertSegmentEnabled(res, "editorEnabled"))) {
      return;
    }

    const access = await assertEditingAccess(req, res);
    if (!access) return;

    // Enforce max projects (0 means unlimited when access=true)
    if (access.plan.maxProjects > 0) {
      const existingSnap = await db
        .collection("editing_projects")
        .where("userId", "==", userId)
        .get();
      if (existingSnap.size >= access.plan.maxProjects) {
        return res.status(409).json({
          error: LIMIT_ERRORS.LIMIT_EXCEEDED,
          reason: "Max projects limit reached",
          limit: access.plan.maxProjects,
        });
      }
    }

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    if (!assetId || typeof assetId !== "string" || !assetId.trim()) {
      return res.status(400).json({ error: "assetId is required" });
    }

    const newProject = {
      userId,
      name: String(name).trim(),
      assetId: String(assetId).trim(),
      createdAt: new Date(),
      updatedAt: new Date(),
      duration: 0,
      status: 'draft',
      timeline: {
        clips: [],
        tracks: 2,
      }
    };

    const projectRef = await db.collection("editing_projects").add(newProject);

    res.json({
      id: projectRef.id,
      ...newProject,
      createdAt: newProject.createdAt.toISOString(),
      updatedAt: newProject.updatedAt.toISOString(),
      lastModified: newProject.updatedAt.toISOString(),
    });
  } catch (err: any) {
    console.error("Create project error:", err);
    res.status(500).json({ error: "Failed to create project" });
  }
});

// GET /api/editing/projects/:id - Get a single project
router.get("/projects/:id", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    const { id } = req.params;
    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!(await assertSegmentEnabled(res, "projectsEnabled"))) {
      return;
    }

    const access = await assertEditingAccess(req, res);
    if (!access) return;

    const snap = await db.collection("editing_projects").doc(id).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Project not found" });
    }
    const data = snap.data() as any;
    if (data?.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    return res.json({
      id: snap.id,
      name: data?.name || "Untitled Project",
      assetId: data?.assetId,
      status: data?.status || "draft",
      lastModified:
        data?.updatedAt?.toDate?.()?.toISOString?.() ||
        data?.createdAt?.toDate?.()?.toISOString?.() ||
        new Date().toISOString(),
      duration: data?.duration || 0,
      thumbnail: data?.thumbnail || data?.thumbnailUrl || null,
      userId: data?.userId,
      timeline: data?.timeline || null,
    });
  } catch (err: any) {
    console.error("Get project error:", err);
    res.status(500).json({ error: "Failed to fetch project" });
  }
});

// PATCH /api/editing/projects/:id - Update project metadata
router.patch("/projects/:id", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    const { id } = req.params;
    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!(await assertSegmentEnabled(res, "projectsEnabled"))) {
      return;
    }

    const access = await assertEditingAccess(req, res);
    if (!access) return;

    const ref = db.collection("editing_projects").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Project not found" });
    }

    const existing = snap.data() as any;
    if (existing?.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const patch: any = { updatedAt: new Date() };
    if (typeof req.body?.name === "string" && req.body.name.trim()) {
      patch.name = req.body.name.trim();
    }
    if (typeof req.body?.status === "string") {
      patch.status = req.body.status;
    }

    await ref.set(patch, { merge: true });
    const merged = { ...(existing || {}), ...patch };

    return res.json({
      id,
      name: merged.name,
      assetId: merged.assetId,
      status: merged.status || "draft",
      lastModified: patch.updatedAt.toISOString(),
      duration: merged.duration || 0,
      thumbnail: merged.thumbnail || merged.thumbnailUrl || null,
      userId: merged.userId,
      timeline: merged.timeline || null,
    });
  } catch (err: any) {
    console.error("Update project error:", err);
    res.status(500).json({ error: "Failed to update project" });
  }
});

// DELETE /api/editing/projects/:id - Delete a project
router.delete("/projects/:id", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    const { id } = req.params;
    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!(await assertSegmentEnabled(res, "projectsEnabled"))) {
      return;
    }

    const access = await assertEditingAccess(req, res);
    if (!access) return;

    const ref = db.collection("editing_projects").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Project not found" });
    }

    const data = snap.data() as any;
    if (data?.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    await ref.delete();
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("Delete project error:", err);
    res.status(500).json({ error: "Failed to delete project" });
  }
});

// PUT /api/editing/projects/:id/timeline - Persist timeline clips
router.put("/projects/:id/timeline", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    const { id } = req.params;
    const { clips } = req.body as any;

    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }
    if (!(await assertSegmentEnabled(res, "editorEnabled"))) {
      return;
    }

    const access = await assertEditingAccess(req, res);
    if (!access) return;

    const ref = db.collection("editing_projects").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Project not found" });
    }
    const data = snap.data() as any;
    if (data?.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    if (!Array.isArray(clips)) {
      return res.status(400).json({ error: "clips must be an array" });
    }

    const sanitized = clips
      .map((c: any) => ({
        id: String(c?.id || ""),
        assetId: String(c?.assetId || ""),
        trackId: typeof c?.trackId === "string" ? c.trackId : "video_1",
        startTime: Math.max(0, Number(c?.startTime || 0)),
        duration: Math.max(0, Number(c?.duration || 0)),
        inPoint: Math.max(0, Number(c?.inPoint || 0)),
        outPoint: Math.max(0, Number(c?.outPoint || 0)),
        name: typeof c?.name === "string" ? c.name : "Clip",
        videoUrl: typeof c?.videoUrl === "string" ? c.videoUrl : "",
      }))
      .filter((c: any) => c.id && c.assetId);

    const timeline = {
      clips: sanitized,
      tracks: 2,
    };

    await ref.set(
      {
        timeline,
        updatedAt: new Date(),
      },
      { merge: true }
    );

    return res.json({ saved: true });
  } catch (err: any) {
    console.error("Save timeline error:", err);
    res.status(500).json({ error: "Failed to save timeline" });
  }
});

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

    const { projectId, settings } = (req.body || {}) as any;
    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "projectId is required" });
    }

    const projectSnap = await db.collection("editing_projects").doc(projectId).get();
    if (!projectSnap.exists) {
      return res.status(404).json({ error: "Project not found" });
    }
    const project = projectSnap.data() as any;
    if (project?.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const jobRef = db.collection("editing_exports").doc();
    const createdAt = new Date();

    // MVP: return the source asset's videoUrl as the downloadable output.
    let downloadUrl: string | undefined;
    try {
      const assetId = String(project.assetId || "");
      if (assetId) {
        const recordingSnap = await db.collection("recordings").doc(assetId).get();
        if (recordingSnap.exists) {
          const d = recordingSnap.data() as any;
          if (d?.userId === userId) downloadUrl = d?.videoUrl || d?.publicExportUrl;
        } else {
          const uploadSnap = await db.collection("editing_assets").doc(assetId).get();
          if (uploadSnap.exists) {
            const d = uploadSnap.data() as any;
            if (d?.userId === userId) downloadUrl = d?.videoUrl;
          }
        }
      }
    } catch {}

    const jobDoc: any = {
      id: jobRef.id,
      userId,
      projectId,
      settings: settings || null,
      status: downloadUrl ? "complete" : "failed",
      progress: downloadUrl ? 100 : 0,
      downloadUrl: downloadUrl || null,
      error: downloadUrl ? null : "No source video URL available",
      createdAt,
      completedAt: downloadUrl ? new Date() : null,
    };

    await jobRef.set(jobDoc);

    return res.json({
      id: jobDoc.id,
      projectId: jobDoc.projectId,
      status: jobDoc.status,
      progress: jobDoc.progress,
      downloadUrl: jobDoc.downloadUrl || undefined,
      error: jobDoc.error || undefined,
      createdAt: createdAt.toISOString(),
      completedAt: jobDoc.completedAt ? jobDoc.completedAt.toISOString() : undefined,
    });
  } catch (err: any) {
    console.error("Export error:", err);
    res.status(500).json({ error: err.message || "Failed to start export" });
  }
});

// GET /api/editing/exports/:exportId - Get export job status
router.get("/exports/:exportId", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    const { exportId } = req.params;
    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    const access = await assertEditingAccess(req, res);
    if (!access) return;

    const snap = await db.collection("editing_exports").doc(exportId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Export job not found" });
    }

    const data = snap.data() as any;
    if (data?.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    return res.json({
      id: snap.id,
      projectId: data?.projectId,
      status: data?.status,
      progress: Number(data?.progress || 0),
      downloadUrl: data?.downloadUrl || undefined,
      error: data?.error || undefined,
      createdAt: data?.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
      completedAt: data?.completedAt?.toDate?.()?.toISOString?.() || undefined,
    });
  } catch (err: any) {
    console.error("Get export status error:", err);
    res.status(500).json({ error: "Failed to fetch export status" });
  }
});

// ============================================================================
// RECORDINGS ENDPOINTS
// ============================================================================

// GET /api/editing/recordings/:id - Get recording details
router.get("/recordings/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
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
    res.json({
      id: recordingDoc.id,
      ...data,
      createdAt: data?.createdAt?.toDate?.()?.toISOString()
    });
  } catch (err: any) {
    console.error("Get recording error:", err);
    res.status(500).json({ error: "Failed to fetch recording" });
  }
});

// GET /api/editing/list - Get all recordings for the authenticated user
router.get("/list", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!(await assertSegmentEnabled(res, "contentLibraryEnabled"))) {
      return;
    }

    const recordingsSnap = await db
      .collection("recordings")
      .where("userId", "==", userId)
      .get();

    const recordings = recordingsSnap.docs
      .map((doc: any) => ({
        id: doc.id,
        ...doc.data(),
      }))
      .sort((a: any, b: any) => {
        // Sort by createdAt descending in memory
        const aTime = new Date(a.createdAt || 0).getTime();
        const bTime = new Date(b.createdAt || 0).getTime();
        return bTime - aTime;
      });

    res.json(recordings);
  } catch (err) {
    console.error("list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/editing/save - Save edit configuration for a recording
router.post("/save", async (req: Request, res: Response) => {
  try {
    const { recordingId, editConfig } = req.body;
    const userId = getAuthedUid(req);

    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!(await assertSegmentEnabled(res, "editorEnabled"))) {
      return;
    }

    if (!recordingId) {
      return res.status(400).json({ error: "recordingId is required" });
    }

    // Verify ownership
    const recordingSnap = await db.collection("recordings").doc(recordingId).get();

    if (!recordingSnap.exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const recordingData = recordingSnap.data() as any;
    if (recordingData.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    // Save edit config
    await db.collection("recordings").doc(recordingId).update({
      editConfig,
      updatedAt: new Date(),
    });

    res.json({ ok: true, message: "Edit config saved" });
  } catch (err) {
    console.error("save error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/editing/:recordingId - Update recording metadata (duration, status, viewer count)
router.put("/:recordingId", async (req: Request, res: Response) => {
  try {
    const { recordingId } = req.params;
    const { duration, status, viewerCount, peakViewers } = req.body;
    const userId = getAuthedUid(req);

    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!(await assertSegmentEnabled(res, "editorEnabled"))) {
      return;
    }

    if (!recordingId) {
      return res.status(400).json({ error: "recordingId is required" });
    }

    // Verify ownership
    const recordingSnap = await db.collection("recordings").doc(recordingId).get();

    if (!recordingSnap.exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const recordingData = recordingSnap.data() as any;
    if (recordingData.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    // Update recording metadata
    const updateData: any = { updatedAt: new Date() };
    if (typeof duration === 'number') updateData.duration = duration;
    if (status) updateData.status = status;
    if (typeof viewerCount === 'number') updateData.viewerCount = viewerCount;
    if (typeof peakViewers === 'number') updateData.peakViewers = peakViewers;

    await db.collection("recordings").doc(recordingId).update(updateData);

    console.log("✅ Recording updated:", { recordingId, ...updateData });

    res.json({
      ok: true,
      message: "Recording updated successfully",
      recording: { id: recordingId, ...updateData },
    });
  } catch (err: any) {
    console.error("❌ update recording error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/editing/render - Trigger render job for a recording
router.post("/render", async (req: Request, res: Response) => {
  try {
    if (!(await assertSegmentEnabled(res, "editorEnabled"))) {
      return;
    }
    if (!assertPlatformTranscodeEnabled(res)) {
      return;
    }

    const { recordingId, renderedBuffer } = req.body;
    const userId = getAuthedUid(req);

    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!recordingId) {
      return res.status(400).json({ error: "recordingId is required" });
    }

    // Verify ownership
    const recordingSnap = await db.collection("recordings").doc(recordingId).get();

    if (!recordingSnap.exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const recordingData = recordingSnap.data() as any;
    if (recordingData.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    // Update recording status to "rendering"
    await db.collection("recordings").doc(recordingId).update({
      status: "rendering",
      renderStartedAt: new Date(),
    });

    // ✅ PROMPT #4: When export finishes, upload rendered video to R2
    if (renderedBuffer) {
      try {
        const buffer = Buffer.from(renderedBuffer);
        
        // Check storage limit
        try {
          await checkStorageLimit(userId, buffer.byteLength);
        } catch (err: any) {
          return res.status(409).json({
            error: LIMIT_ERRORS.LIMIT_EXCEEDED,
            details: err?.message || "Storage limit exceeded",
          });
        }

        // Upload to R2
        const exportPath = `exports/${userId}/${recordingId}/${Date.now()}.mp4`;
        const publicUrl = await uploadVideo(buffer, exportPath, "video/mp4");

        // Update storage usage (best-effort)
        try {
          await updateStorageUsage(userId, buffer.byteLength);
        } catch (err) {
          console.log("⚠️ Storage usage update failed (non-critical)");
        }

        // Update recording with rendered path and URL
        await db.collection("recordings").doc(recordingId).update({
          status: "complete",
          renderedPath: exportPath,
          publicExportUrl: publicUrl,
          renderedAt: new Date(),
        });

        return res.json({
          status: "complete",
          recordingId,
          message: "Render and export completed",
          publicUrl,
          exportPath,
        });
      } catch (uploadErr: any) {
        console.error("Export upload failed:", uploadErr);
        await db.collection("recordings").doc(recordingId).update({
          status: "render_failed",
          error: uploadErr.message,
        });

        return res.status(500).json({
          error: "Failed to upload rendered video",
          details: uploadErr.message,
        });
      }
    }

    res.json({
      status: "queued",
      recordingId,
      message: "Render job queued",
    });
  } catch (err: any) {
    console.error("render error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/editing/create-recording - Create a new recording document when stream starts
router.post("/create-recording", async (req: Request, res: Response) => {
  try {
    const { roomName, title, viewerCount, peakViewers } = req.body;
    const userId = getAuthedUid(req);

    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    // Enforce plan entitlement + platform flag (default-enabled when missing)
    const access = await canAccessFeature(userId, "recording");
    if (!access.allowed) {
      return res.status(403).json({
        error: access.code || LIMIT_ERRORS.FEATURE_NOT_ENTITLED,
        reason: access.reason || "Recording not available",
      });
    }

    // Create new recording document
    const recordingRef = db.collection("recordings").doc();
    const recordingData = {
      id: recordingRef.id,
      userId,
      roomName: roomName || "default-room",
      title,
      status: "ready", // Immediately ready since we can't record the actual stream
      duration: 0,
      viewerCount: viewerCount || 0,
      peakViewers: peakViewers || 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      videoUrl: null, // Will be populated if video is uploaded
      thumbnailUrl: null,
      progress: 100,
      usageType: "recording_only",
    };

    await recordingRef.set(recordingData);

    console.log("✅ Recording created:", recordingData);

    res.json({
      ok: true,
      id: recordingRef.id,
      status: "ready",
      message: "Recording created successfully",
      recording: recordingData,
    });
  } catch (err: any) {
    console.error("❌ create-recording error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ============================================================================
// RECORDING START/STOP ENDPOINTS
// ============================================================================

// POST /api/recordings/start - Start a new recording session
router.post("/recordings/start", async (req: Request, res: Response) => {
  try {
    const { roomName, title } = req.body;
    const userId = getAuthedUid(req);

    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!roomName || !title) {
      return res.status(400).json({ error: "roomName and title required" });
    }

    // Enforce plan entitlement + platform flag (default-enabled when missing)
    const access = await canAccessFeature(userId, "recording");
    if (!access.allowed) {
      return res.status(403).json({
        error: access.code || LIMIT_ERRORS.FEATURE_NOT_ENTITLED,
        reason: access.reason || "Recording not available",
      });
    }

    // Create recording document
    const recordingRef = db.collection("recordings").doc();
    const recordingData = {
      id: recordingRef.id,
      userId,
      roomName,
      title,
      status: "recording",
      startedAt: new Date(),
      stoppedAt: null,
      duration: 0,
      viewerCount: 0,
      peakViewers: 0,
      videoUrl: null,
      thumbnailUrl: null,
      progress: 0,
      usageType: "recording_only",
    };

    await recordingRef.set(recordingData);

    console.log("✅ Recording started:", recordingRef.id);

    res.json({
      success: true,
      id: recordingRef.id,
      status: "recording",
    });
  } catch (err: any) {
    console.error("❌ recording start error:", err);
    res.status(500).json({ error: err.message || "Failed to start recording" });
  }
});

// POST /api/recordings/stop - Stop recording and finalize metadata
router.post("/recordings/stop", async (req: Request, res: Response) => {
  try {
    const { recordingId, duration, viewerCount, peakViewers } = req.body;
    const userId = getAuthedUid(req);

    if (!userId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    if (!recordingId) {
      return res.status(400).json({ error: "recordingId is required" });
    }

    // Update recording document
    const recordingRef = db.collection("recordings").doc(recordingId);

    const snap = await recordingRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const data = snap.data() as any;
    if (data?.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }
    
    await recordingRef.update({
      status: "ready",
      stoppedAt: new Date(),
      duration: duration || 0,
      viewerCount: viewerCount || 0,
      peakViewers: peakViewers || 0,
      progress: 100,
    });

    console.log("✅ Recording stopped:", recordingId);

    res.json({
      success: true,
      id: recordingId,
      status: "ready",
      duration: duration,
    });
  } catch (err: any) {
    console.error("❌ recording stop error:", err);
    res.status(500).json({ error: err.message || "Failed to stop recording" });
  }
});

export default router;
