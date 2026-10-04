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
import { resolveMaxStorageBytesFromPlan, canReserveStorage } from "./lib/storagePure";
import type { ReservationCheck } from "./lib/storagePure";

// Re-export pure helpers so callers can import from one place
export { computeNextResetDate, resolveMaxStorageBytesFromPlan, canReserveStorage } from "./lib/storagePure";
export type { ReservationCheck } from "./lib/storagePure";

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

  if (deltaBytes > 0) {
    // Atomic increment: no floor needed for positive deltas.
    await userRef.set(
      {
        usage: {
          storageUsedBytes: FieldValue.increment(deltaBytes),
          lastStorageUpdate: new Date(),
        },
      },
      { merge: true },
    );
  } else {
    // Decrement + floor-at-zero in ONE transaction. The previous
    // increment-then-read-then-reset sequence could clobber a concurrent
    // increment that landed between the read and the reset write.
    const floored = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const raw = Number((snap.data() as any)?.usage?.storageUsedBytes);
      const current = Number.isFinite(raw) ? raw : 0;
      const next = Math.max(0, current + deltaBytes);
      tx.set(
        userRef,
        { usage: { storageUsedBytes: next, lastStorageUpdate: new Date() } },
        { merge: true },
      );
      return current + deltaBytes < 0 ? current : null;
    });
    if (floored !== null) {
      console.warn(
        `[storage] Floored storageUsedBytes to 0 for user ${userId} (was ${floored}, delta ${deltaBytes})`,
        context,
      );
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
