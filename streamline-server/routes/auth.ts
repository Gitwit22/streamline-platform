import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { requireAuth } from "../middleware/requireAuth";
import { auth as firebaseAuth, firestore as db } from "../firebaseAdmin";
import { logAuthSecurityEvent } from "../lib/authAudit";
import {
  buildConsumedPasswordResetState,
  buildRecoveryFailureState,
  buildForgotPasswordStatus,
  buildRecoveryResetState,
  buildRecoverySetupState,
  buildRecoveryVerifiedState,
  hashEmergencyCode,
  hashSecurityAnswer,
  isEmergencyCodeRecoveryAvailable,
  isAdminPasswordResetActive,
  isQuestionRecoveryAvailable,
  isRecoveryMethodLocked,
  normalizeRecoveryState,
  SECURITY_QUESTIONS,
  stripSensitiveRecoveryFields,
  validatePassword,
  validateRecoverySetupInput,
  verifyEmergencyCode,
  verifySecurityAnswer,
} from "../lib/accountRecovery";
import { getUserAccount } from "../lib/userAccount";
import { normalizeBillingTruthFromUser } from "../lib/billingTruth";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { buildNewUserDoc } from "../lib/newUserDefaults";
import { sendEmail } from "../lib/emailService.js";
import { buildWelcomeEmail, buildPasswordResetConfirmationEmail } from "../lib/emailTemplates.js";

console.log("✅ auth router loaded");

const router = Router();

// --- helpers ---
function cookieOptions() {
  // On Render we always serve over HTTPS, but local dev runs on http://localhost.
  // Derive a simple "isLocal" flag from CLIENT_URL so cookies stay usable in
  // local dev while remaining Secure in hosted environments.
  const clientUrl = process.env.CLIENT_URL || process.env.CLIENT_URL_2 || "";
  const isLocal = clientUrl.startsWith("http://localhost") || clientUrl.startsWith("http://127.0.0.1");

  // In hosted environments the API is typically on a different subdomain
  // than the web app (e.g. api.onrender.com vs app.onrender.com). For the
  // httpOnly auth cookie to be sent on cross-site XHR/fetch requests from
  // the web origin, it must explicitly opt out of SameSite protections.
  //
  // - Local dev (localhost ↔ localhost) is same-site, so SameSite=Lax is
  //   sufficient and avoids third-party-cookie semantics.
  // - Hosted envs must use SameSite=None; Secure so that the browser will
  //   attach the cookie on cross-site API calls made with credentials: 'include'.
  const secure = !isLocal;
  const sameSite: "none" | "lax" = secure ? "none" : "lax";

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  };
}

function mustGetEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function stripSensitiveUserFields(user: any) {
  return stripSensitiveRecoveryFields(user);
}

