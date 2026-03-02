// server/usageHelper.ts
import { firestore } from "./firebaseAdmin";

/**
 * Helper to compute the billing period reset date based on user.createdAt
 */
export function computeNextResetDate(userCreatedAt: Date | string, fromDate: Date = new Date()): Date {
  const createdDate = typeof userCreatedAt === "string" ? new Date(userCreatedAt) : userCreatedAt;
  const createdDay = createdDate.getDate();

  const thisMonthReset = new Date(
    fromDate.getFullYear(),
    fromDate.getMonth(),
    createdDay
  );

  const nextMonthReset = new Date(
    fromDate.getFullYear(),
    fromDate.getMonth() + 1,
    createdDay
  );

  // If today's date is past this month's reset day, next reset is next month
  const finalReset = fromDate.getDate() >= createdDay ? nextMonthReset : thisMonthReset;
  return finalReset;
}

/**
 * Central function to add usage for a user
 * Called when: stream ends, render completes, etc.
 */
export async function addUsageForUser(
  userId: string,
  durationMinutes: number,
  options?: {
    guestCount?: number;
    description?: string;
  }
) {
  try {
    const userRef = firestore.collection("users").doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new Error(`User ${userId} not found`);
    }

    const userData = userSnap.data() as any;
    const now = new Date();
    const durationHours = durationMinutes / 60;

    // Get the user's current usage and plan (prefer canonical planId, fall back to legacy plan)
    const usage = (userData.usage || {}) as any;
    const planId = (userData.planId || userData.plan || "free") as string;

    // Get plan limits
    const planSnap = await firestore.collection("plans").doc(planId).get();
    const planData = planSnap.data() || {};
    const maxHoursPerMonth = planData.maxHoursPerMonth || 0;

    // Compute the current billing period
    const resetDate = computeNextResetDate(userData.createdAt, now);

    // Check if we need to reset this period
    let periodStart = usage.periodStart
      ? typeof usage.periodStart === "string"
        ? new Date(usage.periodStart)
        : usage.periodStart.toDate?.()
      : null;

    if (!periodStart || periodStart > now) {
      // First stream or new period
      periodStart = new Date();
      // Set period start to the beginning of this billing window
      periodStart.setDate(resetDate.getDate() - 30); // Rough start of current period
    }

    // Add to usage counters
    const hoursStreamedThisMonth = (usage.hoursStreamedThisMonth || 0) + durationHours;
    const hoursStreamedToday = (usage.hoursStreamedToday || 0) + durationHours;
    const ytdHours = (usage.ytdHours || 0) + durationHours;
    const guestCountToday = (usage.guestCountToday || 0) + (options?.guestCount || 0);

    // Check if over limit (optional warning)
    const isOverLimit = hoursStreamedThisMonth > maxHoursPerMonth;

    // Update Firestore
    await userRef.update({
      "usage.hoursStreamedThisMonth": hoursStreamedThisMonth,
      "usage.hoursStreamedToday": hoursStreamedToday,
      "usage.ytdHours": ytdHours,
      "usage.guestCountToday": guestCountToday,
      "usage.periodStart": periodStart,
      "usage.resetDate": resetDate,
      "usage.lastUsageUpdate": now,
    });

    return {
      ok: true,
      durationHours,
      hoursStreamedThisMonth,
      maxHoursPerMonth,
      isOverLimit,
      resetDate: resetDate.toISOString(),
    };
  } catch (err) {
    console.error("addUsageForUser error:", err);
    throw err;
  }
}

/**
 * Get current usage for a user
 */
