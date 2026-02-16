import { Router } from "express";
import { firestore } from "../firebaseAdmin";
import { requireAdmin } from "../middleware/adminAuth";
import { writeEduAudit } from "../lib/eduAudit";
import { coerceEduOrgRole, type EduOrgRole } from "../lib/eduOrgContext";

const router = Router();

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function coerceEmail(value: any): string | null {
  const email = asString(value).trim().toLowerCase();
  if (!email) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
}

// Internal-only EDU bootstrap.
// Auth:
// - If MAINTENANCE_KEY is set, accept x-maintenance-key or Authorization: Bearer <key>
// - Otherwise fall back to requireAdmin
router.use((req, res, next) => {
  const key = process.env.MAINTENANCE_KEY;
  if (!key) return requireAdmin(req as any, res as any, next as any);

  const headerKey = String(req.headers["x-maintenance-key"] || "").trim();
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  const bearer =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";

  if (headerKey && headerKey === key) return next();
  if (bearer && bearer === key) return next();
  return requireAdmin(req as any, res as any, next as any);
});

// POST /api/maintenance/edu/bootstrap
// Body: { orgName: string, orgId?: string, adminEmail: string }
// Creates/updates orgs/{orgId} with orgType=edu and grants the adminEmail user faculty_admin.
router.post("/bootstrap", async (req, res) => {
  try {
    const orgName = asString(req.body?.orgName).trim() || "Your School";
    const adminEmail = coerceEmail(req.body?.adminEmail);
    if (!adminEmail) return res.status(400).json({ error: "adminEmail_invalid" });

    const orgId = asString(req.body?.orgId).trim() || firestore.collection("orgs").doc().id;
    const orgRef = firestore.collection("orgs").doc(orgId);
    const now = Date.now();

    await orgRef.set(
      {
        id: orgId,
        name: orgName,
        orgType: "edu",
        updatedAt: now,
        createdAt: now,
      },
      { merge: true },
    );

    const userSnap = await firestore.collection("users").where("email", "==", adminEmail).limit(1).get();
    if (userSnap.empty) {
      return res.status(404).json({ error: "user_not_found", detail: "Sign up first, then re-run bootstrap." });
    }

    const userDoc = userSnap.docs[0];
    const uid = userDoc.id;
    const user = (userDoc.data() as any) || {};

    await firestore.collection("users").doc(uid).set(
      {
        orgId,
        orgType: "edu",
        orgName,
        updatedAt: now,
      },
      { merge: true },
    );

    const memberId = `${orgId}_${uid}`;
    await firestore.collection("orgMembers").doc(memberId).set(
      {
        orgId,
        uid,
        email: adminEmail,
        role: "faculty_admin",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );

    await writeEduAudit({
      orgId,
      action: "org.bootstrap",
      actorUid: uid,
      actorName: asString(user.displayName || user.name || user.email || "Admin"),
      targetId: orgId,
    });

    return res.json({
      ok: true,
      org: { id: orgId, name: orgName, orgType: "edu" },
      member: { id: memberId, uid, email: adminEmail, role: "faculty_admin" },
    });
  } catch (err: any) {
    console.error("POST /api/maintenance/edu/bootstrap error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /api/maintenance/edu/members/promote
// Body: { orgId: string, email: string, role: EduOrgRole }
// Promotes an existing user into orgMembers and sets users/{uid}.orgId/orgType.
router.post("/members/promote", async (req, res) => {
  try {
    const orgId = asString(req.body?.orgId).trim();
    if (!orgId) return res.status(400).json({ error: "orgId_required" });

    const email = coerceEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "email_invalid" });

    const role = coerceEduOrgRole(req.body?.role) as EduOrgRole | null;
    if (!role) return res.status(400).json({ error: "role_invalid" });

    const orgSnap = await firestore.collection("orgs").doc(orgId).get();
    if (!orgSnap.exists) return res.status(404).json({ error: "org_not_found" });
    const org = (orgSnap.data() as any) || {};

    const userSnap = await firestore.collection("users").where("email", "==", email).limit(1).get();
    if (userSnap.empty) {
      return res.status(404).json({ error: "user_not_found", detail: "User must sign up before promotion." });
    }
    const userDoc = userSnap.docs[0];
    const uid = userDoc.id;
    const user = (userDoc.data() as any) || {};

    const now = Date.now();
    await firestore.collection("users").doc(uid).set(
      {
        orgId,
        orgType: typeof org.orgType === "string" && String(org.orgType).trim() ? String(org.orgType).trim() : "edu",
        orgName: typeof org.name === "string" ? org.name : null,
        updatedAt: now,
      },
      { merge: true },
    );

    const memberId = `${orgId}_${uid}`;
    await firestore.collection("orgMembers").doc(memberId).set(
      {
        orgId,
        uid,
        email,
        role,
        status: "active",
        updatedAt: now,
        createdAt: now,
      },
      { merge: true },
    );

    await writeEduAudit({
      orgId,
      action: "org.member_promoted",
      actorUid: uid,
      actorName: asString(user.displayName || user.name || user.email || "User"),
      targetId: memberId,
    });

    return res.json({ ok: true, member: { id: memberId, uid, email, role } });
  } catch (err: any) {
    console.error("POST /api/maintenance/edu/members/promote error", err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
