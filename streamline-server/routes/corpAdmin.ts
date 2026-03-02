import express from "express";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { getCorpOrgContext, assertCorpRole, asString, coerceMillis, coerceCorpRole, coerceEmail } from "../lib/corpOrg";
import { writeCorpAudit } from "../lib/corpAudit";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = express.Router();

/**
 * GET /admin/users — list org members
 * Query: ?search=...&role=admin&status=active&limit=100
 */
router.get("/admin/users", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });
    if (!assertCorpRole(ctx.orgRole, ["admin", "manager"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 100, 1), 500);

    const snap = await db.collection("orgMembers")
      .where("orgId", "==", ctx.orgId)
      .limit(limit)
      .get();

    let users = snap.docs.map(d => {
      const data = d.data() as any;
      return {
        id: d.id,
        uid: asString(data?.uid),
        name: asString(data?.name || data?.displayName),
        email: asString(data?.email),
        role: asString(data?.role || "viewer"),
        status: asString(data?.status || "active"),
        department: asString(data?.department),
        lastActiveAt: coerceMillis(data?.lastActiveAt),
        joinedAt: coerceMillis(data?.joinedAt || data?.createdAt),
      };
    });

    const search = asString(req.query.search as string).trim().toLowerCase();
    if (search) {
      users = users.filter(u =>
        u.name.toLowerCase().includes(search) ||
        u.email.toLowerCase().includes(search)
      );
    }

    const roleFilter = asString(req.query.role as string).trim();
    if (roleFilter) {
      users = users.filter(u => u.role === roleFilter);
    }

    const statusFilter = asString(req.query.status as string).trim();
    if (statusFilter) {
      users = users.filter(u => u.status === statusFilter);
    }

    return res.json({ users, total: users.length });
  } catch (err: any) {
    console.error("[corp/admin] users error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * PATCH /admin/users/:id/role — change a user's role (admin only)
 */
router.patch("/admin/users/:id/role", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });
    if (!assertCorpRole(ctx.orgRole, ["admin"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const memberId = req.params.id;
    const newRole = coerceCorpRole(req.body.role);
    if (!newRole) return res.status(400).json({ error: "invalid_role" });

    const snap = await db.collection("orgMembers").doc(memberId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    await db.collection("orgMembers").doc(memberId).set({
      role: newRole,
      updatedAt: Date.now(),
    }, { merge: true });

    await writeCorpAudit({
      orgId: ctx.orgId,
      action: "admin.role_change",
      actorUid: uid,
      actorName: asString((req as any).account?.displayName || ""),
      targetId: memberId,
      meta: { newRole, previousRole: existing.role },
    });

    return res.json({ ok: true, memberId, role: newRole });
  } catch (err: any) {
    console.error("[corp/admin] role change error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * POST /admin/users/invite — invite a new user (admin/manager)
 */
router.post("/admin/users/invite", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });
    if (!assertCorpRole(ctx.orgRole, ["admin", "manager"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const email = coerceEmail(req.body.email);
    if (!email) return res.status(400).json({ error: "invalid_email" });

    const role = coerceCorpRole(req.body.role) || "member";
    const name = asString(req.body.name).trim();

    const now = Date.now();
    const inviteId = `${ctx.orgId}_inv_${now}_${Math.random().toString(36).slice(2, 8)}`;

    await db.collection("orgMembers").doc(inviteId).set({
      orgId: ctx.orgId,
      email,
      name,
      role,
      status: "invited",
      department: asString(req.body.department).trim(),
      createdAt: now,
      invitedBy: uid,
    }, { merge: true });

    await writeCorpAudit({
      orgId: ctx.orgId,
      action: "admin.invite",
      actorUid: uid,
      actorName: asString((req as any).account?.displayName || ""),
      targetId: inviteId,
      meta: { email, role },
    });

    return res.json({ ok: true, inviteId });
  } catch (err: any) {
    console.error("[corp/admin] invite error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * GET /admin/audit — fetch audit log
 * Query: ?limit=100&action=...
 */
router.get("/admin/audit", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });
    if (!assertCorpRole(ctx.orgRole, ["admin"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 100, 1), 500);

    const snap = await db.collection("corpAudit")
      .where("orgId", "==", ctx.orgId)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    let entries = snap.docs.map(d => {
      const data = d.data() as any;
      return {
        id: d.id,
        action: asString(data?.action),
        actorUid: asString(data?.actorUid),
        actorName: asString(data?.actorName),
        targetId: asString(data?.targetId),
        meta: data?.meta || null,
        createdAt: coerceMillis(data?.createdAt),
      };
    });

    const actionFilter = asString(req.query.action as string).trim();
    if (actionFilter) {
      entries = entries.filter(e => e.action.startsWith(actionFilter));
    }

    return res.json({ entries, total: entries.length });
  } catch (err: any) {
    console.error("[corp/admin] audit error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * GET /admin/settings — get org settings
 */
router.get("/admin/settings", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });
    if (!assertCorpRole(ctx.orgRole, ["admin"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const orgSnap = await db.collection("orgs").doc(ctx.orgId).get();
    const org = orgSnap.exists ? (orgSnap.data() as any) : {};

    return res.json({
      orgId: ctx.orgId,
      name: ctx.orgName,
      orgType: "corporate",
      timezone: asString(org.timezone || "America/New_York"),
      branding: org.branding || {},
      retentionDays: typeof org.retentionDays === "number" ? org.retentionDays : 365,
      ssoEnabled: !!org.ssoEnabled,
      ssoProvider: asString(org.ssoProvider),
      mfaRequired: !!org.mfaRequired,
      defaultRole: asString(org.defaultRole || "member"),
    });
  } catch (err: any) {
    console.error("[corp/admin] settings error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * PATCH /admin/settings — update org settings (admin only)
 */
router.patch("/admin/settings", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });
    if (!assertCorpRole(ctx.orgRole, ["admin"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const updates: any = { updatedAt: Date.now() };
    if (req.body.name !== undefined) updates.name = asString(req.body.name).trim();
    if (req.body.timezone !== undefined) updates.timezone = asString(req.body.timezone).trim();
    if (req.body.retentionDays !== undefined && typeof req.body.retentionDays === "number") {
      updates.retentionDays = req.body.retentionDays;
    }
    if (req.body.ssoEnabled !== undefined) updates.ssoEnabled = !!req.body.ssoEnabled;
    if (req.body.ssoProvider !== undefined) updates.ssoProvider = asString(req.body.ssoProvider).trim();
    if (req.body.mfaRequired !== undefined) updates.mfaRequired = !!req.body.mfaRequired;
    if (req.body.defaultRole !== undefined) updates.defaultRole = asString(req.body.defaultRole).trim();

    await db.collection("orgs").doc(ctx.orgId).set(updates, { merge: true });

    await writeCorpAudit({
      orgId: ctx.orgId,
      action: "admin.settings_update",
      actorUid: uid,
      actorName: asString((req as any).account?.displayName || ""),
      meta: updates,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[corp/admin] settings update error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * GET /admin/analytics — aggregated analytics overview
 * Query: ?scope=broadcasts|training|calls|overview
 */
router.get("/admin/analytics", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    const [broadcastsSnap, callsSnap, trainingSnap, membersSnap, messagesSnap] = await Promise.all([
      db.collection("corpBroadcasts").where("orgId", "==", ctx.orgId).get().catch(() => ({ size: 0, docs: [] } as any)),
      db.collection("corpCalls").where("orgId", "==", ctx.orgId).get().catch(() => ({ size: 0, docs: [] } as any)),
      db.collection("corpTraining").where("orgId", "==", ctx.orgId).get().catch(() => ({ size: 0, docs: [] } as any)),
      db.collection("orgMembers").where("orgId", "==", ctx.orgId).get().catch(() => ({ size: 0, docs: [] } as any)),
      db.collection("corpChatMessages").where("orgId", "==", ctx.orgId).get().catch(() => ({ size: 0, docs: [] } as any)),
    ]);

    const broadcasts = broadcastsSnap.docs.map((d: any) => d.data());
    const calls = callsSnap.docs.map((d: any) => d.data());
    const training = trainingSnap.docs.map((d: any) => d.data());

    const liveBroadcasts = broadcasts.filter((b: any) => b.status === "live").length;
    const scheduledBroadcasts = broadcasts.filter((b: any) => b.status === "scheduled").length;
    const completedBroadcasts = broadcasts.filter((b: any) => b.status === "completed").length;

    const activeCalls = calls.filter((c: any) => c.status === "active").length;
    const totalCalls = calls.length;

    const requiredTraining = training.filter((t: any) => t.type === "required");
    const avgCompletionRate = requiredTraining.length > 0
      ? Math.round(requiredTraining.reduce((sum: number, t: any) => sum + (t.completionRate || 0), 0) / requiredTraining.length)
      : 0;

    const totalMembers = membersSnap.size;
    const activeMembers = membersSnap.docs.filter((d: any) => {
      const data = d.data();
      return data?.status !== "disabled" && data?.status !== "invited";
    }).length;

    // Compute department-level compliance from training progress
    const deptCompliance: Record<string, { total: number; compliant: number }> = {};
    for (const t of training) {
      const dept = asString(t.department || "General");
      if (!deptCompliance[dept]) deptCompliance[dept] = { total: 0, compliant: 0 };
      deptCompliance[dept].total++;
      if ((t.completionRate || 0) >= 80) deptCompliance[dept].compliant++;
    }

    const departments = Object.entries(deptCompliance).map(([name, v]) => ({
      name,
      complianceRate: v.total > 0 ? Math.round((v.compliant / v.total) * 100) : 0,
      totalModules: v.total,
    }));

    return res.json({
      overview: {
        totalBroadcasts: broadcasts.length,
        liveBroadcasts,
        scheduledBroadcasts,
        completedBroadcasts,
        totalCalls,
        activeCalls,
        totalTrainingModules: training.length,
        avgCompletionRate,
        totalMembers,
        activeMembers,
        totalMessages: messagesSnap.size,
      },
      departments,
    });
  } catch (err: any) {
    console.error("[corp/admin] analytics error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
