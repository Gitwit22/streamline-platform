// server/routes/usageRoutes.ts
import express from "express";
import { requireAuth } from "../middleware/requireAuth";
import { firestore } from "../firebaseAdmin";
import { getNextUsageResetDate } from "../lib/usageTracker";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import { LEGACY_UNLIMITED_COUNT, serializeEntitlements } from "../lib/entitlements";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { getCurrentStorageUsage } from "../usageHelper";
import { getStreamingUsageStatus, readOveragesEnabled } from "../lib/streamingMeter";

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
  // Read-only: this endpoint never writes or resets usage. The month window
  // is the UTC calendar month (usageMonthly/{uid}_{YYYY-MM}); it rolls over on
  // the 1st at 00:00 UTC by key change alone.
  const userSnap = await firestore.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    return { status: 404, body: { success: false, error: "user not found" } };
  }

  const status = await getStreamingUsageStatus(uid);
  const { decision, monthKey, entitlements } = status;
  const userData = status.userDoc || {};
  const usageMonthly = status.usageDoc || {};
  const planId = entitlements.planId;
  const features = entitlements.features;
  const limits = entitlements.limits; // null = unlimited, 0 = none

  const toNumber = (value: any) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };

  const usage = usageMonthly.usage || {};
  const usageMinutes = usage.minutes || {};
  const overages = usageMonthly.overages || {};
  const outputMinutes = usage.outputMinutes || {};

  // Gated monthly streaming minutes (union of output time; never multiplied by destinations).
  const streamingUsed = decision.usedMinutes;
  const streamingLimit = decision.limitMinutes; // null = unlimited (includes bonus minutes)
  const includedMinutes = limits.monthlyStreamingMinutes; // null = unlimited
  // One-time usage credits: allowance = plan + (credit consumed this month + remaining).
  const credits = status.credits;
  const bonusMinutes = credits.allowanceMinutes; // legacy field name (credit minutes in this month's allowance)
  const planUsedMinutes = includedMinutes === null ? streamingUsed : Math.min(streamingUsed, Math.max(0, includedMinutes));

  const byOutput = {
    multistream: toNumber(outputMinutes.multistream),
    instagram: toNumber(outputMinutes.instagram),
    // Months metered before the streaming meter recorded HLS under usage.hlsMinutes.
    hls: toNumber(outputMinutes.hls) + toNumber(usage.hlsMinutes),
  };
  const rtmpOutputMinutes = byOutput.multistream + byOutput.instagram;
  const destinationMinutes = toNumber(usage.destinationMinutes);
  const recordingMinutes = toNumber(usage.recordingMinutes ?? usageMinutes.recording?.currentPeriod);

  const lifetime = ((userData.usage || {}) as any).lifetime || {};

  const resetDateISO = getNextUsageResetDate().toISOString();

  // ── Storage accounting ──
  const storageUsedBytes = await getCurrentStorageUsage(uid);
  const maxStorageBytes = limits.storageBytes; // null = unlimited, 0 = none
  const GB = 1024 * 1024 * 1024;
  const storageUsedGB = Math.round((storageUsedBytes / GB) * 100) / 100;
  const storageLimitGB = maxStorageBytes === null ? null : Math.round((maxStorageBytes / GB) * 100) / 100;

  const billableOverage = toNumber(overages.streamingMinutes ?? overages.participantMinutes);

  return {
    status: 200,
    body: {
      success: true,
      uid,
      monthKey,
      resetDate: resetDateISO,
      resetTimezone: "UTC",

      // Canonical streaming meter block.
      streaming: {
        usedMinutes: streamingUsed,
        includedMinutes,
        bonusMinutes,
        // Plan allowance vs one-time credits (credits carry over month to month).
        planAllowanceMinutes: includedMinutes,
        planUsedMinutes,
        credits: {
          remainingMinutes: credits.remainingMinutes,
          consumedThisMonth: credits.consumedThisMonth,
          allowanceMinutes: credits.allowanceMinutes,
          activeCount: credits.activeCount,
        },
        limitMinutes: streamingLimit,
        unlimited: decision.unlimited,
        remainingMinutes: decision.remainingMinutes,
        overLimit: decision.overLimit,
        allowed: decision.allowed,
        overagesActive: decision.overagesActive,
        overageMinutes: billableOverage,
        rtmpOutputMinutes,
        byOutput,
        // Analytics only (duration x destinations); never gated.
        destinationMinutes,
      },
      recording: {
        minutes: recordingMinutes,
      },
      lifetime: {
        streamingMinutes: toNumber(lifetime.streamingMinutes),
        destinationMinutes: toNumber(lifetime.destinationMinutes),
        recordingMinutes: toNumber(lifetime.recordingMinutes),
      },

      // Back-compat aliases (= streaming minutes).
      participantMinutes: streamingUsed,
      transcodeMinutes: streamingUsed,

      // Storage accounting fields (bytes are source of truth, GB for display).
      // Limits: null = unlimited, 0 = no storage included.
      storageUsedBytes,
      storageLimitBytes: maxStorageBytes,
      storageUsedGB,
      storageLimitGB,
      storageUnlimited: maxStorageBytes === null,

      billing: {
        overagesEnabled: readOveragesEnabled(userData),
        pendingPlan: (userData as any).pendingPlan ?? null,
      },

      plan: {
        id: planId,
        name: entitlements.planName,
        priceMonthly: entitlements.plan.priceMonthly ?? null,
        features: {
          recording: !!features.recording,
          rtmpMultistream: !!features.multistream,
          allowsOverages: !!features.overages,
        },
        // LEGACY ENCODING (older clients): 0 = no cap. New clients read
        // `entitlements.limits` below (null = unlimited, 0 = none).
        limits: {
          maxDestinations: limits.destinations === null ? LEGACY_UNLIMITED_COUNT : limits.destinations,
          participantMinutes: streamingLimit ?? 0,
          monthlyMinutes: streamingLimit ?? 0,
          // Broadcast/transcode is no longer a separate bucket.
          transcodeMinutes: 0,
          maxSessionMinutes: limits.maxSessionMinutes ?? 0,
          maxGuests: limits.guests ?? 0,
          storageGB: storageLimitGB,
        },
      },
      entitlements: serializeEntitlements(entitlements),

      usageMonthly: {
        id: `${uid}_${monthKey}`,
        usage: {
          streamingMinutes: streamingUsed,
          destinationMinutes,
          outputMinutes: byOutput,
          recordingMinutes,
          // Legacy aliases (= streaming minutes) for older clients.
          participantMinutes: streamingUsed,
          transcodeMinutes: streamingUsed,
          hlsMinutes: byOutput.hls,
          minutes: {
            streaming: { currentPeriod: streamingUsed },
            inRoom: { currentPeriod: streamingUsed },
            live: { currentPeriod: streamingUsed },
            broadcast: { currentPeriod: streamingUsed },
            transcode: { currentPeriod: streamingUsed },
            recording: { currentPeriod: recordingMinutes },
            hls: { currentPeriod: byOutput.hls },
          },
        },
        overages: {
          streamingMinutes: billableOverage,
          participantMinutes: billableOverage,
          transcodeMinutes: 0,
          updatedAt: overages.updatedAt || null,
        },
      },

      computed: {
        isOverLimit: decision.overLimit,
        isOverParticipant: decision.overLimit,
        isOverTranscode: false,
        remaining: {
          streamingMinutes: decision.remainingMinutes, // null = unlimited
          participantMinutes: decision.remainingMinutes, // legacy alias
          transcodeMinutes: null,
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
  const f = entitlements.features; // plan AND platform switches
  const l = entitlements.limits; // null = unlimited, 0 = none

  const payload = {
    planId: entitlements.planId,
    planName: entitlements.planName,
    recording: f.recording,
    rtmpMultistream: f.multistream,
    allowsOverages: f.overages,
    dualRecording: f.dualRecording,
    watermark: f.watermark,
    canHls: entitlements.planFeatures.hls,
    // Legacy encoding (0 = no cap); prefer `entitlements` below.
    maxDestinations: l.destinations === null ? LEGACY_UNLIMITED_COUNT : l.destinations,
    maxGuests: l.guests ?? 0,
    participantMinutes: l.monthlyStreamingMinutes ?? 0,
    transcodeMinutes: 0,
    entitlements: serializeEntitlements(entitlements),
  };

  console.log("[usage/entitlements] effective", { uid, planId: payload.planId, limits: payload.participantMinutes, maxDestinations: payload.maxDestinations });

  return res.json(payload);
});

export default router;
