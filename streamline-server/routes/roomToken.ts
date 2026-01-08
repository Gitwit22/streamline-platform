
import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";

// Dynamic import for AccessToken constructor
async function getAccessTokenCtor() {
  const mod = await import("livekit-server-sdk");
  return mod.AccessToken;
}

const router = Router();

router.post("/", requireAuth, async (req, res) => {
  try {
    const { roomName, identity } = req.body as { roomName?: string; identity?: string };
    const uid = (req as any).user.uid;
    if (!uid) return res.status(401).json({ error: "Missing uid on request" });
    if (!roomName || !roomName.trim())
      return res.status(400).json({ error: "roomName is required" });

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      return res.status(500).json({ error: "LiveKit keys missing in env" });
    }

    const AccessToken = await getAccessTokenCtor();
    const tokenIdentity = (identity && identity.trim()) || uid; // prefer provided identity, fallback to uid
    const at = new AccessToken(apiKey, apiSecret, { identity: tokenIdentity });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
    const jwt = await at.toJwt();
    console.log("✅ roomToken jwt typeof:", typeof jwt, "len:", jwt.length);
    const serverUrl = process.env.LIVEKIT_URL || null;
    return res.status(200).json({ token: jwt, serverUrl });
  } catch (err: any) {
    console.error("roomToken error:", err);
    return res.status(500).json({ error: "Failed to create room token" });
  }
});

export default router;
