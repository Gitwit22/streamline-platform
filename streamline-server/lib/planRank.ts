import { PlanId } from "../types/plan";

// Canonical plan ranking (single source of truth)
// Higher number = higher tier.
export const PLAN_RANK: Record<string, number> = {
  free: 0,
  basic: 1,
  starter: 2,
  pro: 3,
  enterprise: 4,
  // Internal/admin plans stay above public tiers.
  internal_unlimited: 5,
};

export function comparePlans(current: string, target: string): number {
  return (PLAN_RANK[target] ?? 0) - (PLAN_RANK[current] ?? 0);
}

export function isUpgrade(current: PlanId | string, target: PlanId | string): boolean {
  return comparePlans(String(current), String(target)) > 0;
}

export function isDowngrade(current: PlanId | string, target: PlanId | string): boolean {
  return comparePlans(String(current), String(target)) < 0;
}