function normalizeLoginIdentifier(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isSupportedRecoveryMethod(value: unknown): value is "admin" | "question" | "code" {
  return value === "admin" || value === "question" || value === "code";
}

async function findUserByLogin(login: string) {
  const loginNorm = normalizeLoginIdentifier(login);
  if (!loginNorm) return null;

  const snap = await db
    .collection("users")
    .where("email", "==", loginNorm)
    .limit(1)
    .get();

  if (snap.empty) return null;
  return snap.docs[0];
}

function signLegacySessionToken(uid: string) {
  const jwtSecret = mustGetEnv("JWT_SECRET");
  return jwt.sign({ uid }, jwtSecret, { expiresIn: "7d" });
}

async function ensureFirebaseCustomToken(uid: string, email: string, password?: string) {
  const emailNorm = normalizeLoginIdentifier(email);
  let hasUser = false;

  try {
    const existing = await firebaseAuth.getUser(uid);
    hasUser = true;
    if (password) {
      await firebaseAuth.updateUser(uid, {
        email: emailNorm,
        emailVerified: false,
        password,
      });
    } else if (!existing.email || String(existing.email).trim().toLowerCase() !== emailNorm) {
      await firebaseAuth.updateUser(uid, {
        email: emailNorm,
        emailVerified: false,
      });
    }
  } catch (err: any) {
    if (String(err?.code || "") !== "auth/user-not-found") {
      console.warn("[auth] Failed to look up Firebase Auth user:", err?.code || err?.message || err);
    }
  }

  if (!hasUser) {
    try {
      await firebaseAuth.createUser({
        uid,
        email: emailNorm,
        emailVerified: false,
        ...(password ? { password } : {}),
      });
    } catch (err: any) {
      const code = String(err?.code || "");
      if (code !== "auth/email-already-exists") {
        console.warn("[auth] Failed to create Firebase Auth user:", err?.code || err?.message || err);
      }
    }
  }

  try {
    return await firebaseAuth.createCustomToken(uid);
  } catch (err: any) {
    console.warn("[auth] Failed to mint Firebase custom token:", err?.code || err?.message || err);
    return null;
  }
}

// Health check for auth router
router.get("/ping", (_req, res) => res.json({ ok: true }));

/**
 * GET /api/auth/me
 * Returns the authenticated user's normalized account document.
 *
 * Behavior:
 * - Never 404s due to missing user doc; auto-creates a minimal doc.
 * - Exposes planId, billingEnabled, platformBillingEnabled, effectiveBillingEnabled, isAdmin.
 */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user || {};
    const userId = user.id || user.uid;
    if (!userId) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    const account = (req as any).account || await getUserAccount(userId);

    // Load the latest Firestore snapshot so we can strip sensitive fields
    const snap = await db.collection("users").doc(userId).get();
    const raw = stripSensitiveUserFields(snap.data() || account.rawUser || {});

    // Ensure billingTruth/planId are present for legacy docs.
    // This keeps admin + client display consistent even for free users.
    try {
      const planIdMissing = typeof (raw as any).planId !== "string" || !String((raw as any).planId).trim();
      const billingTruthMissing = !(raw as any).billingTruth;

      if (planIdMissing || billingTruthMissing) {
        const now = Date.now();
        const nextPlanId = planIdMissing ? "free" : (raw as any).planId;
        const patch: any = { updatedAt: now };
        if (planIdMissing) patch.planId = "free";
        if (billingTruthMissing) {
          patch.billingTruth = normalizeBillingTruthFromUser({ ...raw, planId: nextPlanId }, now);
        }
        await db.collection("users").doc(userId).set(patch, { merge: true });
        // Keep response in sync without requiring another round-trip.
        if (planIdMissing) (raw as any).planId = "free";
        if (billingTruthMissing) (raw as any).billingTruth = patch.billingTruth;
      }
    } catch {
      // non-fatal
    }

    const body = {
      id: userId,
      ...raw,
      planId: account.planId,
      billingEnabled: account.billingEnabled,
      platformBillingEnabled: account.platformBillingEnabled,
      effectiveBillingEnabled: account.effectiveBillingEnabled,
      isAdmin: account.isAdmin,
      // When effective billing is disabled (either per-user or platform-wide),
      // treat the account as running in "test" mode from the client's POV.
      billingMode: account.effectiveBillingEnabled === false ? "test" : "live",
    };

    return res.json(body);
  } catch (err: any) {
    console.error("GET /api/auth/me failed:", err?.message || err);
    return res.status(500).json({ error: "Failed to load user" });
  }
});

 //POST /api/auth/login
  //Body: { email, password }
 //Sets httpOnly cookie "token" so requireAuth works.
 
