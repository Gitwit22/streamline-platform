import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { Router, Request, Response } from "express";
import { firestore as db } from "../firebaseAdmin";
import multer from "multer";
import { uploadVideo, getSignedDownloadUrl } from "../lib/storageClient";
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

    const recordingSnap = await db.collection("recordings").doc(id).get();

    if (!recordingSnap.exists) {
      return res.status(404).json({ error: "Asset not found" });
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

    const recordingSnap = await db.collection("recordings").doc(id).get();

    if (!recordingSnap.exists) {
      return res.status(404).json({ error: "Asset not found" });
    }

    const data = recordingSnap.data();

    // Verify ownership
    if (data?.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const storage = await deleteRecordingStorage(data);

    // Delete from Firestore
    await db.collection("recordings").doc(id).delete();

    res.json({ ok: true, message: "Asset deleted", storage });
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
        duration: data.duration || 0,
        status: data.status || 'draft',
        userId: data.userId
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

    const newProject = {
      userId,
      name,
      assetId,
      createdAt: new Date(),
      updatedAt: new Date(),
      duration: 0,
      status: 'draft',
      timeline: []
    };

    const projectRef = await db.collection("editing_projects").add(newProject);

    res.json({
      id: projectRef.id,
      ...newProject,
      createdAt: newProject.createdAt.toISOString(),
      updatedAt: newProject.updatedAt.toISOString()
    });
  } catch (err: any) {
    console.error("Create project error:", err);
    res.status(500).json({ error: "Failed to create project" });
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
