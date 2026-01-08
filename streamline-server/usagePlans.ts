// src/server/usagePlan.ts

export const PLAN_LIMITS: Record<string, number> = {
  free: 3,      // 3 hours per month
  starter: 10,   // 10 hours per month
  pro: 40        // 40 hours per month
};

// Minimal export for routes/plans.ts; avoids duplication
export const PLANS: string[] = Object.keys(PLAN_LIMITS);

export function getPlanMaxHours(plan: string, existingMaxHours?: number): number {
  // If the user has a custom maxHours set in their Firestore doc, use that
  if (existingMaxHours && existingMaxHours > 0) {
    return existingMaxHours;
  }

  // Otherwise fallback to the defaults
  return PLAN_LIMITS[plan] ?? 0;
}
