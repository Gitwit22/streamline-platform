// server/usageHelper.ts
//
// Storage accounting lifecycle:
//   1. reserveStorageIfAvailable / reserveStorageUsage — called when bytes are
//      about to be or have been committed to R2.  reserveStorageIfAvailable is
//      the preferred path: it atomically checks the plan limit and increments
//      the counter inside a single Firestore transaction, closing the race
//      window that existed with the old check-then-increment two-step.
//   2. releaseStorageUsage / decrement — called when bytes are actually removed
//      from R2 (deletes, maintenance purges).
//   3. A future reconciliation tool can recompute storageUsedBytes from ground
//      truth (R2 + Firestore collections), but runtime paths must be correct.
//
// All counter mutations use FieldValue.increment() for atomicity. The counter
// is floored at zero after decrements to prevent negative drift.

import { firestore } from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { computeNextResetDate, resolveMaxStorageBytesFromPlan, canReserveStorage } from "./lib/storagePure";
import type { ReservationCheck } from "./lib/storagePure";

// Re-export pure helpers so callers can import from one place
export { computeNextResetDate, resolveMaxStorageBytesFromPlan, canReserveStorage } from "./lib/storagePure";
export type { ReservationCheck } from "./lib/storagePure";

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
 * Uses FieldValue.increment() for atomic, race-safe counter updates.
 */
export async function updateStorageUsage(userId: string, fileSizeBytes: number): Promise<void> {
  await reserveStorageUsage(userId, fileSizeBytes, { caller: "updateStorageUsage" });
}

// ─── Atomic Storage Accounting Layer ─────────────────────────────────────────

/**
 * Apply an atomic delta (positive or negative) to usage.storageUsedBytes.
 * Uses FieldValue.increment() so concurrent callers never lose updates.
 * After a negative delta, floors the counter at zero to prevent drift below 0.
 */
export async function applyStorageUsageDelta(
  userId: string,
  deltaBytes: number,
  context?: Record<string, any>,
): Promise<void> {
  if (!userId) throw new Error("applyStorageUsageDelta: userId is required");
  if (!Number.isFinite(deltaBytes) || deltaBytes === 0) return;

  const userRef = firestore.collection("users").doc(userId);

  // Atomic increment (works for both positive and negative values)
  await userRef.set(
    {
      usage: {
        storageUsedBytes: FieldValue.increment(deltaBytes),
        lastStorageUpdate: new Date(),
      },
    },
    { merge: true },
  );

  // Floor at zero: if we decremented, the counter may have gone negative.
  // Read-then-conditionally-fix is acceptable here because negative values
  // are a consistency concern, not a correctness hot-path.
  if (deltaBytes < 0) {
    const snap = await userRef.get();
    const current = (snap.data() as any)?.usage?.storageUsedBytes;
    if (typeof current === "number" && current < 0) {
      await userRef.update({ "usage.storageUsedBytes": 0 });
      console.warn(`[storage] Floored storageUsedBytes to 0 for user ${userId} (was ${current})`, context);
    }
  }

  const action = deltaBytes > 0 ? "increment" : "decrement";
  console.log(`[storage] ${action} ${Math.abs(deltaBytes)} bytes for user ${userId}`, context);
}

/**
 * Increment storage usage when bytes are successfully committed to R2.
 * Called after uploads, recording-ready confirmation, and export completion.
 */
export async function reserveStorageUsage(
  userId: string,
  fileSizeBytes: number,
  context?: Record<string, any>,
): Promise<void> {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) return;
  await applyStorageUsageDelta(userId, fileSizeBytes, { op: "reserve", ...context });
}

/**
 * Decrement storage usage when bytes are actually removed from R2.
 * Called after successful R2 deletion (delete paths, maintenance purges).
 */
export async function releaseStorageUsage(
  userId: string,
  fileSizeBytes: number,
  context?: Record<string, any>,
): Promise<void> {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) return;
  await applyStorageUsageDelta(userId, -fileSizeBytes, { op: "release", ...context });
}

/**
 * Read the current storageUsedBytes for a user. Returns 0 if not set.
 */
