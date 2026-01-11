import { firestore as db } from "../firebaseAdmin";
import { PlanId, isPlanId } from "../types/plan";

export interface UserAccount {
  uid: string;
  planId: PlanId;
  /** Per-user billing toggle (tri-state, defaults to true when missing). */
  billingEnabled: boolean;
  /** Platform-wide billing system toggle loaded from config/features (defaults to true). */
  platformBillingEnabled: boolean;
  /** Effective flag used for Stripe / billing operations = platform && user. */
  effectiveBillingEnabled: boolean;
  isAdmin: boolean;
  rawUser: any;
}

const USERS_COLLECTION = "users";
const CONFIG_COLLECTION = "config";
const FEATURES_DOC_ID = "features";

// Small in-memory cache for the platform billing flag to avoid hammering Firestore.
// TTL is intentionally short so admin toggles propagate quickly across instances.
let cachedPlatformBillingEnabled: boolean | null = null;
let cachedPlatformBillingEnabledAt = 0;
const PLATFORM_BILLING_TTL_MS = 30 * 1000; // ~30 seconds

async function getPlatformBillingEnabled(): Promise<boolean> {
  const now = Date.now();
  if (
    cachedPlatformBillingEnabled !== null &&
    now - cachedPlatformBillingEnabledAt < PLATFORM_BILLING_TTL_MS
  ) {
    return cachedPlatformBillingEnabled;
  }

  try {
    const snap = await db.collection(CONFIG_COLLECTION).doc(FEATURES_DOC_ID).get();
    const data = snap.exists ? snap.data() || {} : {};
    if (typeof (data as any).billingSystemEnabled === "boolean") {
      cachedPlatformBillingEnabled = (data as any).billingSystemEnabled;
      cachedPlatformBillingEnabledAt = now;
      return cachedPlatformBillingEnabled;
    }
  } catch (err) {
    console.error("getPlatformBillingEnabled failed:", err);
  }

  // Safe default: billing system is enabled when flag is missing or on error.
  cachedPlatformBillingEnabled = true;
  cachedPlatformBillingEnabledAt = now;
  return cachedPlatformBillingEnabled;
}

export function invalidatePlatformBillingCache() {
  cachedPlatformBillingEnabled = null;
  cachedPlatformBillingEnabledAt = 0;
}

/**
 * Normalize user account document for auth/billing usage.
 * - Auto-creates a minimal doc when missing so callers never see 404.
 * - Treats billingEnabled as tri-state during migration:
 *   missing => true (live), false => test mode, true => live.
 * - Normalizes planId to a valid PlanId, defaulting to "free".
 */
export async function getUserAccount(uid: string): Promise<UserAccount> {
  const userRef = db.collection(USERS_COLLECTION).doc(uid);
  const snap = await userRef.get();
  const now = Date.now();

  if (!snap.exists) {
    const baseDoc = {
      planId: "free" as PlanId,
      billingEnabled: true,
      isAdmin: false,
      createdAt: now,
      updatedAt: now,
    };

    await userRef.set(baseDoc, { merge: true });

    const platformBillingEnabled = await getPlatformBillingEnabled();
    const effectiveBillingEnabled = platformBillingEnabled && baseDoc.billingEnabled;

    const mergedRaw = {
      ...baseDoc,
      platformBillingEnabled,
      effectiveBillingEnabled,
    };

    return {
      uid,
      planId: baseDoc.planId,
      billingEnabled: baseDoc.billingEnabled,
      platformBillingEnabled,
      effectiveBillingEnabled,
      isAdmin: baseDoc.isAdmin,
      rawUser: mergedRaw,
    };
  }

  const data = snap.data() || {};

  // Plan normalization: default to free and coerce to a known PlanId when possible.
  let planId: PlanId = "free";
  if (typeof data.planId === "string" && isPlanId(data.planId)) {
    planId = data.planId as PlanId;
  }

  // billingEnabled tri-state: missing => true (live), explicit false => test mode.
  let billingEnabled = true;
  if (data.billingEnabled === false) billingEnabled = false;
  else if (data.billingEnabled === true) billingEnabled = true;

  const isAdmin = !!data.isAdmin;

  const platformBillingEnabled = await getPlatformBillingEnabled();
  const effectiveBillingEnabled = platformBillingEnabled && billingEnabled;

  const mergedRaw = {
    ...data,
    planId,
    billingEnabled,
    platformBillingEnabled,
    effectiveBillingEnabled,
    isAdmin,
  };

  // Backfill createdAt/updatedAt minimally without overwriting other fields.
  const patch: any = {};
  if (!data.createdAt) patch.createdAt = now;
  patch.updatedAt = now;
  if (Object.keys(patch).length > 0) {
    await userRef.set(patch, { merge: true });
  }

  return {
    uid,
    planId,
    billingEnabled,
    platformBillingEnabled,
    effectiveBillingEnabled,
    isAdmin,
    rawUser: mergedRaw,
  };
}
