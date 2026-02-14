// server/routes/usageRoutes.ts
import express from "express";
import { requireAuth } from "../middleware/requireAuth";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../firebaseAdmin";
import { getCurrentMonthKey } from "../lib/usageTracker";
import { resolveMaxDestinations } from "../lib/planLimits";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

// Helper function to get the next reset date (start of next month)
function getNextResetDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
}

const router = express.Router();

const USAGE_SUMMARY_VERSION = "v1";
const setUsageSummaryVersionHeader = (req: any, res: any, next: any) => {
  res.setHeader("x-sl-usage-summary-version", USAGE_SUMMARY_VERSION);
  next();
};

export type UsageSummaryResult = {
  status: number;
  body: any;
};

export async function computeUsageSummaryResult(uid: string): Promise<UsageSummaryResult> {
  // 1) User doc (planId + overages setting)
  const userRef = firestore.collection("users").doc(uid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    // Not a limit error, leave as is
    return { status: 404, body: { success: false, error: "user not found" } };
  }

  const userData = userSnap.data() || {};
  const entitlements = await getEffectiveEntitlements(uid);
  const plan = entitlements.plan;
  const planId = entitlements.planId;
  const overagesEnabled =
    (userData as any)?.billingSettings?.overagesEnabled === true ||
    (userData as any)?.billing?.overagesEnabled === true ||
    (userData as any)?.overagesEnabled === true;

  const features = plan.features;
  const limits = plan.limits as any;

  // 3) Usage monthly doc (source of truth)
  const monthKey = getCurrentMonthKey();
  const usageDocId = `${uid}_${monthKey}`;

  const usageRef = firestore.collection("usageMonthly").doc(usageDocId);
  const usageSnap = await usageRef.get();

  // If missing, do NOT fail—return a zeroed shape so the UI is stable.
  const legacyUsage = userData.usage || {};
  const legacyHours = Number(legacyUsage.hoursStreamedThisMonth || 0);
  const legacyParticipantMinutes = Math.max(0, Math.round(legacyHours * 60));

  let usageMonthly: any;
  if (usageSnap.exists) {
    usageMonthly = usageSnap.data() as any;
  } else {
    const legacyYtdMinutes = Math.max(0, Math.round(Number(legacyUsage.ytdHours || 0) * 60));
    usageMonthly = {
      uid,
      monthKey,
      usage: {
        participantMinutes: legacyParticipantMinutes,
        transcodeMinutes: 0,
        hlsMinutes: 0,
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
        participantMinutes: legacyYtdMinutes,
        transcodeMinutes: 0,
        hlsMinutes: 0,
        minutes: {
          live: {
            lifetime: legacyYtdMinutes,
          },
          recording: {
            lifetime: 0,
          },
        },
      },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    // Persist seeded doc so subsequent calls don't lose legacy hours
    await usageRef.set(usageMonthly, { merge: true });
  }

  const toNumber = (value: any) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };

  const usage = usageMonthly.usage || {};
  const ytd = usageMonthly.ytd || {};
  const usageMinutes = usage.minutes || {};
  const ytdMinutes = ytd.minutes || {};
  const overages = usageMonthly.overages || {};

  const participantUsed = toNumber(usage.participantMinutes);
  const transcodeUsed = toNumber(usage.transcodeMinutes);

  const hlsCurrent = toNumber(usage.hlsMinutes);
  const hlsLifetime = toNumber(ytd.hlsMinutes);

  const liveCurrentBase = toNumber(usageMinutes.live?.currentPeriod ?? participantUsed);
  const liveLifetimeBase = toNumber(
    usageMinutes.live?.lifetime ?? ytdMinutes.live?.lifetime ?? ytd.participantMinutes
  );

  const liveCurrent = liveCurrentBase + hlsCurrent;
  const liveLifetime = liveLifetimeBase + hlsLifetime;
  const recordingCurrent = toNumber(usageMinutes.recording?.currentPeriod);
  const recordingLifetime = toNumber(
    usageMinutes.recording?.lifetime ?? ytdMinutes.recording?.lifetime
  );

  const transcodeCurrent = toNumber(usageMinutes.transcode?.currentPeriod ?? usage.transcodeMinutes);
  const transcodeLifetime = toNumber(ytdMinutes.transcode?.lifetime ?? ytd.transcodeMinutes);

  // Canonical aliases (match /api/account/me)
  const inRoomCurrent = liveCurrentBase;
  const inRoomLifetime = liveLifetimeBase;
  const broadcastCurrent = transcodeCurrent;
  const broadcastLifetime = transcodeLifetime;

  const participantLimit = Number(plan.limits.monthlyMinutes || 0); // 0 = unlimited
  const transcodeLimit = Number(plan.limits.transcodeMinutes || 0); // 0 = unlimited

  const isOverParticipant = participantLimit > 0 ? participantUsed >= participantLimit : false;
  const isOverTranscode = transcodeLimit > 0 ? transcodeUsed >= transcodeLimit : false;
  const isOverLimit = isOverParticipant || isOverTranscode;

  const remainingParticipantMinutes =
    participantLimit > 0 ? Math.max(0, participantLimit - participantUsed) : null;

  const remainingTranscodeMinutes =
    transcodeLimit > 0 ? Math.max(0, transcodeLimit - transcodeUsed) : null;

  const resetDateISO = getNextResetDate().toISOString();

  return {
    status: 200,
    body: {
      success: true,
      uid,
      monthKey,
      resetDate: resetDateISO,
      participantMinutes: participantUsed,
      transcodeMinutes: transcodeUsed,

      billing: {
        overagesEnabled,
        pendingPlan: (userData as any).pendingPlan ?? null,
      },

      plan: {
        id: planId,
        name: plan.name,
        priceMonthly: (plan as any).priceMonthly ?? null,
        features: {
          recording: !!features.recording,
          rtmpMultistream: !!features.multistream,
          allowsOverages: !!(features as any).allowsOverages,
        },
        limits: {
          maxDestinations: resolveMaxDestinations(plan.raw?.limits || limits),
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
          hlsMinutes: hlsCurrent,
          participantHours: Math.round((participantUsed / 60) * 100) / 100,
          transcodeHours: Math.round((transcodeUsed / 60) * 100) / 100,
          minutes: {
            live: {
              currentPeriod: liveCurrent,
              lifetime: liveLifetime,
            },
            // Bucketed transcode minutes (broadcast/egress)
            transcode: {
              currentPeriod: transcodeCurrent,
              lifetime: transcodeLifetime,
            },
            // Canonical aliases
            inRoom: {
              currentPeriod: inRoomCurrent,
              lifetime: inRoomLifetime,
            },
            broadcast: {
              currentPeriod: broadcastCurrent,
              lifetime: broadcastLifetime,
            },
            recording: {
              currentPeriod: recordingCurrent,
              lifetime: recordingLifetime,
            },
            hls: {
              currentPeriod: hlsCurrent,
              lifetime: hlsLifetime,
            },
          },
        },
        ytd: {
          participantMinutes: Number(ytd.participantMinutes || 0),
          transcodeMinutes: Number(ytd.transcodeMinutes || 0),
          hlsMinutes: Number(ytd.hlsMinutes || 0),
          minutes: {
            live: {
              lifetime: toNumber(ytdMinutes.live?.lifetime ?? liveLifetime),
            },
            transcode: {
              lifetime: transcodeLifetime,
            },
            inRoom: {
              lifetime: inRoomLifetime,
            },
            broadcast: {
              lifetime: broadcastLifetime,
            },
            recording: {
              lifetime: toNumber(ytdMinutes.recording?.lifetime ?? recordingLifetime),
            },
            hls: {
              lifetime: hlsLifetime,
            },
          },
        },

        // Logged overage totals (Pro-only behavior). These are totals for the month.
        // When missing, treat as 0 for display.
        overages: {
          participantMinutes: toNumber(overages.participantMinutes),
          transcodeMinutes: toNumber(overages.transcodeMinutes),
          updatedAt: overages.updatedAt || null,
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
    },
  };
}

async function handleUsageSummary(req: any, res: any) {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) {
      return res.status(401).json({ success: false, error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    const result = await computeUsageSummaryResult(uid);
    return res.status(result.status).json(result.body);
  } catch (error: any) {
    console.error("Error in usage summary:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch usage summary" });
  }
}
// Expose both endpoints with the same stable payload
router.get("/summary", setUsageSummaryVersionHeader, requireAuth, handleUsageSummary);
router.get("/me", setUsageSummaryVersionHeader, requireAuth, handleUsageSummary);

// Lightweight entitlements endpoint for client gating (features + limits)
router.get("/entitlements", requireAuth, async (req, res) => {
  const uid = (req as any).user?.uid;
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  const entitlements = await getEffectiveEntitlements(uid);
  const plan = entitlements.plan;

   // Global recording feature flag: when disabled, recording should be treated
   // as unavailable even if the plan normally includes it. Default to enabled
   // if the flag doc is missing so plans behave as defined out of the box.
   let recordingEnabledFlag = true;
   try {
     const snap = await firestore.collection("featureFlags").doc("recording").get();
     const data = snap.exists ? (snap.data() as any) || {} : {};
     recordingEnabledFlag = data.enabled === undefined ? true : !!data.enabled;
   } catch {
     recordingEnabledFlag = true;
   }

  const payload = {
    planId: entitlements.planId,
    planName: plan.name || entitlements.planId,
    recording: !!entitlements.features.recording && recordingEnabledFlag,
    rtmpMultistream: !!entitlements.features.multistream,
    allowsOverages: !!(entitlements.features as any).allowsOverages,
    dualRecording: !!(plan.raw?.features?.dualRecording || plan.raw?.features?.dual_recording),
    watermark: !!(plan.raw?.features?.watermarkRecordings || plan.raw?.features?.watermark),
    canHls: !!((entitlements.features as any).canHls || plan.raw?.features?.canHls || plan.raw?.features?.hls || plan.raw?.features?.hlsBroadcast),
    maxDestinations: resolveMaxDestinations(plan.raw?.limits || entitlements.limits),
    maxGuests: Number(entitlements.limits.maxGuests || 0),
    participantMinutes: Number(entitlements.limits.monthlyMinutes || 0),
    transcodeMinutes: Number(plan.limits.transcodeMinutes || 0),
  };

  console.log("[usage/entitlements] effective", { uid, planId: payload.planId, limits: payload.participantMinutes, maxDestinations: payload.maxDestinations });

  return res.json(payload);
});

export default router;
