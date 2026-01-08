// server/routes/usageRoutes.ts
import express from "express";
import { requireAuth } from "../middleware/requireAuth";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../firebaseAdmin";
import { getCurrentMonthKey } from "../lib/usageTracker";

// Helper function to get the next reset date (start of next month)
function getNextResetDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
}

const router = express.Router();

async function handleUsageSummary(req: any, res: any) {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) {
      return res.status(401).json({ success: false, error: "unauthorized" });
    }

    // 1) User doc (planId + overages setting)
    const userRef = firestore.collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({ success: false, error: "user not found" });
    }

    const userData = userSnap.data() || {};
    const planId = String(userData.planId || userData.plan || "free");
    const overagesEnabled = !!userData.overagesEnabled;

    // 2) Plan doc
    const planRef = firestore.collection("plans").doc(planId);
    const planSnap = await planRef.get();

    if (!planSnap.exists) {
      return res.status(500).json({
        success: false,
        error: "plan not found",
        planId,
      });
    }

    const planData = planSnap.data() || {};
    const features = (planData.features || {}) as any;
    const limits = (planData.limits || {}) as any;

    // 3) Usage monthly doc (source of truth)
    const monthKey = getCurrentMonthKey();
    const usageDocId = `${uid}_${monthKey}`;

    const usageRef = firestore.collection("usageMonthly").doc(usageDocId);
    const usageSnap = await usageRef.get();

    // If missing, do NOT fail—return a zeroed shape so the UI is stable.
    const usageMonthly = usageSnap.exists
      ? (usageSnap.data() as any)
      : {
          uid,
          monthKey,
          usage: { participantMinutes: 0, transcodeMinutes: 0 },
          ytd: { participantMinutes: 0, transcodeMinutes: 0 },
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        };

    const usage = usageMonthly.usage || {};
    const ytd = usageMonthly.ytd || {};

    const participantUsed = Number(usage.participantMinutes || 0);
    const transcodeUsed = Number(usage.transcodeMinutes || 0);

    const participantLimit = Number(limits.participantMinutes || 0); // 0 = unlimited
    const transcodeLimit = Number(limits.transcodeMinutes || 0);     // 0 = unlimited

    const isOverParticipant =
      participantLimit > 0 ? participantUsed >= participantLimit : false;

    const isOverTranscode =
      transcodeLimit > 0 ? transcodeUsed >= transcodeLimit : false;

    const isOverLimit = isOverParticipant || isOverTranscode;

    const remainingParticipantMinutes =
      participantLimit > 0 ? Math.max(0, participantLimit - participantUsed) : null;

    const remainingTranscodeMinutes =
      transcodeLimit > 0 ? Math.max(0, transcodeLimit - transcodeUsed) : null;

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
          transcodeMinutes: remainingTranscodeMinutes,     // null = unlimited
        },
      },
    });
  } catch (err: any) {
    console.error("❌ /api/usage/summary error:", err);
    return res.status(500).json({
      success: false,
      error: "internal_error",
      details: err?.message || String(err),
    });
  }
}
// Expose both endpoints with the same stable payload
router.get("/summary", requireAuth, handleUsageSummary);
router.get("/me", requireAuth, handleUsageSummary);
export default router;
