import express from "express";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { getCorpOrgContext, asString, coerceCorpRole } from "../lib/corpOrg";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { tenantCol, globalCol } from "../lib/dbPaths";

const router = express.Router();

/**
 * GET /me — returns current user's corporate identity
 */
router.get("/me", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) {
      // Distinguish "no org yet" from "not corporate" so the client can
      // redirect to the join-org page instead of the login page.
      return res.status(200).json({ needsOrg: true, uid });
    }

    // ── Auto-promote org creator to owner if stuck with a lesser role ──
    // This fixes accounts created before the "first member = owner" rule.
    let effectiveRole = ctx.orgRole || "employee";
    try {
      const orgSnap = await tenantCol("orgs", undefined, "corporate").doc(ctx.orgId).get().catch(() => null as any);
      const orgData = orgSnap && orgSnap.exists ? (orgSnap.data() as any) : null;
      if (orgData && orgData.createdBy === uid && effectiveRole !== "owner") {
        const memberId = `${ctx.orgId}_${uid}`;
        await tenantCol("orgMembers", undefined, "corporate").doc(memberId).set(
          { role: "owner", updatedAt: Date.now() },
          { merge: true },
        );
        console.log(`[corp/me] auto-promoted org creator ${uid} to owner (was ${effectiveRole})`);
        effectiveRole = "owner";
      }
    } catch (promoteErr: any) {
      console.warn("[corp/me] auto-promote check failed:", promoteErr?.message || promoteErr);
    }

    const account = (req as any).account || {};
    const displayName = asString(account.displayName || account.name || "User");

    return res.json({
      uid,
      orgType: "corporate",
      orgId: ctx.orgId,
      orgName: ctx.orgName,
      role: effectiveRole,
      orgRole: effectiveRole,
      displayName,
      email: asString(account.email || ""),
    });
  } catch (err: any) {
    console.error("[corp/me] error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * PATCH /me/profile — update your own display name (any member)
 */
router.patch("/me/profile", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    const displayName = asString(req.body.displayName).trim();
    if (!displayName) return res.status(400).json({ error: "display_name_required" });

    const memberId = `${ctx.orgId}_${uid}`;

    // Update member doc
    await tenantCol("orgMembers", undefined, "corporate").doc(memberId).set(
      { displayName, updatedAt: Date.now() },
      { merge: true },
    );

    // Also update the global users doc so it persists across sessions
    await globalCol("users").doc(uid).set(
      { displayName, updatedAt: Date.now() },
      { merge: true },
    );

    return res.json({ ok: true, displayName });
  } catch (err: any) {
    console.error("[corp/me] profile update error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * POST /me/self-promote — promote yourself to owner
 * Allowed when: you are the sole member of the org, OR you are the org creator.
 * This bypasses the normal admin-only role gating for bootstrapping.
 */
router.post("/me/self-promote", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    if (ctx.orgRole === "owner") {
      return res.json({ ok: true, role: "owner", reason: "already_owner" });
    }

    const newRole = coerceCorpRole(req.body.role) || "owner";

    // Check if user is the org creator
    const orgSnap = await tenantCol("orgs", undefined, "corporate").doc(ctx.orgId).get();
    const orgData = orgSnap.exists ? (orgSnap.data() as any) : null;
    const isCreator = orgData && orgData.createdBy === uid;

    // Check if user is the sole member
    const membersSnap = await tenantCol("orgMembers", undefined, "corporate")
      .where("orgId", "==", ctx.orgId)
      .get();
    const isSoleMember = membersSnap.size <= 1;

    if (!isCreator && !isSoleMember) {
      return res.status(403).json({ error: "self_promote_not_allowed" });
    }

    const memberId = `${ctx.orgId}_${uid}`;
    await tenantCol("orgMembers", undefined, "corporate").doc(memberId).set(
      { role: newRole, updatedAt: Date.now() },
      { merge: true },
    );

    // Also set createdBy if missing so future auto-promote works
    if (!orgData?.createdBy) {
      await tenantCol("orgs", undefined, "corporate").doc(ctx.orgId).set(
        { createdBy: uid, updatedAt: Date.now() },
        { merge: true },
      );
    }

    console.log(`[corp/me] self-promoted ${uid} to ${newRole} (creator=${isCreator}, sole=${isSoleMember})`);
    return res.json({ ok: true, role: newRole });
  } catch (err: any) {
    console.error("[corp/me] self-promote error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
