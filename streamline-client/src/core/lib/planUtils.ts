// Centralized plan selection logic for upgrades/checkout
// Extend this as you add more plans or variants
export function getCanonicalPlanId(user) {
  if (!user) return "starter_paid";
  if (user.planId === "pro" || user.pendingPlan === "pro") return "pro";
  if (user.planId === "internal_unlimited" || user.pendingPlan === "internal_unlimited") return "internal_unlimited";
  return "starter_paid";
}
