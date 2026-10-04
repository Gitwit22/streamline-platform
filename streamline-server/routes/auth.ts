import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { requireAuth } from "../middleware/requireAuth";
import { auth as firebaseAuth, firestore as db } from "../firebaseAdmin";
import { logAuthSecurityEvent } from "../lib/authAudit";
import {
  buildAdminResetFailureState,
  buildConsumedPasswordResetState,
  buildForgotPasswordStatus,
  buildRecoveryResetState,
  buildRecoverySetupState,
  buildRecoveryVerifiedState,
  hashEmergencyCode,
  hashSecurityAnswer,
  isAdminPasswordResetActive,
  normalizePasswordResetState,
  normalizeRecoveryState,
  reserveRecoveryAttempt,
  SECURITY_QUESTIONS,
  stripSensitiveRecoveryFields,
  validatePassword,
  validateRecoverySetupInput,
  verifyAdminResetSecret,
  verifyEmergencyCode,
  verifySecurityAnswer,
} from "../lib/accountRecovery";
import { clientIp, normalizeRateLimitLogin, rateLimit, SlidingWindowLimiter } from "../lib/rateLimit";
import { getUserAccount } from "../lib/userAccount";
import { normalizeBillingTruthFromUser } from "../lib/billingTruth";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { buildNewUserDoc } from "../lib/newUserDefaults";

console.log("✅ auth router loaded");

const router = Router();

// --- rate limiting ---
// In-memory sliding windows (per process). Keys: client IP, and the normalized
// login identifier so one account can't be brute-forced from many IPs.
const MINUTE_MS = 60_000;
const loginIpLimiter = new SlidingWindowLimiter({ windowMs: 15 * MINUTE_MS, max: 50 });
const loginAccountLimiter = new SlidingWindowLimiter({ windowMs: 15 * MINUTE_MS, max: 10 });
const signupIpLimiter = new SlidingWindowLimiter({ windowMs: 60 * MINUTE_MS, max: 10 });
const recoveryIpLimiter = new SlidingWindowLimiter({ windowMs: 15 * MINUTE_MS, max: 20 });
const recoveryAccountLimiter = new SlidingWindowLimiter({ windowMs: 15 * MINUTE_MS, max: 10 });

function accountKey(field: "email" | "login") {
  return (req: any) => {
    const login = normalizeRateLimitLogin(req.body?.[field]);
    return login ? `acct:${login}` : null;
  };
}
const ipKey = (req: any) => `ip:${clientIp(req)}`;

const loginRateLimit = rateLimit([
  { limiter: loginIpLimiter, key: ipKey },
  { limiter: loginAccountLimiter, key: accountKey("email") },
]);
const signupRateLimit = rateLimit([{ limiter: signupIpLimiter, key: ipKey }]);
const recoveryRateLimit = rateLimit([
  { limiter: recoveryIpLimiter, key: ipKey },
  { limiter: recoveryAccountLimiter, key: accountKey("login") },
]);

// Constant hash used to spend the same bcrypt time when a login is unknown,
// so response timing doesn't reveal which emails have accounts.
const DUMMY_BCRYPT_HASH = bcrypt.hashSync("streamline-dummy-password-not-a-real-account", 10);

async function spendDummyPasswordCheck(password: unknown) {
  try {
    await bcrypt.compare(String(password ?? ""), DUMMY_BCRYPT_HASH);
  } catch {
    // ignore
  }
}

