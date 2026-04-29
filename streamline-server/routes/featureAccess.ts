import { firestore as db } from "../firebaseAdmin";
import { resolveMaxDestinations } from "../lib/planLimits";
import { getUserAccount, UserAccount } from "../lib/userAccount";

type AccessResult = {
  allowed: boolean;
  code?: string;
  reason?: string;
  _diag?: Record<string, any>;
};

const BAD_BILLING_STATUSES = new Set([
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "canceled",
]);

import { PLAN_IDS, PlanId, isPlanId } from "../types/plan";
import { LIMIT_ERRORS } from "../lib/limitErrors";

// List of paid plans (update as needed, or drive from plan config)
const PAID_PLANS: PlanId[] = [
  "starter",
  "pro",
  "basic",
  "enterprise",
  // Add any other paid plans here
];

function isPaidPlan(planId?: string): boolean {
  if (!planId) return false;
  // Accept legacy or variant ids (e.g., "starter_paid")
  let canonical: string = String(planId).toLowerCase();
  if (canonical.endsWith("_paid") || canonical.endsWith("_trial")) {
    canonical = canonical.replace(/_(paid|trial)$/i, "");
  }
  return PAID_PLANS.includes(canonical as PlanId) || canonical === "internal_unlimited";
}

function billingBlocks(user: any): string | null {
  const planId = user?.planId;
  const billingStatus = user?.billingStatus;
  const billingActive = user?.billingActive;


  // Admin override bypasses all billing blocks
  if (user?.adminOverride) {
    return null;
  }

  if (!isPaidPlan(planId)) {
    return null; // free users don’t need billing
  }

  // Missing subscription is a hard block
  const subscriptionId =
    user?.stripeSubscriptionId || user?.billing?.subscriptionId;
  if (!subscriptionId) {
    return "Missing subscription";
  }

  if (billingActive === false) {
    return "Billing inactive";
  }

  if (billingStatus && BAD_BILLING_STATUSES.has(String(billingStatus))) {
    return `Billing ${billingStatus}`;
  }

  // Paid plan but no billing status is suspicious → block
  if (!billingStatus) {
    return "Missing billing status";
  }

  return null; // billing OK
}

