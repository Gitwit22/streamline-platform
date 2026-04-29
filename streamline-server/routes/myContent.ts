/**
 * My Content API — SavedVideo (Layer 1)
 *
 * The global asset library. Assets come from two sources only:
 *   1. StreamLine recorded streams (status must be "ready")
 *   2. Device uploads (≤ 500 MB, no external URLs/links)
 *
 * Firestore collection: saved_videos
 *
 * Routes:
 *   GET    /api/my-content                — list user's saved videos
 *   DELETE /api/my-content/:id            — remove from library
 *   POST   /api/my-content/from-recordings — batch create from recordings
 *   POST   /api/my-content/upload         — multipart upload, 500 MB max
 */

import { Router, Request, Response } from "express";
import multer from "multer";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { uploadVideo, deleteFile } from "../lib/storageClient";
import { reserveStorageIfAvailable, releaseReservedStorage, releaseStorageUsage } from "../usageHelper";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { LIMIT_ERRORS } from "../lib/limitErrors";

const router = Router();

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

function getAuthedUid(req: Request): string | null {
  const user = (req as any).user;
  return typeof user?.uid === "string" ? user.uid : null;
}

function tsToIso(ts: any): string | null {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === "string") return ts;
  return null;
}

router.use(requireAuth);

// ── GET / — list user's saved videos ─────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    if (!userId) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const snap = await db
      .collection("saved_videos")
      .where("userId", "==", userId)
      .get();

    const items = snap.docs
      .map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          userId: d.userId,
          title: d.title || "Untitled",
          sourceType: d.sourceType || "upload",
          sourceId: d.sourceId || null,
          playbackUrl: d.playbackUrl || "",
          downloadUrl: d.downloadUrl || null,
          thumbnailUrl: d.thumbnailUrl || null,
          durationMs: typeof d.durationMs === "number" ? d.durationMs : 0,
          sizeBytes: typeof d.sizeBytes === "number" ? d.sizeBytes : 0,
          hasEmbeddedAudio: d.hasEmbeddedAudio !== false,
          status: d.status || "ready",
          createdAt: tsToIso(d.createdAt) || new Date().toISOString(),
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return res.json(items);
  } catch (err: any) {
    console.error("[my-content] list error:", err?.message || err);
    return res.status(500).json({ error: "Failed to list saved videos" });
  }
});

// ── DELETE /:id — remove from library ────────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    if (!userId) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ref = db.collection("saved_videos").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Saved video not found" });

    const data = snap.data() as any;
    if (data.userId !== userId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    // Capture file size before deletion for storage accounting
    const sizeBytes = typeof data.sizeBytes === "number" ? data.sizeBytes : 0;

    // Delete storage if it was an upload (has a storagePath)
    const storagePath = typeof data.storagePath === "string" ? data.storagePath : null;
    if (storagePath) {
      try {
        await deleteFile(storagePath);
      } catch (e: any) {
        console.warn("[my-content] storage delete failed:", e?.message || e);
      }

      // Release storage quota after R2 bytes are removed
      if (sizeBytes > 0) {
        try {
          await releaseStorageUsage(userId, sizeBytes, {
            caller: "myContent.DELETE",
            docId: req.params.id,
            storagePath,
          });
        } catch (e: any) {
          console.error("[my-content] storage release failed:", {
            userId, docId: req.params.id, sizeBytes, storagePath,
            error: e?.message || e,
          });
        }
      }
    }

    await ref.delete();
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[my-content] delete error:", err?.message || err);
    return res.status(500).json({ error: "Failed to delete saved video" });
  }
});

// ── POST /from-recordings — batch create SavedVideo records from recordings ──
router.post("/from-recordings", async (req: Request, res: Response) => {
  try {
    const userId = getAuthedUid(req);
    if (!userId) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const { recordingIds } = req.body;
    if (!Array.isArray(recordingIds) || recordingIds.length === 0) {
      return res.status(400).json({ error: "recordingIds must be a non-empty array" });
    }

    // Limit batch size to prevent abuse
    if (recordingIds.length > 50) {
      return res.status(400).json({ error: "Maximum 50 recordings per batch" });
    }

    const created: any[] = [];
    const errors: any[] = [];

    for (const recordingId of recordingIds) {
      if (typeof recordingId !== "string" || !recordingId.trim()) {
        errors.push({ recordingId, error: "Invalid recording ID" });
        continue;
      }

      try {
        // Check for existing duplicate
        const dupSnap = await db
          .collection("saved_videos")
          .where("userId", "==", userId)
          .where("sourceType", "==", "recording")
          .where("sourceId", "==", recordingId)
          .limit(1)
          .get();

        if (!dupSnap.empty) {
          const existing = dupSnap.docs[0];
          const d = existing.data();
          created.push({
            id: existing.id,
            ...d,
            createdAt: tsToIso(d.createdAt) || new Date().toISOString(),
            duplicate: true,
          });
          continue;
        }

        // Fetch the recording
        const recSnap = await db.collection("recordings").doc(recordingId).get();
        if (!recSnap.exists) {
          errors.push({ recordingId, error: "Recording not found" });
          continue;
        }

        const recData = recSnap.data() as any;
        if (recData.userId !== userId) {
          errors.push({ recordingId, error: "Forbidden" });
          continue;
        }

        if (recData.status !== "ready") {
          errors.push({ recordingId, error: "Recording is not ready", status: recData.status });
          continue;
        }

        const now = new Date();
        const savedVideo = {
          userId,
          title: recData.title || recData.roomName || "Untitled Recording",
          sourceType: "recording" as const,
          sourceId: recordingId,
          playbackUrl: recData.videoUrl || "",
          downloadUrl: recData.videoUrl || null,
          thumbnailUrl: recData.thumbnailUrl || null,
          durationMs: recData.duration ? Math.round(recData.duration * 1000) : 0,
          sizeBytes: typeof recData.fileSize === "number" ? recData.fileSize : 0,
          hasEmbeddedAudio: recData.hasEmbeddedAudio !== false,
          status: "ready" as const,
          createdAt: now,
        };

        const ref = await db.collection("saved_videos").add(savedVideo);
        created.push({
          id: ref.id,
          ...savedVideo,
          createdAt: now.toISOString(),
          duplicate: false,
        });
      } catch (e: any) {
        errors.push({ recordingId, error: e?.message || "Unknown error" });
      }
    }

    return res.status(201).json({ created, errors });
  } catch (err: any) {
    console.error("[my-content] from-recordings error:", err?.message || err);
    return res.status(500).json({ error: "Failed to create saved videos" });
  }
});

