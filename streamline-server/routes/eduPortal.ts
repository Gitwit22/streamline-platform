/**
 * eduPortal — School-specific public portal routes.
 *
 * Provides the server-side endpoints that the SchoolPortal client page
 * consumes. These are **unauthenticated** (the portal IS the login page).
 *
 * Routes (mounted at /api/edu/portal):
 *   GET  /:slug              → lookup school public info by slug
 *   POST /:slug/login        → authenticate staff or student by username+password
 *   POST /:slug/change-password → student/staff first-password-change
 *   POST /:slug/activate-staff  → staff onboarding code activation
 */

import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { tenantCol, globalCol } from "../lib/dbPaths";

const router = express.Router();

/* ── Helpers ───────────────────────────────────────────────────── */

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function getJwtSecret(): string {
  const raw = asString(process.env.JWT_SECRET).trim();
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  if ((env === "production" || env === "staging") && (!raw || raw === "dev-secret")) {
    throw new Error("Missing JWT_SECRET (no dev-secret in production)");
  }
  return raw || "dev-secret";
}

function cookieOptions() {
  const clientUrl = process.env.CLIENT_URL || process.env.CLIENT_URL_2 || "";
  const isLocal = clientUrl.startsWith("http://localhost") || clientUrl.startsWith("http://127.0.0.1");
  const secure = !isLocal;
  const sameSite: "none" | "lax" = secure ? "none" : "lax";
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

async function lookupOrgBySlug(slug: string) {
  // Query by slug only — don't require status field to exist.
  // Orgs without an explicit status are treated as active (legacy data).
  const snap = await tenantCol("orgs")
    .where("slug", "==", slug.toLowerCase().trim())
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data() as any;
  // Treat missing status as "active" (all created schools are active by default)
  const status = data.status || "active";
  if (status === "suspended" || status === "deleted") return null;
  return { id: doc.id, ...data, status };
}

/* ── GET /api/edu/portal/:slug ─────────────────────────────────── */
// Public school info (name, slug, logo, district, etc.)
router.get("/:slug", async (req, res) => {
  try {
    const slug = asString(req.params.slug).toLowerCase().trim();
    if (!slug || slug.length < 2) return res.status(400).json({ error: "invalid_slug" });

    const org = await lookupOrgBySlug(slug);
    if (!org) return res.status(404).json({ error: "school_not_found" });

    return res.json({
      school: {
        id: org.id,
        name: org.name || "",
        slug: org.slug || slug,
        shortCode: org.shortCode || "",
        logoUrl: org.branding?.logoDataUrl || null,
        district: org.district || null,
        city: org.city || null,
        state: org.state || null,
        status: org.status || "active",
      },
    });
  } catch (err: any) {
    console.error("[eduPortal] GET /:slug error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /api/edu/portal/:slug/login ──────────────────────────── */
// Authenticate a staff or student account using username + password.
router.post("/:slug/login", async (req, res) => {
  try {
    const slug = asString(req.params.slug).toLowerCase().trim();
    const username = asString(req.body?.username).trim().toLowerCase();
    const password = asString(req.body?.password);
    const accountType = asString(req.body?.accountType).trim(); // "staff" | "student"

    if (!slug || !username || !password) {
      return res.status(400).json({ error: "Missing username or password" });
    }

    const org = await lookupOrgBySlug(slug);
    if (!org) return res.status(404).json({ error: "school_not_found" });
    const orgId = org.id;

    if (accountType === "student") {
      // Student login via username in tenants/edu/students
      const snap = await tenantCol("students")
        .where("orgId", "==", orgId)
        .where("username", "==", username)
        .where("status", "==", "active")
        .limit(1)
        .get();

      if (snap.empty) return res.status(401).json({ error: "Invalid credentials" });

      const studentDoc = snap.docs[0];
      const student = studentDoc.data() as any;

      const hash = asString(student.passwordHash || student.password);
      if (!hash) return res.status(401).json({ error: "Account not yet set up. Contact your teacher." });
      const valid = await bcrypt.compare(password, hash);
      if (!valid) return res.status(401).json({ error: "Invalid credentials" });

      // Update lastLoginAt
      await studentDoc.ref.set({ lastLoginAt: Date.now() }, { merge: true });

      const token = jwt.sign(
        {
          sub: studentDoc.id,
          type: "edu_student",
          orgId,
          role: student.role || "viewer",
        },
        getJwtSecret(),
        { expiresIn: "12h" },
      );

      (res as any).cookie("token", token, cookieOptions());

      return res.json({
        ok: true,
        token,
        mustChangePassword: student.mustChangePassword === true,
        role: student.role || "viewer",
      });
    }

    // Staff login — look up by email (username is their email for staff)
    const userSnap = await globalCol("users")
      .where("email", "==", username)
      .where("orgId", "==", orgId)
      .limit(1)
      .get();

    if (userSnap.empty) return res.status(401).json({ error: "Invalid credentials" });

    const userDoc = userSnap.docs[0];
    const user = userDoc.data() as any;

    if (!user.passwordHash) return res.status(401).json({ error: "Account not activated. Use Activate Account tab." });

    const valid = await bcrypt.compare(password, asString(user.passwordHash));
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign({ uid: userDoc.id }, getJwtSecret(), { expiresIn: "7d" });
    (res as any).cookie("token", token, cookieOptions());

    return res.json({
      ok: true,
      token,
      mustChangePassword: false,
      role: user.orgRole || "faculty_admin",
    });
  } catch (err: any) {
    console.error("[eduPortal] POST /:slug/login error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /api/edu/portal/:slug/change-password ───────────────── */
// Student or staff first-password-change flow.
router.post("/:slug/change-password", async (req, res) => {
  try {
    const slug = asString(req.params.slug).toLowerCase().trim();
    const username = asString(req.body?.username).trim().toLowerCase();
    const currentPassword = asString(req.body?.currentPassword);
    const newPassword = asString(req.body?.newPassword);

    if (!slug || !username || !currentPassword || !newPassword) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const org = await lookupOrgBySlug(slug);
    if (!org) return res.status(404).json({ error: "school_not_found" });
    const orgId = org.id;

    // Try student first
    const stuSnap = await tenantCol("students")
      .where("orgId", "==", orgId)
      .where("username", "==", username)
      .limit(1)
      .get();

    if (!stuSnap.empty) {
      const stuDoc = stuSnap.docs[0];
      const student = stuDoc.data() as any;

      const hash = asString(student.passwordHash || student.password);
      const valid = await bcrypt.compare(currentPassword, hash);
      if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

      const newHash = await bcrypt.hash(newPassword, 10);
      await stuDoc.ref.set(
        { passwordHash: newHash, mustChangePassword: false, updatedAt: Date.now() },
        { merge: true },
      );

      return res.json({ ok: true });
    }

    // Try staff
    const staffSnap = await globalCol("users")
      .where("email", "==", username)
      .where("orgId", "==", orgId)
      .limit(1)
      .get();

    if (!staffSnap.empty) {
      const staffDoc = staffSnap.docs[0];
      const staff = staffDoc.data() as any;

      if (!staff.passwordHash) return res.status(401).json({ error: "Account not yet activated" });

      const valid = await bcrypt.compare(currentPassword, asString(staff.passwordHash));
      if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

      const newHash = await bcrypt.hash(newPassword, 10);
      await staffDoc.ref.set(
        { passwordHash: newHash, updatedAt: Date.now() },
        { merge: true },
      );

      return res.json({ ok: true });
    }

    return res.status(404).json({ error: "User not found" });
  } catch (err: any) {
    console.error("[eduPortal] POST /:slug/change-password error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /api/edu/portal/:slug/activate-staff ────────────────── */
// Staff activates their account using an onboarding code.
router.post("/:slug/activate-staff", async (req, res) => {
  try {
    const slug = asString(req.params.slug).toLowerCase().trim();
    const onboardingCode = asString(req.body?.onboardingCode).trim().toUpperCase();
    const fullName = asString(req.body?.fullName).trim();
    const username = asString(req.body?.username).trim().toLowerCase(); // will be their email/login
    const password = asString(req.body?.password);
    const confirmPassword = asString(req.body?.confirmPassword);
    const positionTitle = asString(req.body?.positionTitle).trim();

    if (!slug || !onboardingCode || !fullName || !username || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const org = await lookupOrgBySlug(slug);
    if (!org) return res.status(404).json({ error: "school_not_found" });
    const orgId = org.id;

    // Find pending staff record by onboarding code
    const staffSnap = await tenantCol("pendingStaff")
      .where("orgId", "==", orgId)
      .where("onboardingCode", "==", onboardingCode)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (staffSnap.empty) {
      return res.status(404).json({ error: "Invalid or expired activation code" });
    }

    const staffDoc = staffSnap.docs[0];
    const pending = staffDoc.data() as any;
    const now = Date.now();
    const passwordHash = await bcrypt.hash(password, 10);

    // Create the user account in global users collection
    const userRef = globalCol("users").doc();
    const uid = userRef.id;

    await userRef.set({
      displayName: fullName,
      name: fullName,
      email: username,
      passwordHash,
      orgId,
      orgType: "edu",
      orgName: org.name || "",
      orgRole: pending.role || "faculty_admin",
      positionTitle: positionTitle || pending.positionTitle || "",
      createdAt: now,
      updatedAt: now,
    });

    // Create membership
    const memberId = `${orgId}_${uid}`;
    await tenantCol("orgMembers").doc(memberId).set({
      orgId,
      uid,
      email: username,
      name: fullName,
      role: pending.role || "faculty_admin",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    // Mark pending staff as used
    await staffDoc.ref.set(
      { status: "active", usedAt: now, activatedByUid: uid },
      { merge: true },
    );

    const token = jwt.sign({ uid }, getJwtSecret(), { expiresIn: "7d" });
    (res as any).cookie("token", token, cookieOptions());

    return res.json({
      ok: true,
      token,
      userId: uid,
      role: pending.role || "faculty_admin",
    });
  } catch (err: any) {
    console.error("[eduPortal] POST /:slug/activate-staff error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