export async function canAccessFeature(
  uidOrAccount: string | UserAccount,
  featureKey: string
): Promise<AccessResult> {
  // 1) Load normalized account + user snapshot (from cache when available)
  const account =
    typeof uidOrAccount === "string"
      ? await getUserAccount(uidOrAccount)
      : uidOrAccount;

  const uid = account.uid;
  const user = account.rawUser || {};
  const planId = user?.planId || account.planId || "free";

  // 0) Platform-wide feature gates (default enabled when missing)
  // These should hard-disable the feature for everyone (including admins) when off.
  if (featureKey === "recording" || featureKey === "hls") {
    const platformEnabled = await getPlatformFeatureEnabled(featureKey);
    if (!platformEnabled) {
      return {
        allowed: false,
        code: LIMIT_ERRORS.FEATURE_DISABLED,
        reason: "Feature disabled platform-wide",
        _diag: { uid, planId, feature: featureKey, failedAt: "platform_gate" },
      };
    }
  }

  // Monetization / Pay-Per-View platform gates (default DISABLED when missing)
  if (featureKey === "monetization" || featureKey === "payPerView") {
    const platformEnabled = await getPlatformMonetizationFlag(featureKey);
    if (!platformEnabled) {
      const label = featureKey === "monetization" ? "Monetization" : "Pay-per-view";
      return {
        allowed: false,
        code: LIMIT_ERRORS.FEATURE_DISABLED,
        reason: `${label} is not enabled on this platform`,
        _diag: { uid, planId, feature: featureKey, failedAt: "platform_gate" },
      };
    }
  }
  if (process.env.DEBUG_FEATURE_ACCESS === "1") {
    console.log(
      `[featureAccess] uid=${uid} feature=${featureKey} planId=${planId} adminOverride=${!!user?.adminOverride}`
    );
  }

  // Admin override grants access to all features
  // Source 1: flag on user doc
  if (user?.adminOverride) {
    return { allowed: true };
  }
  // Source 1b: per-feature admin override for HLS only
  if (featureKey === "hls" && user?.adminOverrideHls) {
    return { allowed: true };
  }
  // Source 2: membership in /admins collection
  try {
    const adminSnap = await db.collection("admins").doc(uid).get();
    const isAdmin = adminSnap.exists && adminSnap.data()?.isAdmin === true;
    if (process.env.DEBUG_FEATURE_ACCESS === "1") {
      console.log(`[featureAccess] admin collection isAdmin=${isAdmin}`);
    }
    if (isAdmin) {
      return { allowed: true };
    }
  } catch {}

  // Internal unlimited plan unlocks all features
  if (String(planId).toLowerCase() === "internal_unlimited") {
    return { allowed: true };
  }

  // 2) STRICT BILLING BLOCK (RESPECTS PLATFORM BILLING FLAG)
  // When the platform billing flag disables billing (effectiveBillingEnabled === false),
  // we bypass billing-based feature blocks so Test Mode users on paid plans can
  // still access features like streaming/recording without a live subscription.
  if (account.effectiveBillingEnabled !== false) {
    const billingBlockReason = billingBlocks(user);
    if (billingBlockReason) {
      return {
        allowed: false,
        code: LIMIT_ERRORS.FEATURE_NOT_ENTITLED,
        reason: `Billing issue: ${billingBlockReason}`,
        _diag: { uid, planId, feature: featureKey, failedAt: "billing_block", billingBlockReason, effectiveBillingEnabled: account.effectiveBillingEnabled, billingStatus: user?.billingStatus, billingActive: user?.billingActive, subscriptionId: !!(user?.stripeSubscriptionId || user?.billing?.subscriptionId) },
      };
    }
  }

  // 3) Load plan
  const planSnap = await db.collection("plans").doc(planId).get();
  if (!planSnap.exists) {
    return { allowed: false, code: LIMIT_ERRORS.FEATURE_NOT_ENTITLED, reason: "Plan not found", _diag: { uid, planId, feature: featureKey, failedAt: "plan_not_found", rawPlanId: user?.planId, accountPlanId: account.planId } };
  }

  const plan = planSnap.data() as any;

  // 4) Feature flag / limits check
  let enabled = Boolean(plan?.features?.[featureKey]);
  if (process.env.DEBUG_FEATURE_ACCESS === "1") {
    console.log(
      `[featureAccess] initial flag check features.${featureKey}=${plan?.features?.[featureKey]} multistreamEnabled=${plan?.multistreamEnabled}`
    );
  }

  if (!enabled) {
    if (featureKey === "multistream") {
      // Primary: numeric cap on RTMP destinations. This makes
      // rtmpDestinationsMax/maxDestinations the source of truth for
      // whether Stream Destinations are available at all.
      const limits = (plan?.limits || {}) as any;
      const maxDestinations = resolveMaxDestinations(limits);
      enabled = maxDestinations > 0;

      // Legacy fallback: if limits are missing but old feature flags
      // are present, still honor them so existing plans keep working.
      if (!enabled) {
        enabled = Boolean(
          plan?.features?.multistream ||
          plan?.features?.rtmp ||
          plan?.features?.rtmpMultistream ||
          plan?.multistreamEnabled
        );
      }
      if (process.env.DEBUG_FEATURE_ACCESS === "1") {
        console.log(
          `[featureAccess] alias check result enabled=${enabled} via multistream|rtmp|rtmpMultistream|multistreamEnabled`
        );
      }
    } else if (featureKey === "hls") {
      enabled = Boolean(
        plan?.features?.hls ||
        plan?.features?.canHls ||
        plan?.features?.hlsBroadcast ||
        plan?.hlsEnabled ||
        plan?.hlsBroadcastEnabled ||
        plan?.canHls ||
        // Legacy shape: plan.hls is an object
        plan?.hls?.enabled
      );
      if (process.env.DEBUG_FEATURE_ACCESS === "1") {
        console.log(
          `[featureAccess] alias check result enabled=${enabled} via hls|canHls|hlsBroadcast`
        );
      }
    } else if (featureKey === "monetization") {
      enabled = Boolean(
        plan?.features?.monetization ||
        plan?.monetizationEnabled ||
        plan?.monetization
      );
    } else if (featureKey === "payPerView") {
      enabled = Boolean(
        plan?.features?.payPerView ||
        plan?.features?.ppv ||
        plan?.payPerViewEnabled ||
        plan?.ppvEnabled
      );
    }
  }

  if (!enabled) {
    return {
      allowed: false,
      code: LIMIT_ERRORS.FEATURE_NOT_ENTITLED,
      reason: "Feature not available on your plan",
      _diag: { uid, planId, feature: featureKey, failedAt: "feature_flag", featureValue: plan?.features?.[featureKey] },
    };
  }

  return { allowed: true };
}

