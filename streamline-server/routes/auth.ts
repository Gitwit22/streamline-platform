import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { requireAuth } from "../middleware/requireAuth";
import { firestore as db } from "../firebaseAdmin";
import { getUserAccount } from "../lib/userAccount";

console.log("✅ auth router loaded");

const router = Router();

// --- helpers ---
function cookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd, // true on https (Render), false on localhost/http
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
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
  if (!user) return user;
  const { passwordHash, ...safe } = user;
  return safe;
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
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const account = await getUserAccount(userId);

    // Load the latest Firestore snapshot so we can strip sensitive fields
    const snap = await db.collection("users").doc(userId).get();
    const raw = stripSensitiveUserFields(snap.data() || account.rawUser || {});

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

    const JWT_SECRET = mustGetEnv("JWT_SECRET");

    // Token payload must match what requireAuth expects
    const token = jwt.sign({ uid }, JWT_SECRET, { expiresIn: "7d" });

    // Set cookie
    res.cookie("token", token, cookieOptions());

    return res.json({
      user: { id: uid, ...stripSensitiveUserFields(user) },
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
 * POST /api/auth/signup
 * Body: { email, password, displayName?, timeZone? }
 * Creates user doc + sets auth cookie.
 */
router.post("/signup", async (req, res) => {
  try {
    const { email, password, displayName, timeZone } = (req.body || {}) as any;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const emailNorm = String(email).trim().toLowerCase();

    const existing = await db
      .collection("users")
      .where("email", "==", emailNorm)
      .limit(1)
      .get();

    if (!existing.empty) {
      return res.status(409).json({ error: "Email already in use" });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const userRef = db.collection("users").doc();
    const uid = userRef.id;

    const userData = {
      email: emailNorm,
      displayName: displayName ? String(displayName) : "",
      passwordHash,
      planId: "free",
      billingActive: false,
      billingStatus: "none",
      createdAt: Date.now(),
      timeZone: timeZone ? String(timeZone) : "America/Chicago",
    };

    await userRef.set(userData);

    const JWT_SECRET = mustGetEnv("JWT_SECRET");
    const token = jwt.sign({ uid }, JWT_SECRET, { expiresIn: "7d" });

    res.cookie("token", token, cookieOptions());

    return res.json({ user: { id: uid, ...stripSensitiveUserFields(userData) } });
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

export default router;
