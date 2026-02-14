import { PlanId, isPlanId } from "../types/plan";

export type BillingTruthStatus = "free" | "active" | "trialing" | "past_due" | "canceled";

export interface BillingTruth {
  status: BillingTruthStatus;
  planId: PlanId;
  stripeCustomerId: string | null;
  subscriptionId: string | null;
  currentPeriodEndMs: number | null;
  cancelAtPeriodEnd: boolean;
  scheduledPlanChange: any | null;
  updatedAtMs: number;
}

export function computeAccountMeBillingFields(
  userDoc: any,
  planIdOverride?: any,
  now = Date.now()
): { planId: PlanId; billingTruth: BillingTruth } {
  const planId: PlanId = isPlanId(planIdOverride)
    ? (planIdOverride as PlanId)
    : normalizePlanId(userDoc?.planId ?? userDoc?.billingTruth?.planId);

  const billingTruth = normalizeBillingTruthFromUser({ ...userDoc, planId }, now);
  return { planId, billingTruth };
}

function normalizePlanId(raw: any): PlanId {
  if (typeof raw === "string" && isPlanId(raw)) return raw;
  return "free";
}

function normalizeStatus(raw: any): BillingTruthStatus {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s === "active") return "active";
  if (s === "trialing") return "trialing";
  if (s === "past_due" || s === "unpaid") return "past_due";
  if (s === "canceled" || s === "cancelled") return "canceled";

  // Legacy/missing values map to "free".
  // Older docs may store billingStatus: "none".
  return "free";
}

function normalizeMs(raw: any): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getStripeCustomerId(user: any): string | null {
  const v =
    user?.billing?.customerId ??
    user?.billing?.stripeCustomerId ??
    user?.stripeCustomerId ??
    user?.billingCustomerId;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function getSubscriptionId(user: any): string | null {
  const v = user?.billing?.subscriptionId ?? user?.stripeSubscriptionId;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function normalizeBillingTruthFromUser(user: any, now = Date.now()): BillingTruth {
  const planId = normalizePlanId(user?.planId ?? user?.billingTruth?.planId);
  const billingStatusRaw = user?.billingTruth?.status ?? user?.billingStatus ?? user?.billing?.status;

  const stripeCustomerId =
    typeof user?.billingTruth?.stripeCustomerId === "string"
      ? user.billingTruth.stripeCustomerId
      : getStripeCustomerId(user);

  const subscriptionId =
    typeof user?.billingTruth?.subscriptionId === "string"
      ? user.billingTruth.subscriptionId
      : getSubscriptionId(user);

  const currentPeriodEndMs =
    typeof user?.billingTruth?.currentPeriodEndMs === "number"
      ? normalizeMs(user.billingTruth.currentPeriodEndMs)
      : normalizeMs(user?.billing?.currentPeriodEnd ?? user?.billing?.currentPeriodEndMs);

  const cancelAtPeriodEnd =
    typeof user?.billingTruth?.cancelAtPeriodEnd === "boolean"
      ? user.billingTruth.cancelAtPeriodEnd
      : Boolean(user?.billing?.cancelAtPeriodEnd);

  const scheduledPlanChange =
    user?.billingTruth?.scheduledPlanChange ??
    user?.scheduledPlanChange ??
    null;

  // If there is no subscriptionId, force status to free.
  // This makes the admin display unambiguous for free users.
  const status = subscriptionId ? normalizeStatus(billingStatusRaw) : "free";

  return {
    status,
    planId,
    stripeCustomerId,
    subscriptionId,
    currentPeriodEndMs,
    cancelAtPeriodEnd,
    scheduledPlanChange,
    updatedAtMs: now,
  };
}
