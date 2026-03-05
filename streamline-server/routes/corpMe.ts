import express from "express";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { getCorpOrgContext, asString } from "../lib/corpOrg";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

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

    const account = (req as any).account || {};
    const displayName = asString(account.displayName || account.name || "User");

    return res.json({
      uid,
      orgType: "corporate",
      orgId: ctx.orgId,
      orgName: ctx.orgName,
      role: ctx.orgRole || "employee",
      orgRole: ctx.orgRole || "employee",
      displayName,
      email: asString(account.email || ""),
    });
  } catch (err: any) {
    console.error("[corp/me] error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
