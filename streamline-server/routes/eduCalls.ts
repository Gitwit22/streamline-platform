import express from "express";
import { requireAuth } from "../middleware/requireAuth";
import { loadEduOrgSettingsForUid } from "../lib/eduOrgContext";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { tenantCol } from "../lib/dbPaths";
import { getLiveKitSdk } from "../lib/livekit";

const router = express.Router();

type EduOrgRole = "faculty_admin" | "faculty_teacher" | "student_producer" | "student_producer_assigned" | "talent" | "viewer";

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

const CALL_ALLOWED_ROLES: EduOrgRole[] = [
  "faculty_admin",
  "student_producer",
  "student_producer_assigned",
];

/* ── POST /calls/token — mint a LiveKit token for EDU org-scoped WebRTC call ── */
router.post("/calls/token", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await loadEduOrgSettingsForUid(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    // Role gate: only faculty + producers can initiate calls
    if (!CALL_ALLOWED_ROLES.includes(ctx.orgRole as EduOrgRole)) {
      return res.status(403).json({ error: "role_not_allowed" });
    }

    // EDU supports DM calls only (no chat channels)
    const kind = asString(req.body.kind).trim();
    if (kind !== "dm") {
      return res.status(400).json({ error: "invalid_kind", message: "EDU calls only support kind 'dm'" });
    }

    const targetUserId = asString(req.body.targetUserId).trim();
    if (!targetUserId) return res.status(400).json({ error: "target_required" });
    if (targetUserId === uid) return res.status(400).json({ error: "cannot_call_self" });

    // Verify target is in same org
    const targetMemberId = `${ctx.orgId}_${targetUserId}`;
    const targetSnap = await tenantCol("orgMembers").doc(targetMemberId).get().catch(() => null as any);
    if (!targetSnap || !targetSnap.exists) {
      return res.status(404).json({ error: "target_not_in_org" });
    }

    // Deterministic room name: sorted user IDs
    const sorted = [uid, targetUserId].sort();
    const roomName = `edu_${ctx.orgId}_dm_${sorted[0]}_${sorted[1]}`;

    // Mint LiveKit token
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      return res.status(503).json({ error: "livekit_not_configured" });
    }

    const displayName = ctx.userName || uid;
    const { AccessToken } = await getLiveKitSdk();
    const at = new AccessToken(apiKey, apiSecret, {
      identity: uid,
      name: displayName,
    });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();

    // Provide the client-facing LiveKit websocket URL
    const rawUrl = String(process.env.LIVEKIT_URL || "").trim();
    let livekitUrl: string | null = null;
    if (rawUrl) {
      livekitUrl = /^https?:\/\//i.test(rawUrl)
        ? rawUrl.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://")
        : rawUrl;
    }

    return res.json({ roomName, token, livekitUrl });
  } catch (err: any) {
    console.error("[edu/calls] token error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
