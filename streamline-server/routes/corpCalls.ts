import express from "express";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { getCorpOrgContext, assertCorpRole, asString, coerceMillis } from "../lib/corpOrg";
import { writeCorpAudit } from "../lib/corpAudit";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = express.Router();

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
  };
}

/**
 * GET /calls — list org calls
 * Query: ?status=active,scheduled,completed&hasRecording=true&limit=50
 */
router.get("/calls", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 200);

    const snap = await db.collection("corpCalls")
      .where("orgId", "==", ctx.orgId)
      .orderBy("scheduledAt", "desc")
      .limit(limit)
      .get();

    let calls = snap.docs.map(d => normalizeCall(d.id, d.data()));

    const statusFilter = asString(req.query.status as string).split(",").map(s => s.trim()).filter(Boolean);
    if (statusFilter.length) {
      calls = calls.filter(c => statusFilter.includes(c.status));
    }

    if (req.query.hasRecording === "true") {
      calls = calls.filter(c => c.hasRecording);
    }

    return res.json({ calls });
  } catch (err: any) {
    console.error("[corp/calls] list error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * POST /calls — create/schedule a call
 */
router.post("/calls", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    const title = asString(req.body.title).trim();
    if (!title) return res.status(400).json({ error: "title_required" });

    const now = Date.now();
    const callId = `${ctx.orgId}_call_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const participants = Array.isArray(req.body.participants) ? req.body.participants : [];

    const doc = {
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
    };

    await db.collection("corpCalls").doc(callId).set(doc, { merge: true });

    await writeCorpAudit({
      orgId: ctx.orgId,
      action: "call.create",
      actorUid: uid,
      actorName: asString((req as any).account?.displayName || ""),
      targetId: callId,
      meta: { title },
    });

    return res.json({ call: normalizeCall(callId, doc) });
  } catch (err: any) {
    console.error("[corp/calls] create error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * PATCH /calls/:id — update call (start, end, update status)
 */
router.patch("/calls/:id", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    const callId = req.params.id;
    const snap = await db.collection("corpCalls").doc(callId).get();
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

    await db.collection("corpCalls").doc(callId).set(updates, { merge: true });

    await writeCorpAudit({
      orgId: ctx.orgId,
      action: "call.update",
      actorUid: uid,
      actorName: asString((req as any).account?.displayName || ""),
      targetId: callId,
      meta: updates,
    });

    return res.json({ call: normalizeCall(callId, { ...existing, ...updates }) });
  } catch (err: any) {
    console.error("[corp/calls] update error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * GET /calls/:id/transcript — get call transcript
 */
router.get("/calls/:id/transcript", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    const callId = req.params.id;
    const snap = await db.collection("corpCalls").doc(callId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    // Look up transcript doc
    const transcriptSnap = await db.collection("corpTranscripts").doc(callId).get().catch(() => null as any);
    const transcript = transcriptSnap && transcriptSnap.exists ? (transcriptSnap.data() as any) : null;

    return res.json({
      callId,
      transcript: transcript?.content || null,
      segments: Array.isArray(transcript?.segments) ? transcript.segments : [],
    });
  } catch (err: any) {
    console.error("[corp/calls] transcript error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