// Small in-memory cache for platform feature flags to avoid hammering Firestore.
// TTL is short so admin toggles propagate quickly.
let cachedRecordingEnabled: boolean | null = null;
let cachedRecordingEnabledAt = 0;
let cachedHlsEnabled: boolean | null = null;
let cachedHlsEnabledAt = 0;

// Monetization platform flags — default DISABLED (opt-in)
let cachedMonetizationEnabled: boolean | null = null;
let cachedMonetizationEnabledAt = 0;
let cachedPayPerViewEnabled: boolean | null = null;
let cachedPayPerViewEnabledAt = 0;

const PLATFORM_FEATURE_TTL_MS = 30 * 1000;

async function getPlatformFeatureEnabled(featureKey: "recording" | "hls"): Promise<boolean> {
  const now = Date.now();

  if (featureKey === "recording") {
    if (cachedRecordingEnabled !== null && now - cachedRecordingEnabledAt < PLATFORM_FEATURE_TTL_MS) {
      return cachedRecordingEnabled;
    }
    try {
      const snap = await db.collection("featureFlags").doc("recording").get();
      const data = snap.exists ? snap.data() || {} : {};
      const enabled = (data as any).enabled;
      cachedRecordingEnabled = enabled === undefined ? true : !!enabled;
      cachedRecordingEnabledAt = now;
      return cachedRecordingEnabled;
    } catch {
      cachedRecordingEnabled = true;
      cachedRecordingEnabledAt = now;
      return cachedRecordingEnabled;
    }
  }

  // HLS: doc is historically named hlsSettingsTab, but we treat it as the canonical platform HLS toggle.
  if (cachedHlsEnabled !== null && now - cachedHlsEnabledAt < PLATFORM_FEATURE_TTL_MS) {
    return cachedHlsEnabled;
  }
  try {
    const snap = await db.collection("featureFlags").doc("hlsSettingsTab").get();
    const data = snap.exists ? snap.data() || {} : {};
    const hlsEnabled = (data as any).hlsEnabled;
    const enabled = (data as any).enabled;
    // Default enabled when missing.
    if (typeof hlsEnabled === "boolean") cachedHlsEnabled = hlsEnabled;
    else if (typeof enabled === "boolean") cachedHlsEnabled = enabled;
    else cachedHlsEnabled = true;
    cachedHlsEnabledAt = now;
    return cachedHlsEnabled;
  } catch {
    cachedHlsEnabled = true;
    cachedHlsEnabledAt = now;
    return cachedHlsEnabled;
  }
}

/**
 * Platform-level monetization flags — default DISABLED when missing.
 * Firestore docs: featureFlags/monetizationEnabled, featureFlags/payPerViewEnabled
 */
export async function getPlatformMonetizationFlag(
  key: "monetization" | "payPerView"
): Promise<boolean> {
  const now = Date.now();
  const docId = key === "monetization" ? "monetizationEnabled" : "payPerViewEnabled";

  if (key === "monetization") {
    if (cachedMonetizationEnabled !== null && now - cachedMonetizationEnabledAt < PLATFORM_FEATURE_TTL_MS) {
      return cachedMonetizationEnabled;
    }
    try {
      const snap = await db.collection("featureFlags").doc(docId).get();
      const data = snap.exists ? snap.data() || {} : {};
      cachedMonetizationEnabled = (data as any).enabled === true;
      cachedMonetizationEnabledAt = now;
      return cachedMonetizationEnabled;
    } catch {
      cachedMonetizationEnabled = false;
      cachedMonetizationEnabledAt = now;
      return false;
    }
  }

  // payPerView
  if (cachedPayPerViewEnabled !== null && now - cachedPayPerViewEnabledAt < PLATFORM_FEATURE_TTL_MS) {
    return cachedPayPerViewEnabled;
  }
  try {
    const snap = await db.collection("featureFlags").doc(docId).get();
    const data = snap.exists ? snap.data() || {} : {};
    cachedPayPerViewEnabled = (data as any).enabled === true;
    cachedPayPerViewEnabledAt = now;
    return cachedPayPerViewEnabled;
  } catch {
    cachedPayPerViewEnabled = false;
    cachedPayPerViewEnabledAt = now;
    return false;
  }
}
