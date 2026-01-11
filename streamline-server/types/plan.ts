// Canonical plan id list and type for all plan logic
export const PLAN_IDS = [
  "free",
  "starter",
  "pro",
  "basic",
  "enterprise",
  "internal_unlimited",
  // Add new plan ids here, e.g. "internal_unlimited", etc.
] as const;

export type PlanId = typeof PLAN_IDS[number];

// Type guard for plan id
export function isPlanId(value: any): value is PlanId {
  return PLAN_IDS.includes(value);
}

// Utility: get all plan ids
export function getAllPlanIds(): PlanId[] {
  return [...PLAN_IDS];
}
