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
const planLimits_1 = require("../lib/planLimits");
const effectiveEntitlements_1 = require("../lib/effectiveEntitlements");
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
        const entitlements = await (0, effectiveEntitlements_1.getEffectiveEntitlements)(uid);
        const plan = entitlements.plan;
        const planId = entitlements.planId;
        const overagesEnabled = !!userData.overagesEnabled;
        const features = plan.features;
        const limits = plan.limits;
        // 3) Usage monthly doc (source of truth)
        const monthKey = (0, usageTracker_1.getCurrentMonthKey)();
        const usageDocId = `${uid}_${monthKey}`;
        const usageRef = firebaseAdmin_1.firestore.collection("usageMonthly").doc(usageDocId);
        const usageSnap = await usageRef.get();
        // If missing, do NOT fail—return a zeroed shape so the UI is stable.
        const legacyUsage = userData.usage || {};
        const legacyHours = Number(legacyUsage.hoursStreamedThisMonth || 0);
        const legacyParticipantMinutes = Math.max(0, Math.round(legacyHours * 60));
        let usageMonthly;
        if (usageSnap.exists) {
            usageMonthly = usageSnap.data();
        }
        else {
            usageMonthly = {
                uid,
                monthKey,
                usage: {
                    participantMinutes: legacyParticipantMinutes,
                    transcodeMinutes: 0,
                    minutes: {
                        live: {
                            currentPeriod: legacyParticipantMinutes,
                            lifetime: legacyParticipantMinutes,
                        },
                        recording: {
                            currentPeriod: 0,
                            lifetime: 0,
                        },
                    },
                },
                ytd: {
                    participantMinutes: Math.max(0, Math.round(Number(legacyUsage.ytdHours || 0) * 60)),
                    transcodeMinutes: 0,
                    minutes: {
                        live: {
                            lifetime: Math.max(0, Math.round(Number(legacyUsage.ytdHours || 0) * 60)),
                        },
                        recording: {
                            lifetime: 0,
                        },
                    },
                },
                createdAt: firestore_1.Timestamp.now(),
                updatedAt: firestore_1.Timestamp.now(),
            };
            // Persist seeded doc so subsequent calls don't lose legacy hours
            await usageRef.set(usageMonthly, { merge: true });
        }
        const toNumber = (value) => {
            const num = Number(value);
            return Number.isFinite(num) ? num : 0;
        };
        const usage = usageMonthly.usage || {};
        const ytd = usageMonthly.ytd || {};
        const usageMinutes = usage.minutes || {};
        const ytdMinutes = ytd.minutes || {};
        const participantUsed = toNumber(usage.participantMinutes);
        const transcodeUsed = toNumber(usage.transcodeMinutes);
        const liveCurrent = toNumber(usageMinutes.live?.currentPeriod ?? participantUsed);
        const liveLifetime = toNumber(usageMinutes.live?.lifetime ?? ytdMinutes.live?.lifetime ?? ytd.participantMinutes);
        const recordingCurrent = toNumber(usageMinutes.recording?.currentPeriod);
        const recordingLifetime = toNumber(usageMinutes.recording?.lifetime ?? ytdMinutes.recording?.lifetime);
        const participantLimit = Number(plan.limits.monthlyMinutes || 0); // 0 = unlimited
        const transcodeLimit = Number(plan.limits.transcodeMinutes || 0); // 0 = unlimited
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
            participantMinutes: participantUsed,
            transcodeMinutes: transcodeUsed,
            usage: {
                minutes: {
                    live: {
                        currentPeriod: liveCurrent,
                        lifetime: liveLifetime,
                    },
                    recording: {
                        currentPeriod: recordingCurrent,
                        lifetime: recordingLifetime,
                    },
                },
            },
            user: {
                planId,
                overagesEnabled,
                pendingPlan: userData.pendingPlan ?? null,
            },
            plan: {
                id: planId,
                name: plan.name,
                priceMonthly: plan.priceMonthly ?? null,
                features: {
                    recording: !!features.recording,
                    rtmpMultistream: !!features.multistream,
                    overagesAllowed: !!(plan.raw?.features?.overagesAllowed),
                },
                limits: {
                    maxDestinations: (0, planLimits_1.resolveMaxDestinations)(plan.raw?.limits || limits),
                    participantMinutes: participantLimit,
                    transcodeMinutes: transcodeLimit,
                    maxGuests: Number(plan.limits.maxGuests || 0),
                },
            },
            usageMonthly: {
                id: usageDocId,
                usage: {
                    participantMinutes: participantUsed,
                    transcodeMinutes: transcodeUsed,
                    participantHours: Math.round((participantUsed / 60) * 100) / 100,
                    transcodeHours: Math.round((transcodeUsed / 60) * 100) / 100,
                    minutes: {
                        live: {
                            currentPeriod: liveCurrent,
                            lifetime: liveLifetime,
                        },
                        recording: {
                            currentPeriod: recordingCurrent,
                            lifetime: recordingLifetime,
                        },
                    },
                },
                ytd: {
                    participantMinutes: Number(ytd.participantMinutes || 0),
                    transcodeMinutes: Number(ytd.transcodeMinutes || 0),
                    minutes: {
                        live: {
                            lifetime: toNumber(ytdMinutes.live?.lifetime ?? liveLifetime),
                        },
                        recording: {
                            lifetime: toNumber(ytdMinutes.recording?.lifetime ?? recordingLifetime),
                        },
                    },
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
// Lightweight entitlements endpoint for client gating (features + limits)
router.get("/entitlements", requireAuth_1.requireAuth, async (req, res) => {
    const uid = req.user?.uid;
    if (!uid)
        return res.status(401).json({ error: "unauthorized" });
    const entitlements = await (0, effectiveEntitlements_1.getEffectiveEntitlements)(uid);
    const plan = entitlements.plan;
    const payload = {
        planId: entitlements.planId,
        planName: plan.name || entitlements.planId,
        recording: !!entitlements.features.recording,
        rtmpMultistream: !!entitlements.features.multistream,
        dualRecording: !!(plan.raw?.features?.dualRecording || plan.raw?.features?.dual_recording),
        watermark: !!(plan.raw?.features?.watermarkRecordings || plan.raw?.features?.watermark),
        maxDestinations: (0, planLimits_1.resolveMaxDestinations)(plan.raw?.limits || entitlements.limits),
        maxGuests: Number(entitlements.limits.maxGuests || 0),
        participantMinutes: Number(entitlements.limits.monthlyMinutes || 0),
        transcodeMinutes: Number(plan.limits.transcodeMinutes || 0),
    };
    console.log("[usage/entitlements] effective", { uid, planId: payload.planId, limits: payload.participantMinutes, maxDestinations: payload.maxDestinations });
    return res.json(payload);
});
exports.default = router;
