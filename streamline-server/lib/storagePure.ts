/**
 * Pure storage accounting helpers — no Firestore dependency.
 *
 * These functions are extracted so they can be unit-tested without
 * requiring Firebase credentials. They are re-exported from usageHelper.ts
 * for convenience.
 */

/**
 * Extract max storage bytes from a plan document (pure helper, no Firestore reads).
 */
export function resolveMaxStorageBytesFromPlan(planData: any): number {
  const GB = 1024 * 1024 * 1024;
  const editing = (planData || {}).editing || {};

  const candidates: Array<{ val: any; unit: "gb" | "bytes" }> = [
    { val: editing.maxStorageGB, unit: "gb" },
    { val: editing.maxStorageBytes, unit: "bytes" },
    { val: (planData || {}).maxStorageGB, unit: "gb" },
    { val: (planData || {}).maxStorageBytes, unit: "bytes" },
  ];

  for (const { val, unit } of candidates) {
    if (val !== undefined && val !== null) {
      const n = Number(val);
      if (Number.isFinite(n) && n > 0) {
        return unit === "gb" ? Math.round(n * GB) : Math.round(n);
      }
    }
  }
  return 0;
}

// ─── Reservation logic (pure) ────────────────────────────────────────────────

export type ReservationCheck = {
  allowed: boolean;
  currentBytes: number;
  requestedBytes: number;
  limitBytes: number;
  newTotalBytes: number;
  reason?: string;
};

/**
 * Decide whether a storage reservation of `requestedBytes` is allowed given
 * the current counter value and the plan limit.  Pure function — no I/O.
 *
 * Rules:
 *   - If limitBytes is 0 (unlimited / unset), always allow.
 *   - If currentBytes + requestedBytes > limitBytes, reject.
 *   - requestedBytes must be > 0, finite.
 */
export function canReserveStorage(
  currentBytes: number,
  requestedBytes: number,
  limitBytes: number,
): ReservationCheck {
  const cur = Number.isFinite(currentBytes) && currentBytes >= 0 ? currentBytes : 0;
  const req = Number.isFinite(requestedBytes) && requestedBytes > 0 ? requestedBytes : 0;
  const lim = Number.isFinite(limitBytes) && limitBytes > 0 ? limitBytes : 0;

  if (req <= 0) {
    return { allowed: false, currentBytes: cur, requestedBytes: req, limitBytes: lim, newTotalBytes: cur, reason: "requestedBytes must be > 0" };
  }

  const newTotal = cur + req;

  // 0 limit means unlimited (plan does not cap storage)
  if (lim === 0) {
    return { allowed: true, currentBytes: cur, requestedBytes: req, limitBytes: lim, newTotalBytes: newTotal };
  }

  if (newTotal > lim) {
    const GB = 1024 * 1024 * 1024;
    return {
      allowed: false,
      currentBytes: cur,
      requestedBytes: req,
      limitBytes: lim,
      newTotalBytes: newTotal,
      reason: `Storage limit exceeded. Current: ${(cur / GB).toFixed(2)} GB / ${(lim / GB).toFixed(2)} GB. ` +
              `Requested: ${(req / (1024 * 1024)).toFixed(2)} MB would exceed limit.`,
    };
  }

  return { allowed: true, currentBytes: cur, requestedBytes: req, limitBytes: lim, newTotalBytes: newTotal };
}

/**
 * Compute the billing period reset date based on user.createdAt.
 * Pure date computation — no Firestore dependency.
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

  const finalReset = fromDate.getDate() >= createdDay ? nextMonthReset : thisMonthReset;
  return finalReset;
}
