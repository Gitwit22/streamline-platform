/**
 * My Content API — SavedVideo (saved_videos): finalized videos.
 *
 * Rows: recordings (auto-created when a recording becomes ready, reference
 * only), exports saved to the library (POST /api/editing/exports/:id/
 * save-to-library, own their object), legacy device uploads.
 * The content library UI lists them through the unified MediaAsset API
 * (GET /api/editing/assets); this router keeps the SavedVideo listing and
 * the owner cleanup endpoint.
 *
 * Routes:
 *   GET    /api/my-content      — list user's saved videos
 *   DELETE /api/my-content/:id  — remove from library (never plan-gated)
 */

import { Router, Request, Response } from "express";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { deleteSavedVideo } from "../lib/savedVideos";

const router = Router();

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
          sourceProjectId: d.sourceProjectId || null,
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
    const r = await deleteSavedVideo(userId, String(req.params.id ?? ""), "myContent.DELETE");
    if (r.status === 403) return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    return res.status(r.status).json(r.body);
  } catch (err: any) {
    console.error("[my-content] delete error:", err?.message || err);
    return res.status(500).json({ error: "Failed to delete saved video" });
  }
});

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
