import { Router } from "express";
import { firestore as db } from "../firebaseAdmin";
import { extractRoomAccessToken, verifyRoomAccessToken } from "../middleware/roomAccessToken";
import { verifyInviteToken } from "../middleware/requireAuth";
import { resolveRoomIdentity } from "../lib/roomIdentity";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = Router();

router.get("/resolve", async (req, res) => {
  try {
    const rawToken = extractRoomAccessToken(req as any);
    if (!rawToken) {
      return res.status(400).json({ error: "token_required" });
    }

    let claims: any;
    let tokenType: "invite" | "roomAccess" = "roomAccess";
    try {
      // Prefer invite tokens (support public share links)
      claims = verifyInviteToken(rawToken) as any;
      tokenType = "invite";
    } catch {
      try {
        // Fallback to roomAccessToken (signed with ROOM_ACCESS_TOKEN_SECRET)
        claims = verifyRoomAccessToken(rawToken) as any;
        tokenType = "roomAccess";
      } catch {
        return res.status(401).json({ error: "invalid_token" });
      }
    }

    const claimedRoomId = String(claims?.roomId || "").trim();
    const claimedRoomName = String(claims?.roomName || claims?.room || "").trim();
    const resolved = await resolveRoomIdentity({
      roomId: claimedRoomId || undefined,
      roomName: claimedRoomName || undefined,
    });

    const roomId = String(resolved?.roomId || claimedRoomId || claimedRoomName || "").trim();
    const fallbackRoomName = String(resolved?.roomName || claimedRoomName || roomId || "").trim();
    if (!roomId) {
      return res.status(400).json({ error: "token_missing_roomId" });
    }

    const ref = db.collection("rooms").doc(roomId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    }

    const data = snap.data() || {};
    const roomName =
      (data as any).livekitRoomName ||
      (data as any).name ||
      (data as any).roomName ||
      fallbackRoomName ||
      roomId;

    const hls = (data as any).hls || {};

    return res.json({
      roomId,
      roomName,
      tokenType,
      role: claims?.role || null,
      permissions: claims?.permissions || {},
      hls,
    });
  } catch (err) {
    console.error("/api/rooms/resolve error", err);
    return res.status(500).json({ error: "resolve_failed" });
  }
});

export default router;