export async function getUserUsage(userId: string) {
  try {
    const userRef = firestore.collection("users").doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new Error(`User ${userId} not found`);
    }

    const userData = userSnap.data() as any;
    const usage = (userData.usage || {}) as any;
    const planId = (userData.planId || userData.plan || "free") as string;

    // Get plan limits
    const planSnap = await firestore.collection("plans").doc(planId).get();
    const planData = planSnap.data() || {};
    const maxHoursPerMonth = planData.maxHoursPerMonth || 0;
    const maxGuests = planData.maxGuests || 0;
    const multistreamEnabled = !!planData.multistreamEnabled;

    // Compute reset date
    const resetDate = computeNextResetDate(userData.createdAt);

    const hoursStreamedThisMonth = usage.hoursStreamedThisMonth || 0;
    const ytdHours = usage.ytdHours || 0;

    return {
      displayName: userData.displayName || "",
      planId,
      hoursStreamedThisMonth,
      maxHoursPerMonth,
      ytdHours,
      resetDate: resetDate.toISOString(),
      maxGuests,
      multistreamEnabled,
      priceWeekly: planData.priceWeekly || 0,
      priceMonthly: planData.priceMonthly || 0,
      priceYearly: planData.priceYearly || 0,
    };
  } catch (err) {
    console.error("getUserUsage error:", err);
    throw err;
  }
}

/**
 * ✅ PROMPT #3: Check storage limits before upload
 * Loads plan limits and current usage, enforces plan-based storage caps
 */
export async function checkStorageLimit(userId: string, fileSizeBytes: number): Promise<void> {
  try {
    const userRef = firestore.collection("users").doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new Error(`User ${userId} not found`);
    }

    const userData = userSnap.data() as any;
    const planId = (userData.planId || userData.plan || "free") as string;

    // Get plan limits
    const planSnap = await firestore.collection("plans").doc(planId).get();
    const planData = planSnap.data() || {};
    const maxStorageGB = (() => {
      const editing = (planData as any).editing || {};
      const fromEditingGb = editing.maxStorageGB;
      const fromEditingBytes = editing.maxStorageBytes;
      const fromTopGb = (planData as any).maxStorageGB;
      const fromTopBytes = (planData as any).maxStorageBytes;

      if (fromEditingGb !== undefined && fromEditingGb !== null) {
        const n = Number(fromEditingGb);
        return Number.isFinite(n) ? Math.max(0, n) : 0;
      }
      if (fromEditingBytes !== undefined && fromEditingBytes !== null) {
        const n = Number(fromEditingBytes);
        return Number.isFinite(n) ? Math.max(0, Math.round(n / (1024 * 1024 * 1024))) : 0;
      }
      if (fromTopGb !== undefined && fromTopGb !== null) {
        const n = Number(fromTopGb);
        return Number.isFinite(n) ? Math.max(0, n) : 0;
      }
      if (fromTopBytes !== undefined && fromTopBytes !== null) {
        const n = Number(fromTopBytes);
        return Number.isFinite(n) ? Math.max(0, Math.round(n / (1024 * 1024 * 1024))) : 0;
      }
      return 0;
    })();

    // Get current usage
    const usage = (userData.usage || {}) as any;
    const currentStorageBytes = usage.storageUsedBytes || 0;
    const currentStorageGB = currentStorageBytes / (1024 * 1024 * 1024);

    // Calculate new total
    const newStorageGB = currentStorageGB + fileSizeBytes / (1024 * 1024 * 1024);

    // Check against limit
    if (newStorageGB > maxStorageGB) {
      throw new Error(
        `Storage limit exceeded. Current: ${currentStorageGB.toFixed(2)} GB / ${maxStorageGB} GB. ` +
        `File size: ${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB would exceed limit.`
      );
    }

    console.log(`✅ Storage check passed for ${userId}: ${newStorageGB.toFixed(2)} GB / ${maxStorageGB} GB`);
  } catch (err) {
    console.error("checkStorageLimit error:", err);
    throw err;
  }
}

/**
 * Update storage usage after successful upload
 */
export async function updateStorageUsage(userId: string, fileSizeBytes: number): Promise<void> {
  try {
    const userRef = firestore.collection("users").doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new Error(`User ${userId} not found`);
    }

    const userData = userSnap.data() as any;
    const usage = (userData.usage || {}) as any;
    const currentStorageBytes = usage.storageUsedBytes || 0;

    await userRef.update({
      "usage.storageUsedBytes": currentStorageBytes + fileSizeBytes,
      "usage.lastStorageUpdate": new Date(),
    });

    console.log(`✅ Updated storage usage for ${userId}`);
  } catch (err) {
    console.error("updateStorageUsage error:", err);
    throw err;
  }
}
