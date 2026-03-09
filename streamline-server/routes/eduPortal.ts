/**
 * eduPortal — School-specific public portal routes.
 *
 * Provides the server-side endpoints that the SchoolPortal client page
 * consumes. These are **unauthenticated** (the portal IS the login page).
 *
 * Routes (mounted at /api/edu/portal):
 *   GET  /:slug                 → lookup school public info by slug
 *   POST /:slug/login           → authenticate staff or student by username+password
 *   POST /:slug/change-password → student/staff first-password-change
 *   POST /:slug/activate-staff  → staff onboarding code activation
 *   POST /:slug/validate-student → check student username is eligible for activation
 *   POST /:slug/activate-student → student sets password & activates account
 */

import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { firestore } from "../firebaseAdmin";
import { tenantCol, globalCol } from "../lib/dbPaths";
import { DEFAULT_TEACHER_PERMISSIONS } from "../lib/teacherPermissions";

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

    // Normalize role: map legacy "staff" to "faculty_teacher"
    const resolvedRole = (pending.role === "staff" || pending.role === "faculty_teacher")
      ? "faculty_teacher"
      : (pending.role || "faculty_admin");

    // ── Idempotency guard: check if a user with this email already exists ──
    const existingUser = await globalCol("users")
      .where("email", "==", username)
      .limit(1)
      .get();

    if (!existingUser.empty) {
      // Account already activated — return the existing credentials so the
      // client treats this as a success (prevents duplicate user docs).
      const existingDoc = existingUser.docs[0];
      const existingUid = existingDoc.id;
      console.log("[eduPortal] activate-staff: email already exists, returning existing user", { username, uid: existingUid });
      const token = jwt.sign({ uid: existingUid }, getJwtSecret(), { expiresIn: "7d" });
      (res as any).cookie("token", token, cookieOptions());
      return res.json({
        ok: true,
        token,
        userId: existingUid,
        role: resolvedRole,
      });
    }

    // ── Use a transaction to atomically check + consume the pending invite ──
    const result = await firestore.runTransaction(async (tx) => {
      // Re-read the pending staff doc inside the transaction to guard against
      // concurrent activations (double-click / race condition).
      const freshSnap = await tx.get(staffDoc.ref);
      if (!freshSnap.exists) throw new Error("invite_not_found");
      const freshData = freshSnap.data() as any;
      if (freshData.status !== "pending") {
        throw new Error("invite_already_used");
      }

      // Create the user account in global users collection
      const userRef = globalCol("users").doc();
      const uid = userRef.id;

      tx.set(userRef, {
        displayName: fullName,
        name: fullName,
        email: username,
        passwordHash,
        orgId,
        orgType: "edu",
        orgName: org.name || "",
        orgRole: resolvedRole,
        positionTitle: positionTitle || pending.positionTitle || "",
        createdAt: now,
        updatedAt: now,
      });

      // Create membership
      const memberId = `${orgId}_${uid}`;
      const memberDoc: any = {
        orgId,
        uid,
        email: username,
        name: fullName,
        role: resolvedRole,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };

      // Seed default permissions for teachers
      if (resolvedRole === "faculty_teacher") {
        memberDoc.permissions = { ...DEFAULT_TEACHER_PERMISSIONS };
      }

      tx.set(tenantCol("orgMembers").doc(memberId), memberDoc);

      // Mark pending staff as used (inside the same transaction)
      tx.set(staffDoc.ref, { status: "active", usedAt: now, activatedByUid: uid }, { merge: true });

      return { uid, resolvedRole };
    });

    const token = jwt.sign({ uid: result.uid }, getJwtSecret(), { expiresIn: "7d" });
    (res as any).cookie("token", token, cookieOptions());

    return res.json({
      ok: true,
      token,
      userId: result.uid,
      role: result.resolvedRole,
    });
  } catch (err: any) {
    // Handle known transaction-abort reasons gracefully
    if (err?.message === "invite_already_used") {
      return res.status(409).json({ error: "This activation code has already been used" });
    }
    if (err?.message === "invite_not_found") {
      return res.status(404).json({ error: "Invalid or expired activation code" });
    }
    console.error("[eduPortal] POST /:slug/activate-staff error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /api/edu/portal/:slug/validate-student ──────────────── */
// Step 1 of student activation: verify the username exists, belongs to the
// school, and is eligible for account setup (no password yet or still on
// mustChangePassword).
router.post("/:slug/validate-student", async (req, res) => {
  try {
    const slug = asString(req.params.slug).toLowerCase().trim();
    const username = asString(req.body?.username).trim().toLowerCase();

    if (!slug || !username) {
      return res.status(400).json({ error: "Username is required" });
    }

    const org = await lookupOrgBySlug(slug);
    if (!org) return res.status(404).json({ error: "school_not_found" });
    const orgId = org.id;

    const snap = await tenantCol("students")
      .where("orgId", "==", orgId)
      .where("username", "==", username)
      .where("status", "==", "active")
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(404).json({ error: "No student account found with that username." });
    }

    const doc = snap.docs[0];
    const student = doc.data() as any;

    // Already has a password and doesn't need a change → already activated
    const hash = asString(student.passwordHash || student.password);
    if (hash && student.mustChangePassword !== true) {
      return res.status(409).json({ error: "This account has already been activated. Use Sign In instead." });
    }

    return res.json({
      ok: true,
      studentId: doc.id,
      fullName: student.fullName || student.name || username,
    });
  } catch (err: any) {
    console.error("[eduPortal] POST /:slug/validate-student error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ── POST /api/edu/portal/:slug/activate-student ──────────────── */
// Step 2 of student activation: set a new password and activate.
router.post("/:slug/activate-student", async (req, res) => {
  try {
    const slug = asString(req.params.slug).toLowerCase().trim();
    const studentId = asString(req.body?.studentId).trim();
    const username = asString(req.body?.username).trim().toLowerCase();
    const password = asString(req.body?.password);
    const confirmPassword = asString(req.body?.confirmPassword);

    if (!slug || !studentId || !username || !password) {
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

    // Fetch the exact student document by ID
    const docRef = tenantCol("students").doc(studentId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ error: "Student record not found" });
    }

    const student = docSnap.data() as any;

    // Defensive checks: must belong to same org and match username
    if (student.orgId !== orgId || (student.username || "").toLowerCase() !== username) {
      return res.status(403).json({ error: "Student does not belong to this school" });
    }
    if (student.status !== "active") {
      return res.status(403).json({ error: "Account is inactive — contact your teacher" });
    }

    // Prevent re-activation of an already-fully-activated account
    const existingHash = asString(student.passwordHash || student.password);
    if (existingHash && student.mustChangePassword !== true) {
      return res.status(409).json({ error: "Account already activated. Use Sign In." });
    }

    const now = Date.now();
    const passwordHash = await bcrypt.hash(password, 10);

    await docRef.set(
      {
        passwordHash,
        mustChangePassword: false,
        activatedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );

    // Issue a JWT so the student is signed in immediately
    const token = jwt.sign(
      {
        sub: studentId,
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
      role: student.role || "viewer",
    });
  } catch (err: any) {
    console.error("[eduPortal] POST /:slug/activate-student error:", err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