// ── POST /upload — upload video file from device ─────────────────────────────
router.post(
  "/upload",
  upload.single("video") as any,
  async (req: Request, res: Response) => {
    try {
      const userId = getAuthedUid(req);
      if (!userId) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });

      // Enforce 500 MB limit
      if (file.size > MAX_FILE_SIZE) {
        return res.status(400).json({
          error: "File too large",
          maxSizeBytes: MAX_FILE_SIZE,
          fileSizeBytes: file.size,
        });
      }

      // Only allow video/* MIME types
      if (!file.mimetype || !file.mimetype.startsWith("video/")) {
        return res.status(400).json({ error: "Only video files are accepted" });
      }

      // Transactional reservation: atomically check limit + increment counter.
      // This closes the race where two concurrent uploads could both pass a
      // separate check-then-increment sequence.
      const reservation = await reserveStorageIfAvailable(userId, file.size, {
        caller: "myContent.upload",
      });
      if (!reservation.reserved) {
        return res.status(409).json({
          error: LIMIT_ERRORS.LIMIT_EXCEEDED,
          details: reservation.reason || "Storage limit exceeded",
        });
      }

      const title = typeof req.body?.title === "string" && req.body.title.trim()
        ? req.body.title.trim()
        : file.originalname.replace(/\.[^/.]+$/, "");

      const timestamp = Date.now();
      const safeName = title.replace(/[^a-z0-9]/gi, "-").toLowerCase().replace(/-+/g, "-").replace(/^-+|-+$/g, "");
      const ext = file.originalname.split(".").pop() || "mp4";
      const storagePath = `my-content/${userId}/${timestamp}-${safeName}.${ext}`;

      let publicUrl: string;
      try {
        publicUrl = await uploadVideo(file.buffer, storagePath, file.mimetype);
      } catch (uploadErr: any) {
        // Upload failed — release the reserved bytes so they aren't stranded.
        try {
          await releaseReservedStorage(userId, file.size, {
            caller: "myContent.upload.rollback",
            storagePath,
          });
        } catch (releaseErr: any) {
          console.error("[my-content] CRITICAL: failed to release reservation after upload failure", {
            userId, storagePath, fileSizeBytes: file.size,
            uploadError: uploadErr?.message, releaseError: releaseErr?.message,
          });
        }
        throw uploadErr; // Re-throw so outer catch returns 500
      }

      const now = new Date();
      const savedVideo = {
        userId,
        title,
        sourceType: "upload" as const,
        playbackUrl: publicUrl,
        downloadUrl: publicUrl,
        thumbnailUrl: null,
        durationMs: 0,
        sizeBytes: file.size,
        hasEmbeddedAudio: true,
        status: "ready" as const,
        storagePath,
        createdAt: now,
      };

      const ref = await db.collection("saved_videos").add(savedVideo);

      return res.status(201).json({
        id: ref.id,
        ...savedVideo,
        createdAt: now.toISOString(),
      });
    } catch (err: any) {
      console.error("[my-content] upload error:", err?.message || err);
      return res.status(500).json({ error: "Failed to upload video" });
    }
  },
);

// ── Auto-create saved_video when recording becomes ready ─────────────────────

/**
 * Called when a recording export completes (status → "ready").
 * Creates a saved_videos entry so the recording appears in My Content.
 * Idempotent: skips if a saved_video already exists for this recording.
 */
export async function createSavedVideoFromRecording(opts: {
  userId: string;
  recordingId: string;
  title?: string;
  playbackUrl?: string;
  thumbnailUrl?: string | null;
  durationMs?: number;
  fileSize?: number;
}): Promise<{ id: string; duplicate: boolean }> {
  const { userId, recordingId } = opts;

  // Idempotency: check for existing saved_video for this recording
  const dupSnap = await db
    .collection("saved_videos")
    .where("userId", "==", userId)
    .where("sourceType", "==", "recording")
    .where("sourceId", "==", recordingId)
    .limit(1)
    .get();

  if (!dupSnap.empty) {
    return { id: dupSnap.docs[0].id, duplicate: true };
  }

  const now = new Date();
  const savedVideo = {
    userId,
    title: opts.title || "Untitled Recording",
    sourceType: "recording" as const,
    sourceId: recordingId,
    playbackUrl: opts.playbackUrl || "",
    downloadUrl: opts.playbackUrl || null,
    thumbnailUrl: opts.thumbnailUrl || null,
    durationMs: typeof opts.durationMs === "number" ? opts.durationMs : 0,
    sizeBytes: typeof opts.fileSize === "number" ? opts.fileSize : 0,
    hasEmbeddedAudio: true,
    status: "ready" as const,
    createdAt: now,
  };

  const ref = await db.collection("saved_videos").add(savedVideo);
  console.log(`[my-content] Auto-created saved_video ${ref.id} for recording ${recordingId}`);
  return { id: ref.id, duplicate: false };
}

export default router;
