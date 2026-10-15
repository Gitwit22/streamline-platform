import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { firestore as db } from "../firebaseAdmin";
import { resolveMediaAssets, withPlayableUrl } from "../lib/mediaAssets";
import { normalizeAudioDeck, parseAudioDeckInput } from "../lib/audioDeckPure";

/**
 * The signed-in user's audio deck layout (playlist + soundboard pads),
 * mounted at /api/audio-deck. Stored at audioDecks/{uid}; the audio files
 * are the user's own content-library assets.
 */
const router = Router();

function deckRef(uid: string) {
  return db.collection("audioDecks").doc(uid);
}

// GET /api/audio-deck -> { layout, assets: { [assetId]: { url, name, type, duration } }, missing: string[] }
// Only the caller's own assets resolve; deleted or foreign ids are listed in
// `missing` so the client can show them as unavailable instead of failing.
router.get("/", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "");
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  try {
    const snap = await deckRef(uid).get();
    const layout = normalizeAudioDeck(snap.exists ? snap.data() : null);
    const ids = new Set([...layout.playlist, ...layout.pads].map((i) => i.assetId));
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
    console.error("GET /api/audio-deck error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// PUT /api/audio-deck { playlist, pads, loopMode }
router.put("/", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "");
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  const parsed = parseAudioDeckInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: "invalid_input", field: parsed.field, details: parsed.details });
  try {
    await deckRef(uid).set({ ...parsed.value, updatedAt: Date.now() });
    return res.json({ layout: parsed.value });
  } catch (err) {
    console.error("PUT /api/audio-deck error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
