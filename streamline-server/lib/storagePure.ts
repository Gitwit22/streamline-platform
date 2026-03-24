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