export async function getCurrentStorageUsage(userId: string): Promise<number> {
  if (!userId) return 0;
  const snap = await firestore.collection("users").doc(userId).get();
  if (!snap.exists) return 0;
  const val = (snap.data() as any)?.usage?.storageUsedBytes;
  return typeof val === "number" && Number.isFinite(val) ? Math.max(0, val) : 0;
}

/**
 * Resolve the plan's max storage limit in bytes for a given user.
 * Checks editing.maxStorageGB, editing.maxStorageBytes, top-level maxStorageGB/Bytes.
 */
export async function getMaxStorageBytes(userId: string): Promise<number> {
  const userSnap = await firestore.collection("users").doc(userId).get();
  if (!userSnap.exists) return 0;
  const userData = userSnap.data() as any;
  const planId = (userData.planId || userData.plan || "free") as string;

  const planSnap = await firestore.collection("plans").doc(planId).get();
  if (!planSnap.exists) return 0;
  const planData = planSnap.data() as any;

  return resolveMaxStorageBytesFromPlan(planData);
}

// ─── Transactional Reservation ───────────────────────────────────────────────

/**
 * Result of a transactional reservation attempt.
 */
export type StorageReservationResult = ReservationCheck & {
  reserved: boolean;
};

/**
 * Atomically reserve `fileSizeBytes` of storage for `userId`.
 *
 * This runs inside a single Firestore transaction that:
 *   1. Reads the user doc (current usage) and the plan doc (limit).
 *   2. Checks whether currentUsed + fileSizeBytes <= limit.
 *   3. If allowed, increments the counter inside the transaction.
 *   4. If not, aborts without mutating.
 *
 * Because both the read and the write happen inside the same transaction,
 * two concurrent callers cannot both succeed when only one "slot" remains.
 *
 * Returns a result indicating whether the reservation was granted plus
 * diagnostic fields (currentBytes, limitBytes, etc.).
 *
 * Throws only on infrastructure errors (Firestore outage, missing user).
 * A limit-exceeded rejection is returned as { reserved: false, allowed: false }.
 */
export async function reserveStorageIfAvailable(
  userId: string,
  fileSizeBytes: number,
  context?: Record<string, any>,
): Promise<StorageReservationResult> {
  if (!userId) throw new Error("reserveStorageIfAvailable: userId is required");
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    throw new Error("reserveStorageIfAvailable: fileSizeBytes must be a positive finite number");
  }

  const userRef = firestore.collection("users").doc(userId);

  const result = await firestore.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw new Error(`User ${userId} not found`);
    }

    const userData = userSnap.data() as any;
    const currentBytes = Math.max(0, Number(userData?.usage?.storageUsedBytes) || 0);

    // Resolve plan limit
    const planId = (userData.planId || userData.plan || "free") as string;
    const planSnap = await tx.get(firestore.collection("plans").doc(planId));
    const planData = planSnap.exists ? (planSnap.data() as any) : {};
    const limitBytes = resolveMaxStorageBytesFromPlan(planData);

    const check = canReserveStorage(currentBytes, fileSizeBytes, limitBytes);

    if (!check.allowed) {
      // Return without mutating — reservation denied.
      return { ...check, reserved: false } as StorageReservationResult;
    }

    // Atomically increment the counter inside the transaction.
    tx.set(
      userRef,
      {
        usage: {
          storageUsedBytes: FieldValue.increment(fileSizeBytes),
          lastStorageUpdate: new Date(),
        },
      },
      { merge: true },
    );

    console.log(`[storage] reserved ${fileSizeBytes} bytes for user ${userId}`, context);
    return { ...check, reserved: true } as StorageReservationResult;
  });

  if (!result.reserved) {
    console.log(`[storage] reservation denied for user ${userId}: ${result.reason}`, context);
  }

  return result;
}

/**
 * Release a previously reserved amount when an upload fails after reservation.
 * This is a thin wrapper around releaseStorageUsage that adds clear logging
 * to distinguish rollback-releases from normal delete-releases.
 */
export async function releaseReservedStorage(
  userId: string,
  fileSizeBytes: number,
  context?: Record<string, any>,
): Promise<void> {
  await releaseStorageUsage(userId, fileSizeBytes, { op: "release_reservation", ...context });
}