function isDeletedAccount(raw: any): boolean {
  if (!raw) return false;
  if (String(raw.accountStatus || "").toLowerCase() === "deleted") return true;
  const deletedAtMs =
    typeof raw.deletedAtMs === "number" ? raw.deletedAtMs : typeof raw.deletedAt === "number" ? raw.deletedAt : 0;
  return deletedAtMs > 0;
}

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
 * - Never 404s due to missing user doc, but never writes one either (no resurrection).
 * - 403 { error: "account_deleted" } for soft-deleted accounts.
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
    const snapData = snap.exists ? snap.data() || {} : null;

    // Never serve (or resurrect) a soft-deleted account.
    if (isDeletedAccount(snapData) || isDeletedAccount(account?.rawUser)) {
      return res.status(403).json({ error: "account_deleted" });
    }

    const raw = stripSensitiveUserFields(snapData || account.rawUser || {});

    // Ensure billingTruth/planId are present for legacy docs.
    // This keeps admin + client display consistent even for free users.
    // Only patch docs that exist: writing to a missing doc (e.g. a purged
    // account whose session token is still valid) would recreate it.
    try {
      const planIdMissing = typeof (raw as any).planId !== "string" || !String((raw as any).planId).trim();
      const billingTruthMissing = !(raw as any).billingTruth;

      if (snap.exists && (planIdMissing || billingTruthMissing)) {
        const now = Date.now();
        const nextPlanId = planIdMissing ? "free" : (raw as any).planId;
        const patch: any = { updatedAt: now };
        if (planIdMissing) patch.planId = "free";
        if (billingTruthMissing) {
          patch.billingTruth = normalizeBillingTruthFromUser({ ...raw, planId: nextPlanId }, now);
        }
        // update() (not set/merge) fails instead of recreating a doc deleted meanwhile.
        await db.collection("users").doc(userId).update(patch);
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

/**
 * Verify a password against Firebase Auth via the Identity Toolkit REST API.
 * Requires the FIREBASE_API_KEY env var (Firebase project Web API Key).
 * Returns true if the password is valid, false otherwise.
 */
async function verifyPasswordViaFirebaseAuth(email: string, password: string): Promise<boolean> {
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) return false;

  try {
    const res = await fetch(
      "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
        },
        body: JSON.stringify({ email, password, returnSecureToken: false }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

 //POST /api/auth/login
  //Body: { email, password }
 //Sets httpOnly cookie "token" so requireAuth works.
 
router.post("/login", loginRateLimit, async (req, res) => {
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
      await spendDummyPasswordCheck(password);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const doc = snap.docs[0];
    const user = doc.data() as any;

    // Reject login to deleted accounts
    if (isDeletedAccount(user)) {
      await spendDummyPasswordCheck(password);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Verify password
    const storedHash = user.passwordHash;
    if (!storedHash) {
      // Legacy accounts created via Firebase Auth may not have a passwordHash
      // in Firestore. Attempt to verify via Firebase Auth and migrate the hash.
      const firebaseOk = await verifyPasswordViaFirebaseAuth(emailNorm, password);
      if (!firebaseOk) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // One-time migration: store bcrypt hash in Firestore so future logins
      // are self-contained and don't depend on Firebase Auth / API key.
      try {
        const migratedHash = await bcrypt.hash(password, 10);
        await db.collection("users").doc(doc.id).set(
          { passwordHash: migratedHash },
          { merge: true },
        );
        console.log(`[auth] Migrated passwordHash for legacy user ${doc.id}`);
      } catch (migrationErr: any) {
        // Non-fatal: login still succeeds; hash migration will happen on next login.
        console.warn("[auth] passwordHash migration failed:", migrationErr?.message || migrationErr);
      }
    } else {
      const ok = await bcrypt.compare(password, storedHash);
      if (!ok) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
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
    return res.status(500).json({ error: "Login failed" });
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
// (This route used to be registered three times with identical bodies; Express
// only ever ran the first, so the dead copies were removed.)
router.post("/legacy-login", loginRateLimit, async (req, res) => {
  try {
    const { email, password } = (req.body || {}) as { email?: string; password?: string };
    if (!email || !password) return res.status(400).json({ error: "Missing email or password" });

    const emailNorm = String(email).trim().toLowerCase();

    // 1) Find legacy user doc by email (legacy lookup). Canonical identity is doc.id (uid).
    const snap = await db.collection("users").where("email", "==", emailNorm).limit(1).get();
    if (snap.empty) {
      await spendDummyPasswordCheck(password);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const doc = snap.docs[0];
    const uid = doc.id;
    const user = (doc.data() || {}) as any;

    // Reject login to deleted accounts
    if (isDeletedAccount(user)) {
      await spendDummyPasswordCheck(password);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // 2) Verify legacy password
    const storedHash = user.passwordHash;
    if (!storedHash) {
      await spendDummyPasswordCheck(password);
      return res.status(401).json({ error: "Invalid credentials" });
    }
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

router.post("/signup", signupRateLimit, async (req, res) => {
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

    const token = signLegacySessionToken(uid);

    // Set cookie for httpOnly auth (legacy/secondary) and return token
    // in the JSON body so the frontend can use Authorization headers.
    res.cookie("token", token, cookieOptions());

    return res.json({ user: { id: uid, ...stripSensitiveUserFields(userData) }, token });
  } catch (err: any) {
    console.error("POST /api/auth/signup failed:", err?.message || err);
    return res.status(500).json({ error: "Signup failed" });
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

const FORGOT_PASSWORD_UNAVAILABLE_MESSAGE =
  "Password reset is not currently available. Contact your administrator.";

/**
 * Uniform "nothing available" shape. Unknown logins, deleted accounts and
 * accounts with no recovery method configured all get exactly this response,
 * so /forgot-password/check can't be used to tell them apart.
 */
function forgotPasswordUnavailableBody() {
  return {
    canReset: false,
    method: null,
    availableMethods: [] as string[],
    recoveryQuestion: null,
    message: FORGOT_PASSWORD_UNAVAILABLE_MESSAGE,
  };
}

router.post("/forgot-password/check", recoveryRateLimit, async (req, res) => {
  try {
    const login = normalizeLoginIdentifier((req.body || {}).login);
    if (!login) {
      return res.json(forgotPasswordUnavailableBody());
    }

    const userDoc = await findUserByLogin(login);
    const user = userDoc ? userDoc.data() || {} : null;
    if (!user || isDeletedAccount(user)) {
      return res.json(forgotPasswordUnavailableBody());
    }

    const forgotPasswordStatus = buildForgotPasswordStatus(user);
    if (forgotPasswordStatus.availableMethods.length === 0) {
      return res.json(forgotPasswordUnavailableBody());
    }

    // Only what the form needs: which methods to offer and, for the question
    // method, the question text. No expiry, attempt counts or lock state.
    return res.json({
      canReset: true,
      method: forgotPasswordStatus.availableMethods[0],
      availableMethods: forgotPasswordStatus.availableMethods,
      recoveryQuestion: forgotPasswordStatus.recoveryQuestion,
      message: forgotPasswordStatus.availableMethods.includes("admin")
        ? "Enter the reset code your administrator gave you, then choose a new password."
        : "Account recovery is available. Verify your identity to choose a new password.",
    });
  } catch (err: any) {
    console.error("POST /api/auth/forgot-password/check failed:", err?.message || err);
    return res.status(500).json({ error: "forgot_password_check_failed" });
  }
});

type ResetOutcome =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      user: any;
      nextRecovery: ReturnType<typeof normalizeRecoveryState>;
      nextPasswordReset: ReturnType<typeof normalizePasswordResetState>;
      requiresRecoverySetup: boolean;
    };

const QUESTION_LOCKED_MESSAGE =
  "Security question recovery is temporarily locked. Try again later or use your emergency recovery code.";
const CODE_LOCKED_MESSAGE =
  "Emergency recovery code verification is temporarily locked. Try again later or use your security question.";

router.post("/forgot-password/reset", recoveryRateLimit, async (req, res) => {
  try {
    const body = (req.body || {}) as {
      login?: string;
      newPassword?: string;
      confirmPassword?: string;
      method?: string;
      answer?: string;
      emergencyCode?: string;
      resetCode?: string;
    };
    const { login, newPassword, confirmPassword } = body;
    const genericMessage = FORGOT_PASSWORD_UNAVAILABLE_MESSAGE;
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

    const initialUser = (userDoc.data() || {}) as any;
    if (isDeletedAccount(initialUser)) {
      return res.status(400).json({ error: genericMessage });
    }

    const forgotPasswordStatus = buildForgotPasswordStatus(initialUser, Date.now());
    if (forgotPasswordStatus.availableMethods.length === 0) {
      return res.status(400).json({ error: genericMessage });
    }

    const uid = userDoc.id;
    const userRef = userDoc.ref;
    const now = Date.now();
    // Floor to the second: JWT iat is in seconds, and the new session token
    // below is issued within this same second.
    const authRevokedAtMs = Math.floor(now / 1000) * 1000;
    const selectedMethod = isSupportedRecoveryMethod(body.method)
      ? body.method
      : forgotPasswordStatus.availableMethods[0];

    if (!forgotPasswordStatus.availableMethods.includes(selectedMethod)) {
      return res.status(400).json({ error: "Selected recovery method is not available." });
    }

    let outcome: ResetOutcome;

    if (selectedMethod === "admin") {
      // The secret is cheap to check (sha256 of a high-entropy code), so verify
      // and consume it inside one transaction: exactly one request can use it,
      // and every wrong guess is counted before the response goes out.
      const passwordHash = await bcrypt.hash(String(newPassword), 10);
      outcome = await db.runTransaction<ResetOutcome>(async (tx) => {
        const fresh = await tx.get(userRef);
        const data = (fresh.exists ? fresh.data() : null) as any;
        if (!data || isDeletedAccount(data) || !isAdminPasswordResetActive(data.passwordReset, now)) {
          return { ok: false, status: 400, error: genericMessage };
        }

        const passwordReset = normalizePasswordResetState(data.passwordReset);
        if (!verifyAdminResetSecret(body.resetCode, passwordReset.secretHash)) {
          const failed = buildAdminResetFailureState(passwordReset);
          tx.set(userRef, { passwordReset: failed, updatedAt: now }, { merge: true });
          return {
            ok: false,
            status: 400,
            error: failed.secretHash
              ? "Invalid reset code."
              : "Too many invalid reset codes. Ask your administrator for a new one.",
          };
        }

        const nextRecovery = buildRecoveryResetState(data.recovery, now);
        const nextPasswordReset = buildConsumedPasswordResetState(passwordReset, now);
        tx.set(
          userRef,
          {
            passwordHash,
            passwordReset: nextPasswordReset,
            recovery: nextRecovery,
            authRevokedAtMs,
            updatedAt: now,
          },
          { merge: true }
        );
        return { ok: true, user: data, nextRecovery, nextPasswordReset, requiresRecoverySetup: true };
      });

      if (!outcome.ok) {
        await logAuthSecurityEvent({
          event: "recovery_verification_failed",
          actorUserId: uid,
          targetUserId: uid,
          ip: req.ip || null,
          details: { method: "admin" },
        });
      }
    } else {
      const method = selectedMethod as "question" | "code";
      const lockedMessage = method === "question" ? QUESTION_LOCKED_MESSAGE : CODE_LOCKED_MESSAGE;

      // 1) Reserve the attempt (count it as failed) in a transaction BEFORE the
      //    bcrypt check, so parallel guesses can't all pass the lockout check.
      const reservation = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(userRef);
        const data = (fresh.exists ? fresh.data() : null) as any;
        if (!data || isDeletedAccount(data)) {
          return { ok: false as const, status: 400, error: genericMessage };
        }
        const reserved = reserveRecoveryAttempt(data.recovery, method, now);
        if (reserved.ok === false) {
          return reserved.reason === "locked"
            ? { ok: false as const, status: 429, error: lockedMessage }
            : {
                ok: false as const,
                status: 400,
                error:
                  method === "question"
                    ? "Security question recovery is not available for this account."
                    : "Emergency recovery code recovery is not available for this account.",
              };
        }
        tx.set(userRef, { recovery: reserved.next, updatedAt: now }, { merge: true });
        return { ok: true as const, user: data, recovery: normalizeRecoveryState(data.recovery), reserved: reserved.next };
      });

      if (reservation.ok === false) {
        outcome = reservation;
      } else {
        // 2) Verify outside the transaction (bcrypt is slow).
        const verified =
          method === "question"
            ? await verifySecurityAnswer(body.answer, reservation.recovery.answerHash)
            : await verifyEmergencyCode(body.emergencyCode, reservation.recovery.emergencyCodeHash);

        if (!verified) {
          const reserved = reservation.reserved;
          await logAuthSecurityEvent({
            event: "recovery_verification_failed",
            actorUserId: uid,
            targetUserId: uid,
            ip: req.ip || null,
            details: {
              method,
              failedAttempts: method === "question" ? reserved.failedQuestionAttempts : reserved.failedCodeAttempts,
              lockedUntil: method === "question" ? reserved.questionLockedUntil : reserved.codeLockedUntil,
            },
          });
          const lockedUntil = method === "question" ? reserved.questionLockedUntil : reserved.codeLockedUntil;
          return res.status(400).json({
            error: lockedUntil && lockedUntil > now ? lockedMessage : "Recovery verification failed.",
          });
        }

        // 3) Success: set the password and clear the counters.
        const passwordHash = await bcrypt.hash(String(newPassword), 10);
        const nextRecovery = buildRecoveryVerifiedState(reservation.reserved, method, now);
        const nextPasswordReset = buildConsumedPasswordResetState(reservation.user.passwordReset, now);
        await userRef.set(
          {
            passwordHash,
            passwordReset: nextPasswordReset,
            recovery: nextRecovery,
            // Invalidate sessions issued before the reset (e.g. an attacker's token).
            authRevokedAtMs,
            updatedAt: now,
          },
          { merge: true }
        );
        outcome = { ok: true, user: reservation.user, nextRecovery, nextPasswordReset, requiresRecoverySetup: false };
      }
    }

    if (outcome.ok === false) {
      return res.status(outcome.status).json({ error: outcome.error });
    }

    const { user, nextRecovery, nextPasswordReset, requiresRecoverySetup } = outcome;

    try {
      await firebaseAuth.revokeRefreshTokens(uid);
    } catch (err: any) {
      console.warn("[auth] revokeRefreshTokens after password reset failed:", err?.message || err);
    }

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
