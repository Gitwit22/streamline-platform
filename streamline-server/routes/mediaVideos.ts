import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { firestore as db } from "../firebaseAdmin";
import { resolveMediaAssets, withPlayableUrl } from "../lib/mediaAssets";
import { normalizeMediaVideos, parseMediaVideosInput } from "../lib/mediaVideosPure";

/**
 * The signed-in user's saved stage videos (in-room Media panel), mounted at
 * /api/media-videos. Stored at mediaVideoDecks/{uid}; the files are the
 * user's own content-library assets or YouTube video ids. Same contract as
 * /api/audio-deck.
 */
const router = Router();

function videosRef(uid: string) {
  return db.collection("mediaVideoDecks").doc(uid);
}

// GET /api/media-videos -> { layout, assets: { [assetId]: { url, name, type, duration } }, missing: string[] }
// Only the caller's own assets resolve; deleted or foreign ids are listed in
// `missing` so the client can show them as unavailable instead of failing.
router.get("/", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "");
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  try {
    const snap = await videosRef(uid).get();
    const layout = normalizeMediaVideos(snap.exists ? snap.data() : null);
    // YouTube items need no lookup; only library files resolve to signed URLs.
    const ids = new Set(layout.videos.map((i) => i.assetId).filter((id): id is string => !!id));
    const resolved = await resolveMediaAssets(uid, ids);
    const assets: Record<string, { url: string; name: string; type: string; duration: number }> = {};
    const missing: string[] = [];
    await Promise.all(
      Array.from(ids).map(async (id) => {
        const a = resolved.get(id);
        if (!a) {
          missing.push(id);
          return;
        }
        const playable = await withPlayableUrl(a);
        assets[id] = { url: playable.videoUrl || "", name: a.name, type: a.type, duration: a.duration || 0 };
      })
    );
    return res.json({ layout, assets, missing });
  } catch (err) {
    console.error("GET /api/media-videos error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// PUT /api/media-videos { videos: [{ assetId | youtubeId, name, volume }], playMode }
router.put("/", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "");
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  const parsed = parseMediaVideosInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: "invalid_input", field: parsed.field, details: parsed.details });
  try {
    await videosRef(uid).set({ ...parsed.value, updatedAt: Date.now() });
    return res.json({ layout: parsed.value });
  } catch (err) {
    console.error("PUT /api/media-videos error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
