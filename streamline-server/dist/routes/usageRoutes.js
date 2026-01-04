"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// server/routes/usageRoutes.ts
const express_1 = __importDefault(require("express"));
const requireAuth_1 = require("../middleware/requireAuth");
const firestore_1 = require("firebase-admin/firestore");
const firebaseAdmin_1 = require("../firebaseAdmin");
const usageTracker_1 = require("../lib/usageTracker");
// Helper function to get the next reset date (start of next month)
function getNextResetDate() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
}
const router = express_1.default.Router();
async function handleUsageSummary(req, res) {
    try {
        const uid = req.user?.uid;
        if (!uid) {
            return res.status(401).json({ success: false, error: "unauthorized" });
        }
        // 1) User doc (planId + overages setting)
        const userRef = firebaseAdmin_1.firestore.collection("users").doc(uid);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
            return res.status(404).json({ success: false, error: "user not found" });
        }
        const userData = userSnap.data() || {};
        const planId = String(userData.planId || userData.plan || "free");
        const overagesEnabled = !!userData.overagesEnabled;
        // 2) Plan doc
        const planRef = firebaseAdmin_1.firestore.collection("plans").doc(planId);
        const planSnap = await planRef.get();
        if (!planSnap.exists) {
            return res.status(500).json({
                success: false,
                error: "plan not found",
                planId,
            });
        }
        const planData = planSnap.data() || {};
        const features = (planData.features || {});
        const limits = (planData.limits || {});
        // 3) Usage monthly doc (source of truth)
        const monthKey = (0, usageTracker_1.getCurrentMonthKey)();
        const usageDocId = `${uid}_${monthKey}`;
        const usageRef = firebaseAdmin_1.firestore.collection("usageMonthly").doc(usageDocId);
        const usageSnap = await usageRef.get();
        // If missing, do NOT fail—return a zeroed shape so the UI is stable.
        const usageMonthly = usageSnap.exists
            ? usageSnap.data()
            : {
                uid,
                monthKey,
                usage: { participantMinutes: 0, transcodeMinutes: 0 },
                ytd: { participantMinutes: 0, transcodeMinutes: 0 },
                createdAt: firestore_1.Timestamp.now(),
                updatedAt: firestore_1.Timestamp.now(),
            };
        const usage = usageMonthly.usage || {};
        const ytd = usageMonthly.ytd || {};
        const participantUsed = Number(usage.participantMinutes || 0);
        const transcodeUsed = Number(usage.transcodeMinutes || 0);
        const participantLimit = Number(limits.participantMinutes || 0); // 0 = unlimited
        const transcodeLimit = Number(limits.transcodeMinutes || 0); // 0 = unlimited
        const isOverParticipant = participantLimit > 0 ? participantUsed >= participantLimit : false;
        const isOverTranscode = transcodeLimit > 0 ? transcodeUsed >= transcodeLimit : false;
        const isOverLimit = isOverParticipant || isOverTranscode;
        const remainingParticipantMinutes = participantLimit > 0 ? Math.max(0, participantLimit - participantUsed) : null;
        const remainingTranscodeMinutes = transcodeLimit > 0 ? Math.max(0, transcodeLimit - transcodeUsed) : null;
        const resetDateISO = getNextResetDate().toISOString();
        return res.json({
            success: true,
            uid,
            monthKey,
            resetDate: resetDateISO,
            user: {
                planId,
                overagesEnabled,
                pendingPlan: userData.pendingPlan ?? null,
            },
            plan: {
                id: planId,
                name: planData.name || planId,
                priceMonthly: planData.priceMonthly ?? null,
                features: {
                    recording: !!features.recording,
                    rtmpMultistream: !!features.rtmpMultistream || !!features.rtmp || !!planData.multistreamEnabled,
                    overagesAllowed: !!features.overagesAllowed,
                },
                limits: {
                    maxDestinations: Number(limits.maxDestinations || 0),
                    participantMinutes: participantLimit,
                    transcodeMinutes: transcodeLimit,
                    maxGuests: Number(limits.maxGuests || (planId === "pro" ? 10 : planId === "starter" ? 2 : 1)),
                },
            },
            usageMonthly: {
                id: usageDocId,
                usage: {
                    participantMinutes: participantUsed,
                    transcodeMinutes: transcodeUsed,
                    participantHours: Math.round((participantUsed / 60) * 100) / 100,
                    transcodeHours: Math.round((transcodeUsed / 60) * 100) / 100,
                },
                ytd: {
                    participantMinutes: Number(ytd.participantMinutes || 0),
                    transcodeMinutes: Number(ytd.transcodeMinutes || 0),
                },
            },
            computed: {
                isOverLimit,
                isOverParticipant,
                isOverTranscode,
                remaining: {
                    participantMinutes: remainingParticipantMinutes, // null = unlimited
                    transcodeMinutes: remainingTranscodeMinutes, // null = unlimited
                },
            },
        });
    }
    catch (err) {
        console.error("❌ /api/usage/summary error:", err);
        return res.status(500).json({
            success: false,
            error: "internal_error",
            details: err?.message || String(err),
        });
    }
}
// Expose both endpoints with the same stable payload
router.get("/summary", requireAuth_1.requireAuth, handleUsageSummary);
router.get("/me", requireAuth_1.requireAuth, handleUsageSummary);
exports.default = router;
