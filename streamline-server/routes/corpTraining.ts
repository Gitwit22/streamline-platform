import express from "express";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { getCorpOrgContext, assertCorpRole, asString, coerceMillis } from "../lib/corpOrg";
import { writeCorpAudit } from "../lib/corpAudit";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = express.Router();

function normalizeModule(docId: string, data: any) {
  return {
    id: docId,
    title: asString(data?.title),
    description: asString(data?.description),
    department: asString(data?.department),
    type: asString(data?.type || "required"),
    status: asString(data?.status || "active"),
    durationMinutes: typeof data?.durationMinutes === "number" ? data.durationMinutes : 0,
    deadline: coerceMillis(data?.deadline),
    assignedTo: asString(data?.assignedTo || "all"),
    completionRate: typeof data?.completionRate === "number" ? data.completionRate : 0,
    totalAssigned: typeof data?.totalAssigned === "number" ? data.totalAssigned : 0,
    totalCompleted: typeof data?.totalCompleted === "number" ? data.totalCompleted : 0,
    icon: asString(data?.icon),
    createdAt: coerceMillis(data?.createdAt),
    createdBy: asString(data?.createdBy),
  };
}

/**
 * GET /training — list training modules
 * Query: ?filter=required|optional|all&limit=50
 */
router.get("/training", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 200);

    const snap = await db.collection("corpTraining")
      .where("orgId", "==", ctx.orgId)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    let modules = snap.docs.map(d => normalizeModule(d.id, d.data()));

    const filter = asString(req.query.filter as string).trim();
    if (filter && filter !== "all") {
      modules = modules.filter(m => m.type === filter);
    }

    // Enrich with per-user progress
    const progressSnap = await db.collection("corpTrainingProgress")
      .where("orgId", "==", ctx.orgId)
      .where("uid", "==", uid)
      .get()
      .catch(() => ({ docs: [] } as any));

    const progressMap: Record<string, any> = {};
    for (const d of progressSnap.docs) {
      const data = d.data();
      if (data?.moduleId) progressMap[data.moduleId] = data;
    }

    const enriched = modules.map(m => ({
      ...m,
      userProgress: progressMap[m.id]?.progress ?? 0,
      userStatus: asString(progressMap[m.id]?.status || "not_started"),
      userCompletedAt: coerceMillis(progressMap[m.id]?.completedAt),
    }));

    return res.json({ modules: enriched });
  } catch (err: any) {
    console.error("[corp/training] list error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * POST /training — create a training module (admin/manager)
 */
router.post("/training", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });
    if (!assertCorpRole(ctx.orgRole, ["admin", "manager"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const title = asString(req.body.title).trim();
    if (!title) return res.status(400).json({ error: "title_required" });

    const now = Date.now();
    const moduleId = `${ctx.orgId}_trn_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const doc = {
      orgId: ctx.orgId,
      title,
      description: asString(req.body.description).trim(),
      department: asString(req.body.department).trim(),
      type: asString(req.body.type || "required").trim(),
      status: "active",
      durationMinutes: typeof req.body.durationMinutes === "number" ? req.body.durationMinutes : 0,
      deadline: coerceMillis(req.body.deadline),
      assignedTo: asString(req.body.assignedTo || "all").trim(),
      completionRate: 0,
      totalAssigned: 0,
      totalCompleted: 0,
      icon: asString(req.body.icon).trim(),
      createdAt: now,
      createdBy: uid,
    };

    await db.collection("corpTraining").doc(moduleId).set(doc, { merge: true });

    await writeCorpAudit({
      orgId: ctx.orgId,
      action: "training.create",
      actorUid: uid,
      actorName: asString((req as any).account?.displayName || ""),
      targetId: moduleId,
      meta: { title, type: doc.type },
    });

    return res.json({ module: normalizeModule(moduleId, doc) });
  } catch (err: any) {
    console.error("[corp/training] create error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * PATCH /training/:id/progress — update user progress on a module
 */
router.patch("/training/:id/progress", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    const moduleId = req.params.id;
    const snap = await db.collection("corpTraining").doc(moduleId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    const progress = typeof req.body.progress === "number"
      ? Math.min(Math.max(req.body.progress, 0), 100)
      : 0;

    const now = Date.now();
    const progressId = `${ctx.orgId}_${uid}_${moduleId}`;
    const progressDoc: any = {
      orgId: ctx.orgId,
      uid,
      moduleId,
      progress,
      status: progress >= 100 ? "completed" : "in_progress",
      updatedAt: now,
    };
    if (progress >= 100) progressDoc.completedAt = now;

    await db.collection("corpTrainingProgress").doc(progressId).set(progressDoc, { merge: true });

    return res.json({ progress: progressDoc });
  } catch (err: any) {
    console.error("[corp/training] progress error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * POST /training/:id/assign — assign a module to users/departments (admin/manager)
 */
router.post("/training/:id/assign", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });
    if (!assertCorpRole(ctx.orgRole, ["admin", "manager"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const moduleId = req.params.id;
    const snap = await db.collection("corpTraining").doc(moduleId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    const updates: any = { updatedAt: Date.now() };
    if (req.body.assignedTo !== undefined) updates.assignedTo = asString(req.body.assignedTo).trim();
    if (req.body.deadline !== undefined) updates.deadline = coerceMillis(req.body.deadline);

    await db.collection("corpTraining").doc(moduleId).set(updates, { merge: true });

    await writeCorpAudit({
      orgId: ctx.orgId,
      action: "training.assign",
      actorUid: uid,
      actorName: asString((req as any).account?.displayName || ""),
      targetId: moduleId,
      meta: updates,
    });

    return res.json({ ok: true, module: normalizeModule(moduleId, { ...existing, ...updates }) });
  } catch (err: any) {
    console.error("[corp/training] assign error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
