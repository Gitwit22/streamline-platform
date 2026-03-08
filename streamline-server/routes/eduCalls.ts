import express from "express";
import { requireAuth } from "../middleware/requireAuth";
import { loadEduOrgSettingsForUid } from "../lib/eduOrgContext";
import { writeEduAudit } from "../lib/eduAudit";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { tenantCol } from "../lib/dbPaths";
import { getLiveKitSdk } from "../lib/livekit";

const router = express.Router();

type EduOrgRole = "faculty_admin" | "faculty_teacher" | "student_producer" | "student_producer_assigned" | "talent" | "viewer";

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function coerceMillis(v: any): number | null {
  if (typeof v === "number" && v > 0) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

function normalizeCall(docId: string, data: any) {
  return {
    id: docId,
    title: asString(data?.title),
    status: asString(data?.status || "scheduled"),
    scheduledAt: coerceMillis(data?.scheduledAt),
    startedAt: coerceMillis(data?.startedAt),
    endedAt: coerceMillis(data?.endedAt),
    duration: typeof data?.duration === "number" ? data.duration : null,
    participants: Array.isArray(data?.participants) ? data.participants : [],
    department: asString(data?.department),
    hasRecording: !!data?.hasRecording,
    hasTranscript: !!data?.hasTranscript,
    recordingUrl: asString(data?.recordingUrl),
    createdAt: coerceMillis(data?.createdAt),
    createdBy: asString(data?.createdBy),
    targetUserId: asString(data?.targetUserId),
    callerName: asString(data?.callerName),
  };
}

const CALL_ALLOWED_ROLES: EduOrgRole[] = [
  "faculty_admin",
  "faculty_teacher",
  "student_producer",
  "student_producer_assigned",
];

/* ── GET /calls — list org calls ───────────────────────────────── */
router.get("/calls", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await loadEduOrgSettingsForUid(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 200);

    const snap = await tenantCol("eduCalls")
      .where("orgId", "==", ctx.orgId)
      .limit(limit)
      .get();

    let calls = snap.docs
      .map((d: any) => normalizeCall(d.id, d.data()))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    const statusFilter = asString(req.query.status as string)
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (statusFilter.length) {
      calls = calls.filter((c) => statusFilter.includes(c.status));
    }

    if (req.query.hasRecording === "true") {
      calls = calls.filter((c) => c.hasRecording);
    }

    return res.json({ calls });
  } catch (err: any) {
    console.error("[edu/calls] list error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /calls — create / schedule a call ────────────────────── */
router.post("/calls", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await loadEduOrgSettingsForUid(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    if (!CALL_ALLOWED_ROLES.includes(ctx.orgRole as EduOrgRole)) {
      return res.status(403).json({ error: "role_not_allowed" });
    }

    const title = asString(req.body.title).trim();
    if (!title) return res.status(400).json({ error: "title_required" });

    const now = Date.now();
    const callId = `${ctx.orgId}_call_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const participants = Array.isArray(req.body.participants) ? req.body.participants : [];

    const doc: any = {
      orgId: ctx.orgId,
      title,
      status: "scheduled",
      scheduledAt: coerceMillis(req.body.scheduledAt) || now,
      startedAt: null,
      endedAt: null,
      duration: null,
      participants,
      department: asString(req.body.department).trim(),
      hasRecording: false,
      hasTranscript: false,
      recordingUrl: "",
      createdAt: now,
      createdBy: uid,
      callerName: ctx.userName || uid,
    };

    // If creating a DM call with a target user, store targetUserId
    if (participants.length === 1) {
      doc.targetUserId = participants[0];
    }

    await tenantCol("eduCalls").doc(callId).set(doc, { merge: true });

    await writeEduAudit({
      orgId: ctx.orgId,
      action: "call.create",
      actorUid: uid,
      actorName: ctx.userName || "",
      targetId: callId,
    });

    return res.json({ call: normalizeCall(callId, doc) });
  } catch (err: any) {
    console.error("[edu/calls] create error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── PATCH /calls/:id — update call (start, end, status) ──────── */
router.patch("/calls/:id", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await loadEduOrgSettingsForUid(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const callId = req.params.id;
    const snap = await tenantCol("eduCalls").doc(callId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    const updates: any = {};
    if (req.body.status !== undefined) updates.status = asString(req.body.status).trim();
    if (req.body.title !== undefined) updates.title = asString(req.body.title).trim();
    if (updates.status === "active" && !existing.startedAt) updates.startedAt = Date.now();
    if (updates.status === "completed" && !existing.endedAt) {
      updates.endedAt = Date.now();
      if (existing.startedAt) {
        updates.duration = updates.endedAt - existing.startedAt;
      }
    }
    if (req.body.hasRecording !== undefined) updates.hasRecording = !!req.body.hasRecording;
    if (req.body.hasTranscript !== undefined) updates.hasTranscript = !!req.body.hasTranscript;

    updates.updatedAt = Date.now();

    await tenantCol("eduCalls").doc(callId).set(updates, { merge: true });

    await writeEduAudit({
      orgId: ctx.orgId,
      action: "call.update",
      actorUid: uid,
      actorName: ctx.userName || "",
      targetId: callId,
    });

    return res.json({ call: normalizeCall(callId, { ...existing, ...updates }) });
  } catch (err: any) {
    console.error("[edu/calls] update error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── GET /calls/pending — incoming calls for the current user ──── */
router.get("/calls/pending", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await loadEduOrgSettingsForUid(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    // Find calls where this user is a participant, status is "scheduled" (ringing),
    // and createdBy is NOT this user (so it's an incoming call).
    // Simple query: just filter by orgId, then filter in-memory to avoid
    // needing a Firestore composite index.
    const snap = await tenantCol("eduCalls")
      .where("orgId", "==", ctx.orgId)
      .limit(50)
      .get();

    const pending = snap.docs
      .map((d: any) => normalizeCall(d.id, d.data()))
      .filter((c) => c.status === "scheduled" && c.createdBy !== uid && c.participants.includes(uid))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, 10);

    return res.json({ calls: pending });
  } catch (err: any) {
    console.error("[edu/calls] pending error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── PATCH /calls/:id/dismiss — dismiss / decline an incoming call ── */
router.patch("/calls/:id/dismiss", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await loadEduOrgSettingsForUid(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const callId = req.params.id;
    const snap = await tenantCol("eduCalls").doc(callId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    // Mark as completed (declined)
    await tenantCol("eduCalls").doc(callId).set(
      { status: "completed", endedAt: Date.now(), declinedBy: uid, updatedAt: Date.now() },
      { merge: true },
    );

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[edu/calls] dismiss error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

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
