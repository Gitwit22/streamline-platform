"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const requireAuth_1 = require("../middleware/requireAuth");
const firebaseAdmin_1 = require("../firebaseAdmin");
console.log("✅ auth router loaded");
const router = (0, express_1.Router)();
// --- helpers ---
function cookieOptions() {
    const isProd = process.env.NODE_ENV === "production";
    return {
        httpOnly: true,
        secure: isProd, // true on https (Render), false on localhost/http
        sameSite: (isProd ? "none" : "lax"),
        path: "/",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    };
}
function mustGetEnv(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing env var: ${name}`);
    return v;
}
function stripSensitiveUserFields(user) {
    if (!user)
        return user;
    const { passwordHash, ...safe } = user;
    return safe;
}
// Health check for auth router
router.get("/ping", (_req, res) => res.json({ ok: true }));
/**
 * GET /api/auth/me
 * Returns the authenticated user's Firestore document.
 */
router.get("/me", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const user = req.user || {};
        const userId = user.id || user.uid;
        if (!userId)
            return res.status(401).json({ error: "Unauthorized" });
        const snap = await firebaseAdmin_1.firestore.collection("users").doc(userId).get();
        if (!snap.exists)
            return res.status(404).json({ error: "User not found" });
        return res.json({ id: userId, ...stripSensitiveUserFields(snap.data()) });
    }
    catch (err) {
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
        const { email, password } = (req.body || {});
        if (!email || !password) {
            return res.status(400).json({ error: "Missing email or password" });
        }
        const emailNorm = email.trim().toLowerCase();
        // Find user by email (stored in Firestore)
        const snap = await firebaseAdmin_1.firestore
            .collection("users")
            .where("email", "==", emailNorm)
            .limit(1)
            .get();
        if (snap.empty) {
            return res.status(401).json({ error: "Invalid credentials" });
        }
        const doc = snap.docs[0];
        const user = doc.data();
        // Verify password
        const storedHash = user.passwordHash;
        if (!storedHash) {
            // user exists but has no password hash (maybe legacy or admin-created)
            return res.status(401).json({ error: "Invalid credentials" });
        }
        const ok = await bcryptjs_1.default.compare(password, storedHash);
        if (!ok) {
            return res.status(401).json({ error: "Invalid credentials" });
        }
        const uid = doc.id;
        const JWT_SECRET = mustGetEnv("JWT_SECRET");
        // Token payload must match what requireAuth expects
        const token = jsonwebtoken_1.default.sign({ uid }, JWT_SECRET, { expiresIn: "7d" });
        // Set cookie
        res.cookie("token", token, cookieOptions());
        return res.json({
            user: { id: uid, ...stripSensitiveUserFields(user) },
        });
    }
    catch (err) {
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
        const { email, password, displayName, timeZone } = (req.body || {});
        if (!email || !password) {
            return res.status(400).json({ error: "Email and password required" });
        }
        const emailNorm = String(email).trim().toLowerCase();
        const existing = await firebaseAdmin_1.firestore
            .collection("users")
            .where("email", "==", emailNorm)
            .limit(1)
            .get();
        if (!existing.empty) {
            return res.status(409).json({ error: "Email already in use" });
        }
        const passwordHash = await bcryptjs_1.default.hash(String(password), 10);
        const userRef = firebaseAdmin_1.firestore.collection("users").doc();
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
        const token = jsonwebtoken_1.default.sign({ uid }, JWT_SECRET, { expiresIn: "7d" });
        res.cookie("token", token, cookieOptions());
        return res.json({ user: { id: uid, ...stripSensitiveUserFields(userData) } });
    }
    catch (err) {
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
exports.default = router;