router.post("/login", async (req, res) => {
  try {
    // ✅ never destructure blindly
    const { email, password } = (req.body || {}) as { email?: string; password?: string };

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    const emailNorm = email.trim().toLowerCase();

    // Find user by email (stored in Firestore)
    const snap = await db
      .collection("users")
      .where("email", "==", emailNorm)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const doc = snap.docs[0];
    const user = doc.data() as any;

    // Reject login to deleted accounts
    if (user.accountStatus === "deleted") {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Verify password
    const storedHash = user.passwordHash;
    if (!storedHash) {
      // user exists but has no password hash (maybe legacy or admin-created)
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, storedHash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const uid = doc.id;

    // Token payload must match what requireAuth expects
    const token = signLegacySessionToken(uid);

    // Set cookie for httpOnly auth (legacy/secondary) and return token
    // in the JSON body so the frontend can use Authorization headers.
    res.cookie("token", token, cookieOptions());

    return res.json({
      user: { id: uid, ...stripSensitiveUserFields(user) },
      token,
    });
  } catch (err: any) {
    console.error("POST /api/auth/login failed:", err?.message || err);
    return res.status(500).json({
      error: "Login failed",
      detail: err?.message || String(err),
    });
  }
});

/**
 * POST /api/auth/legacy-login
 * Body: { email, password }
 *
 * Lazy-migration bridge:
 * - Verifies legacy passwordHash in Firestore
 * - Ensures Firebase Auth user exists using INTERNAL UID as the primary key
 * - Mints a Firebase custom token for client sign-in (signInWithCustomToken)
 */
router.post("/legacy-login", async (req, res) => {
  try {
    const { email, password } = (req.body || {}) as { email?: string; password?: string };
    if (!email || !password) return res.status(400).json({ error: "Missing email or password" });

    const emailNorm = String(email).trim().toLowerCase();

    // 1) Find legacy user doc by email (legacy lookup). Canonical identity is doc.id (uid).
    const snap = await db.collection("users").where("email", "==", emailNorm).limit(1).get();
    if (snap.empty) return res.status(401).json({ error: "Invalid credentials" });

    const doc = snap.docs[0];
    const uid = doc.id;
    const user = (doc.data() || {}) as any;

    // Reject login to deleted accounts
    if (user.accountStatus === "deleted") {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // 2) Verify legacy password
    const storedHash = user.passwordHash;
    if (!storedHash) return res.status(401).json({ error: "Invalid credentials" });
    const ok = await bcrypt.compare(String(password), String(storedHash));
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    // 3) Ensure Firebase Auth user exists BY UID (not by email)
    let fbUser: any = null;
    try {
      fbUser = await firebaseAuth.getUser(uid);
    } catch (err: any) {
      const code = String(err?.code || "");
      if (code !== "auth/user-not-found") throw err;
    }

    if (!fbUser) {
      try {
        await firebaseAuth.createUser({
          uid,
          email: emailNorm,
          emailVerified: false,
        });
      } catch (err: any) {
        // If a Firebase account already exists with this email but a different uid,
        // we must NOT auto-bind; return a deterministic error so support can resolve.
        const code = String(err?.code || "");
        if (code === "auth/email-already-exists") {
          if (process.env.AUTH_DEBUG === "1") {
            try {
              const existing = await firebaseAuth.getUserByEmail(emailNorm);
              console.warn("[legacy-login] email conflict", {
                internalUid: uid,
                email: emailNorm,
                firebaseUid: existing?.uid,
              });
            } catch {
              console.warn("[legacy-login] email conflict (failed to lookup existing Firebase user)");
            }
          }
          return res.status(409).json({ error: "email_conflict" });
        }
        throw err;
      }
    } else {
      // Optional: keep Firebase email in sync (off by default)
      const fbEmail = String(fbUser?.email || "").trim().toLowerCase();
      if (fbEmail && fbEmail !== emailNorm && process.env.AUTH_SYNC_FIREBASE_EMAIL === "1") {
        try {
          await firebaseAuth.updateUser(uid, { email: emailNorm, emailVerified: false });
        } catch (err: any) {
          console.warn("[legacy-login] Failed to sync Firebase email for uid", uid, err?.code || err?.message || err);
        }
      }
    }

    // 4) Mint custom token for Firebase client sign-in
    const customToken = await firebaseAuth.createCustomToken(uid);

    // Optional: annotate user doc for audit/debugging.
    try {
      await db.collection("users").doc(uid).set(
        {
          firebaseAuthMigratedAtMs: Date.now(),
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    } catch {
      // non-fatal
    }

    return res.json({ customToken });
  } catch (err: any) {
    console.error("POST /api/auth/legacy-login failed:", err?.message || err);
    return res.status(500).json({ error: "legacy_login_failed" });
  }
});

router.post("/signup", async (req, res) => {
  try {
    const { email, password, displayName, timeZone, tosAccepted } = (req.body || {}) as any;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    // Require explicit Terms of Service acceptance for new accounts.
    if (tosAccepted !== true) {
      return res.status(400).json({ error: "tos_required" });
    }

    const emailNorm = String(email).trim().toLowerCase();

    const existing = await db
      .collection("users")
      .where("email", "==", emailNorm)
      .limit(1)
      .get();

    if (!existing.empty) {
      const existingDoc = existing.docs[0];
      const existingData = existingDoc.data() as any;
      if (existingData.accountStatus === "deleted") {
        // Clear email on the old soft-deleted doc so it won't block the new account
        await db.collection("users").doc(existingDoc.id).update({
          email: `deleted_${existingDoc.id}@purged`,
        });
      } else {
        return res.status(409).json({ error: "Email already in use" });
      }
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const userRef = db.collection("users").doc();
    const uid = userRef.id;

    const now = Date.now();

    const userData = buildNewUserDoc({
      email: emailNorm,
      passwordHash,
      displayName,
      timeZone,
      nowMs: now,
      tosAcceptedIp: req.ip || undefined,
      tosUserAgent: req.get("user-agent") || undefined,
    });

    await userRef.set(userData);

    // Send welcome email — non-blocking; a failure must never prevent account creation.
    // Idempotency: store welcomeEmailSentAt on the user doc after a successful send.
    setImmediate(async () => {
      try {
        const { subject, html } = buildWelcomeEmail({ email: emailNorm, displayName });
        const emailResult = await sendEmail({ to: emailNorm, subject, html });
        if (emailResult.ok && emailResult.messageId !== "disabled") {
          await db
            .collection("users")
            .doc(uid)
            .set({ welcomeEmailSentAt: Date.now() }, { merge: true })
            .catch((err: unknown) => {
              console.warn("[auth/signup] Failed to write welcomeEmailSentAt:", err instanceof Error ? err.message : String(err));
            });
        }
      } catch {
        // Swallow — email is best-effort; account creation already succeeded
      }
    });

    const token = signLegacySessionToken(uid);

    // Set cookie for httpOnly auth (legacy/secondary) and return token
    // in the JSON body so the frontend can use Authorization headers.
    res.cookie("token", token, cookieOptions());

    return res.json({ user: { id: uid, ...stripSensitiveUserFields(userData) }, token });
  } catch (err: any) {
    console.error("POST /api/auth/signup failed:", err?.message || err);
    return res.status(500).json({
      error: "Signup failed",
      detail: err?.message || String(err),
    });
  }
});

/**
 * POST /api/auth/logout
 * Clears auth cookie.
 */
router.post("/logout", (_req, res) => {
  res.clearCookie("token", { path: "/" });
  return res.json({ ok: true });
});

router.get("/recovery/questions", (_req, res) => {
  return res.json({ questions: SECURITY_QUESTIONS });
});

router.post("/forgot-password/check", async (req, res) => {
  try {
    const login = normalizeLoginIdentifier((req.body || {}).login);
    const genericMessage = "Password reset is not currently available. Contact your administrator.";

    if (!login) {
      return res.json({ canReset: false, message: genericMessage, availableMethods: [] });
    }

    const userDoc = await findUserByLogin(login);
    if (!userDoc) {
      return res.json({ canReset: false, message: genericMessage, availableMethods: [] });
    }

    const user = userDoc.data() || {};
    if (user.accountStatus === "deleted") {
      return res.json({ canReset: false, message: genericMessage, availableMethods: [] });
    }

    const forgotPasswordStatus = buildForgotPasswordStatus(user);
    if (forgotPasswordStatus.availableMethods.length === 0) {
      return res.json({ canReset: false, message: genericMessage, availableMethods: [] });
    }

    return res.json({
      canReset: true,
      method: forgotPasswordStatus.availableMethods[0],
      availableMethods: forgotPasswordStatus.availableMethods,
      recoveryQuestion: forgotPasswordStatus.recoveryQuestion,
      message:
        forgotPasswordStatus.availableMethods.includes("admin")
          ? "Reset enabled. You can choose a new password now."
          : "Account recovery is available. Verify your identity to choose a new password.",
    });
  } catch (err: any) {
    console.error("POST /api/auth/forgot-password/check failed:", err?.message || err);
    return res.status(500).json({ error: "forgot_password_check_failed" });
  }
});

router.post("/forgot-password/reset", async (req, res) => {
  try {
    const { login, newPassword, confirmPassword } = (req.body || {}) as {
      login?: string;
      newPassword?: string;
      confirmPassword?: string;
      method?: string;
      answer?: string;
      emergencyCode?: string;
    };
    const genericMessage = "Password reset is not currently available. Contact your administrator.";
    const loginNorm = normalizeLoginIdentifier(login);

    if (!loginNorm) {
      return res.status(400).json({ error: genericMessage });
    }

    if (String(newPassword || "") !== String(confirmPassword || "")) {
      return res.status(400).json({ error: "Passwords do not match." });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const userDoc = await findUserByLogin(loginNorm);
    if (!userDoc) {
      return res.status(400).json({ error: genericMessage });
    }

    const user = (userDoc.data() || {}) as any;
    if (user.accountStatus === "deleted") {
      return res.status(400).json({ error: genericMessage });
    }

    const forgotPasswordStatus = buildForgotPasswordStatus(user, Date.now());
    if (forgotPasswordStatus.availableMethods.length === 0) {
      return res.status(400).json({ error: genericMessage });
    }

    const uid = userDoc.id;
    const now = Date.now();
    const recovery = normalizeRecoveryState(user.recovery);
    const selectedMethod = isSupportedRecoveryMethod((req.body || {}).method)
      ? (req.body || {}).method
      : forgotPasswordStatus.availableMethods[0];

    if (!forgotPasswordStatus.availableMethods.includes(selectedMethod)) {
      return res.status(400).json({ error: "Selected recovery method is not available." });
    }

    let nextRecovery = recovery;
    let requiresRecoverySetup = false;

    if (selectedMethod === "admin") {
      if (!isAdminPasswordResetActive(user.passwordReset, now)) {
        return res.status(400).json({ error: genericMessage });
      }
      nextRecovery = buildRecoveryResetState(recovery, now);
      requiresRecoverySetup = true;
    }

    if (selectedMethod === "question") {
      if (isRecoveryMethodLocked(recovery, "question", now)) {
        return res.status(429).json({ error: "Security question recovery is temporarily locked. Try again later or use your emergency recovery code." });
      }
      if (!isQuestionRecoveryAvailable(recovery, now)) {
        return res.status(400).json({ error: "Security question recovery is not available for this account." });
      }

      const verified = await verifySecurityAnswer((req.body || {}).answer, recovery.answerHash);
      if (!verified) {
        nextRecovery = buildRecoveryFailureState(recovery, "question", now);
        await userDoc.ref.set({ recovery: nextRecovery, updatedAt: now }, { merge: true });
        await logAuthSecurityEvent({
          event: "recovery_verification_failed",
          actorUserId: uid,
          targetUserId: uid,
          ip: req.ip || null,
          details: {
            method: "question",
            failedAttempts: nextRecovery.failedQuestionAttempts,
            lockedUntil: nextRecovery.questionLockedUntil,
          },
        });
        return res.status(400).json({
          error:
            nextRecovery.questionLockedUntil && nextRecovery.questionLockedUntil > now
              ? "Security question recovery is temporarily locked. Try again later or use your emergency recovery code."
              : "Recovery verification failed.",
        });
      }

      nextRecovery = buildRecoveryVerifiedState(recovery, "question", now);
    }

    if (selectedMethod === "code") {
      if (isRecoveryMethodLocked(recovery, "code", now)) {
        return res.status(429).json({ error: "Emergency recovery code verification is temporarily locked. Try again later or use your security question." });
      }
      if (!isEmergencyCodeRecoveryAvailable(recovery, now)) {
        return res.status(400).json({ error: "Emergency recovery code recovery is not available for this account." });
      }

      const verified = await verifyEmergencyCode((req.body || {}).emergencyCode, recovery.emergencyCodeHash);
      if (!verified) {
        nextRecovery = buildRecoveryFailureState(recovery, "code", now);
        await userDoc.ref.set({ recovery: nextRecovery, updatedAt: now }, { merge: true });
        await logAuthSecurityEvent({
          event: "recovery_verification_failed",
          actorUserId: uid,
          targetUserId: uid,
          ip: req.ip || null,
          details: {
            method: "code",
            failedAttempts: nextRecovery.failedCodeAttempts,
            lockedUntil: nextRecovery.codeLockedUntil,
          },
        });
        return res.status(400).json({
          error:
            nextRecovery.codeLockedUntil && nextRecovery.codeLockedUntil > now
              ? "Emergency recovery code verification is temporarily locked. Try again later or use your security question."
              : "Recovery verification failed.",
        });
      }

      nextRecovery = buildRecoveryVerifiedState(recovery, "code", now);
    }

    const passwordHash = await bcrypt.hash(String(newPassword), 10);
    const nextPasswordReset = buildConsumedPasswordResetState(user.passwordReset, now);

    await userDoc.ref.set(
      {
        passwordHash,
        passwordReset: nextPasswordReset,
        recovery: nextRecovery,
        updatedAt: now,
      },
      { merge: true }
    );

    const token = signLegacySessionToken(uid);
    const customToken = await ensureFirebaseCustomToken(uid, String(user.email || loginNorm), String(newPassword));
    res.cookie("token", token, cookieOptions());

    await logAuthSecurityEvent({
      event: "password_reset_completed",
      actorUserId: uid,
      targetUserId: uid,
      ip: req.ip || null,
      details: {
        method: selectedMethod,
        recoverySetupRequired: requiresRecoverySetup,
        recoveryMethod: selectedMethod,
      },
    });

    // Send password-changed security notification — non-blocking; never blocks the reset.
    const resetEmail = String(user.email || loginNorm);
    setImmediate(async () => {
      try {
        const { subject, html } = buildPasswordResetConfirmationEmail({
          email: resetEmail,
          displayName: user.displayName,
        });
        await sendEmail({ to: resetEmail, subject, html });
      } catch {
        // Swallow — email is best-effort; the reset already succeeded
      }
    });

    return res.json({
      success: true,
      token,
      customToken,
      requiresRecoverySetup,
      user: { id: uid, ...stripSensitiveUserFields({ ...user, passwordReset: nextPasswordReset, recovery: nextRecovery }) },
    });
  } catch (err: any) {
    console.error("POST /api/auth/forgot-password/reset failed:", err?.message || err);
    return res.status(500).json({ error: "forgot_password_reset_failed" });
  }
});

router.post("/recovery/setup", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    const { questionId, answer, emergencyCode, confirmEmergencyCode } = (req.body || {}) as {
      questionId?: string;
      answer?: string;
      emergencyCode?: string;
      confirmEmergencyCode?: string;
    };

    const validationError = validateRecoverySetupInput({
      questionId,
      answer,
      emergencyCode,
      confirmEmergencyCode,
    });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: "user_not_found" });
    }

    const user = userSnap.data() || {};
    const now = Date.now();
    const answerHash = await hashSecurityAnswer(answer);
    const emergencyCodeHash = await hashEmergencyCode(emergencyCode);
    const nextRecovery = buildRecoverySetupState(
      {
        questionId: questionId as any,
        answerHash,
        emergencyCodeHash,
      },
      user.recovery,
      now
    );

    await userRef.set(
      {
        recovery: nextRecovery,
        updatedAt: now,
      },
      { merge: true }
    );

    await logAuthSecurityEvent({
      event: "recovery_setup_completed",
      actorUserId: uid,
      targetUserId: uid,
      ip: req.ip || null,
      details: {
        questionId,
        hadExistingRecovery: normalizeRecoveryState(user.recovery).configured,
      },
    });

    return res.json({
      success: true,
      recoveryConfigured: true,
      recoveryRequired: false,
      recovery: stripSensitiveRecoveryFields({ recovery: nextRecovery }).recovery,
    });
  } catch (err: any) {
    console.error("POST /api/auth/recovery/setup failed:", err?.message || err);
    return res.status(500).json({ error: "recovery_setup_failed" });
  }
});

export default router;
