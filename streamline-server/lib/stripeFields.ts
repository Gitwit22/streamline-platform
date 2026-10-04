/**
 * Stripe field accessors that tolerate API-version drift.
 *
 * As of API version 2025-03-31.basil (and therefore 2025-12-15.clover, which
 * the SDK pins), several fields moved:
 *   - subscription.current_period_{start,end} → subscription.items.data[i]
 *   - invoice.subscription → invoice.parent.subscription_details.subscription
 *   - invoice subscription metadata → invoice.parent.subscription_details.metadata
 *
 * These helpers read the new location first and fall back to the legacy one.
 * Pure functions (no Firebase / Stripe client imports) so they are unit-testable.
 */

function asSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Current period end (unix seconds) or null. */
export function getSubscriptionPeriodEnd(sub: any): number | null {
  return (
    asSeconds(sub?.items?.data?.[0]?.current_period_end) ??
    asSeconds(sub?.current_period_end)
  );
}

/** Current period start (unix seconds) or null. */
export function getSubscriptionPeriodStart(sub: any): number | null {
  return (
    asSeconds(sub?.items?.data?.[0]?.current_period_start) ??
    asSeconds(sub?.current_period_start)
  );
}

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof (value as any).id === "string") {
    return (value as any).id || null;
  }
  return null;
}

/** Subscription id an invoice belongs to, or null. */
export function getInvoiceSubscriptionId(invoice: any): string | null {
  return (
    idOf(invoice?.parent?.subscription_details?.subscription) ??
    idOf(invoice?.subscription)
  );
}

/** Subscription metadata snapshot carried on an invoice ({} when absent). */
export function getInvoiceSubscriptionMetadata(invoice: any): Record<string, string> {
  const fromParent = invoice?.parent?.subscription_details?.metadata;
  if (fromParent && typeof fromParent === "object") return fromParent;
  const legacy = invoice?.metadata;
  if (legacy && typeof legacy === "object") return legacy;
  return {};
}

/**
 * Subscription statuses where Stripe has given up collecting (or the
 * subscription never activated) and the user should drop to the free plan.
 * past_due / incomplete mean Stripe is still retrying — keep the plan.
 */
export function isTerminalSubscriptionStatus(status: unknown): boolean {
  return status === "unpaid" || status === "canceled" || status === "incomplete_expired";
}
