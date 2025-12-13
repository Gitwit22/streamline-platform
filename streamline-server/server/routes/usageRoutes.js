"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// server/index.ts (or routes/usageRoutes.ts)
const express_1 = __importDefault(require("express"));
const firebaseAdmin_1 = require("../firebaseAdmin");
// your initialized admin SDK
const app = (0, express_1.default)();
app.post("/api/usage/streamEnded", async (req, res) => {
    try {
        const { uid, minutes = 0, guestCount = 0 } = req.body;
        if (!uid) {
            return res.status(400).json({ error: "uid required" });
        }
        // Normalize minutes
        const safeMinutes = Math.max(0, Number(minutes) || 0);
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const usageRef = firebaseAdmin_1.firestore.doc(`usage/${uid}_${monthKey}`);
        const snap = await usageRef.get();
        const existing = snap.exists ? snap.data() : {};
        const totalMinutes = (existing.totalMinutes || 0) + safeMinutes;
        const ytdMinutes = (existing.ytdMinutes || 0) + safeMinutes;
        await usageRef.set({
            totalMinutes,
            ytdMinutes,
            lastUpdated: now.toISOString(),
            lastGuestCount: guestCount,
        }, { merge: true });
        return res.json({ ok: true, totalMinutes, ytdMinutes });
    }
    catch (err) {
        console.error("streamEnded error", err);
        return res.status(500).json({ error: "internal error" });
    }
});
app.get("/api/usage/summary", async (req, res) => {
    try {
        const uid = req.query.uid || req.uid;
        if (!uid) {
            return res.status(401).json({ error: "unauthorized" });
        }
        const userRef = firebaseAdmin_1.firestore.collection("users").doc(uid);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
            return res.status(404).json({ error: "user not found" });
        }
        const userData = userSnap.data() || {};
        const usage = (userData.usage || {});
        const planId = userData.plan || "free";
        // ---- read the plan doc from /plans/{planId} ----
        const planRef = firebaseAdmin_1.firestore.collection("plans").doc(planId);
        const planSnap = await planRef.get();
        if (!planSnap.exists) {
            return res.status(500).json({ error: `plan ${planId} not found` });
        }
        const planData = planSnap.data() || {};
        const maxHoursFromPlan = planData.maxHoursPerMonth || 0;
        const maxGuests = planData.maxGuests || 0;
        const multistreamEnabled = !!planData.multistreamEnabled;
        const now = new Date();
        const usedHours = usage.hoursStreamedThisMonth || 0;
        const ytdHours = usage.ytdHours || 0;
        // if you want to allow per-user overrides, use usage.maxHours first:
        const maxHours = (usage.maxHours && usage.maxHours > 0
            ? usage.maxHours
            : maxHoursFromPlan) || 0;
        // ----------------------------------------------
        // Compute resetDate based on user.createdAt date
        // ----------------------------------------------
        let resetDate = null;
        if (userData.createdAt) {
            const createdAtDate = new Date(userData.createdAt);
            const createdDay = createdAtDate.getDate();
            const now = new Date();
            const thisMonthReset = new Date(now.getFullYear(), now.getMonth(), createdDay);
            const nextMonthReset = new Date(now.getFullYear(), now.getMonth() + 1, createdDay);
            // If today's date is past this month's reset day,
            // next reset is next month. Otherwise it's this month.
            const finalReset = now.getDate() >= createdDay ? nextMonthReset : thisMonthReset;
            resetDate = finalReset.toISOString();
        }
        return res.json({
            displayName: userData.displayName || "",
            planId,
            usedHours,
            maxHours,
            resetDate,
            ytdHours,
            // extra plan info for UI:
            maxGuests,
            multistreamEnabled,
            priceWeekly: planData.priceWeekly || 0,
            priceMonthly: planData.priceMonthly || 0,
            priceYearly: planData.priceYearly || 0,
        });
    }
    catch (err) {
        console.error("usage summary error", err);
        return res.status(500).json({ error: "internal error" });
    }
});
