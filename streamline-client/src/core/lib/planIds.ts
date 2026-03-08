// Canonical plan id/type utilities for frontend (mirror backend)

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

export function isPlanId(value: any): value is PlanId {
  return PLAN_IDS.includes(value);
}

export function getAllPlanIds(): PlanId[] {
  return [...PLAN_IDS];
}
