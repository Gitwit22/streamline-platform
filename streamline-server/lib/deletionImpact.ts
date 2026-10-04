/**
 * Pure shaping for the admin "Delete Account" dialog
 * (GET /api/admin/users/:id/deletion-impact) and the restore rule
 * (POST /api/admin/users/:id/restore). No I/O.
 */
import { DELETION_PURGE_WINDOW_MS, readSubscriptionId } from "./accountDeletionCore";

export type SubscriptionImpact = {
  id: string;
  status: string;
  planId: string | null;
  planName: string | null;
  /** Amount per billing interval, in major units (e.g. dollars). */
  amount: number | null;
  /** Amount normalized to one month (yearly / 12), major units. */
  amountMonthly: number | null;
  currency: string | null;
  interval: string | null;
  intervalCount: number;
  /** Next charge (ISO); null when nothing more will be charged. */
  nextBillingDate: string | null;
  cancelAtPeriodEnd: boolean;
  /** Stripe will keep (trying to) charge unless canceled. */
  billable: boolean;
};

export type SubscriptionLookup = "ok" | "none" | "not_found" | "error";

export type DeletionImpact = {
  uid: string;
  email: string | null;
  displayName: string | null;
  alreadyDeleted: boolean;
  /** ok: Stripe returned it; none: no subscription on file; not_found: id unknown to Stripe; error: lookup failed. */
  subscriptionLookup: SubscriptionLookup;
  subscriptionLookupError?: string;
  subscription: SubscriptionImpact | null;
  /** Subscription id stored on the user doc (shown even when the Stripe lookup failed). */
  storedSubscriptionId: string | null;
  storedPlanId: string | null;
  rooms: number | null;
  recordings: number | null;
  storageBytes: number;
  purgeWindowDays: number;
};

const BILLABLE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

function periodEndSeconds(sub: any): number | null {
  const a = sub?.items?.data?.[0]?.current_period_end;
  if (typeof a === "number" && Number.isFinite(a)) return a;
  const b = sub?.current_period_end;
  return typeof b === "number" && Number.isFinite(b) ? b : null;
}

function monthsPerInterval(interval: string | null, count: number): number | null {
  if (interval === "year") return 12 * count;
  if (interval === "month") return count;
  if (interval === "week") return (7 * count) / 30.4375;
  if (interval === "day") return count / 30.4375;
  return null;
}

/** Shape a Stripe subscription object for the dialog. */
export function shapeSubscriptionImpact(sub: any): SubscriptionImpact | null {
  if (!sub || typeof sub !== "object" || typeof sub.id !== "string") return null;
  const items: any[] = Array.isArray(sub.items?.data) ? sub.items.data : [];
  let totalMinor = 0;
  let haveAmount = false;
  let currency: string | null = typeof sub.currency === "string" ? sub.currency : null;
  let interval: string | null = null;
  let intervalCount = 1;
  let planName: string | null = null;
  for (const item of items) {
    const price = item?.price || item?.plan || {};
    const unit =
      typeof price.unit_amount === "number" ? price.unit_amount : typeof price.amount === "number" ? price.amount : null;
    const qty = typeof item?.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
    if (unit !== null) {
      totalMinor += unit * qty;
      haveAmount = true;
    }
    if (!currency && typeof price.currency === "string") currency = price.currency;
    if (!interval) {
      const rec = price.recurring || {};
      interval = typeof rec.interval === "string" ? rec.interval : typeof price.interval === "string" ? price.interval : null;
      const ic = Number(rec.interval_count ?? price.interval_count);
      intervalCount = Number.isFinite(ic) && ic > 0 ? ic : 1;
    }
    if (!planName) {
      const product = price.product;
      planName =
        (typeof price.nickname === "string" && price.nickname) ||
        (product && typeof product === "object" && typeof product.name === "string" ? product.name : null) ||
        null;
    }
  }
  const amount = haveAmount ? Math.round(totalMinor) / 100 : null;
  const months = monthsPerInterval(interval, intervalCount);
  const amountMonthly = amount !== null && months ? Math.round((amount / months) * 100) / 100 : null;
  const status = String(sub.status || "unknown");
  const periodEnd = periodEndSeconds(sub);
  const cancelAtPeriodEnd = sub.cancel_at_period_end === true;
  const billable = BILLABLE_STATUSES.has(status);
  const metaPlan = sub.metadata && typeof sub.metadata.planId === "string" ? sub.metadata.planId : null;
  return {
    id: sub.id,
    status,
    planId: metaPlan,
    planName: planName || metaPlan,
    amount,
    amountMonthly,
    currency: currency ? currency.toUpperCase() : null,
    interval,
    intervalCount,
    nextBillingDate: billable && !cancelAtPeriodEnd && periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancelAtPeriodEnd,
    billable,
  };
}

export function shapeDeletionImpact(input: {
  uid: string;
  user: any;
  subscription: any | null;
  subscriptionLookup: SubscriptionLookup;
  subscriptionLookupError?: string;
  rooms: number | null;
  recordings: number | null;
  storageBytes: number;
}): DeletionImpact {
  const user = input.user || {};
  const status = String(user.accountStatus || "").toLowerCase();
  return {
    uid: input.uid,
    email: typeof user.email === "string" ? user.email : null,
    displayName: typeof user.displayName === "string" ? user.displayName : null,
    alreadyDeleted: status === "deleted" || (typeof user.deletedAtMs === "number" && user.deletedAtMs > 0),
    subscriptionLookup: input.subscriptionLookup,
    ...(input.subscriptionLookupError ? { subscriptionLookupError: input.subscriptionLookupError } : {}),
    subscription: shapeSubscriptionImpact(input.subscription),
    storedSubscriptionId: readSubscriptionId(user),
    storedPlanId: typeof user.planId === "string" ? user.planId : null,
    rooms: input.rooms,
    recordings: input.recordings,
    storageBytes: Math.max(0, Number(input.storageBytes) || 0),
    purgeWindowDays: Math.round(DELETION_PURGE_WINDOW_MS / (24 * 60 * 60 * 1000)),
  };
}

/** Can a soft-deleted account be restored now? */
export function evaluateRestore(
  user: any,
  nowMs: number
): { ok: boolean; status?: number; error?: string; details?: string } {
  if (!user) return { ok: false, status: 404, error: "user_not_found", details: "User not found" };
  const deleted =
    String(user.accountStatus || "").toLowerCase() === "deleted" ||
    (typeof user.deletedAtMs === "number" && user.deletedAtMs > 0);
  if (!deleted) return { ok: false, status: 409, error: "not_deleted", details: "Account is not deleted" };
  if (typeof user.deleteAfterMs === "number" && user.deleteAfterMs > 0 && user.deleteAfterMs <= nowMs) {
    return {
      ok: false,
      status: 410,
      error: "purge_window_passed",
      details: "The restore window has passed; data may already be purged",
    };
  }
  return { ok: true };
}

/** Fields a restore removes from the user doc. */
export const RESTORE_CLEARED_FIELDS = [
  "accountStatus",
  "deletedAtMs",
  "deletedAt",
  "deleteAfterMs",
  "deletionRequestedAtMs",
  "deletionReason",
  "deletedBy",
  "dataCleanup",
] as const;
