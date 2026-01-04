"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const router = express_1.default.Router();
// Simple in-memory cache to reduce Firestore reads
let cached = null;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds
// Public stats for landing page
router.get("/public", async (_req, res) => {
    try {
        // Serve from cache if fresh
        if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
            return res.json(cached.payload);
        }
        // Run both queries in parallel for speed
        const [usersSnap, usageSnap] = await Promise.all([
            firebaseAdmin_1.firestore.collection("users").get(),
            firebaseAdmin_1.firestore.collection("usageMonthly").get(),
        ]);
        // Total registered users (streamers)
        const streamers = usersSnap.size;
        // Sum participant minutes from usageMonthly
        let totalMinutes = 0;
        const activeCutoffMs = Date.now() - 60 * 60 * 1000; // last 60 minutes
        let streamersActive = 0;
        usageSnap.docs.forEach((doc) => {
            const data = doc.data();
            const usage = data?.usage || data?.totals || {};
            const participantMinutes = Number(usage?.participantMinutes ?? usage?.streamMinutes ?? usage?.minutes ?? 0);
            totalMinutes += participantMinutes;
            // Consider a usageMonthly doc "active" if updated within the last hour
            const updatedAt = data?.updatedAt;
            const createdAt = data?.createdAt;
            // Firestore Timestamp has toMillis/toDate; otherwise try number/date string
            const toMs = (t) => {
                try {
                    if (!t)
                        return null;
                    if (typeof t === "number")
                        return t;
                    if (typeof t === "string")
                        return Date.parse(t) || null;
                    if (typeof t.toMillis === "function")
                        return t.toMillis();
                    if (typeof t.toDate === "function")
                        return t.toDate().getTime();
                    return null;
                }
                catch {
                    return null;
                }
            };
            const updatedMs = toMs(updatedAt) ?? toMs(createdAt);
            if (updatedMs && updatedMs >= activeCutoffMs) {
                streamersActive += 1;
            }
        });
        const hoursStreamed = Math.floor(totalMinutes / 60);
        const payload = {
            streamers,
            hoursStreamed,
            minutesStreamed: totalMinutes,
            streamersActive,
        };
        // Update cache
        cached = { payload, at: Date.now() };
        return res.json(payload);
    }
    catch (err) {
        console.error("stats/public error:", err);
        return res.status(500).json({ error: "failed_to_load_stats" });
    }
});
exports.default = router;
