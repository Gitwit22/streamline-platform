/**
 * Client helpers for the admin "Delete Account" dialog, bulk deletion and
 * usage-credit grants (pure; no fetch). Server contract:
 *   GET    /api/admin/users/:id/deletion-impact -> { impact }
 *   DELETE /api/admin/users/:id  { cancelStripe, revokeSessions, scheduleMediaDeletion, confirm: "DELETE" }
 *          200 completed | 207 partial | 502 Stripe cancel failed (NOT deleted) | 4xx/500
 *   POST   /api/admin/users/:id/restore
 *   POST   /api/admin/users/:id/grant-minutes { minutes, reason, expiresAt? }
 */

export type DeletionOptions = {
  cancelStripe: boolean;
  revokeSessions: boolean;
  scheduleMediaDeletion: boolean;
};

export const DEFAULT_DELETION_OPTIONS: DeletionOptions = {
  cancelStripe: true,
  revokeSessions: true,
  scheduleMediaDeletion: true,
};

export type SubscriptionImpact = {
  id: string;
  status: string;
  planId: string | null;
  planName: string | null;
  amount: number | null;
  amountMonthly: number | null;
  currency: string | null;
  interval: string | null;
  intervalCount: number;
  nextBillingDate: string | null;
  cancelAtPeriodEnd: boolean;
  billable: boolean;
};

export type DeletionImpact = {
  uid: string;
  email: string | null;
  displayName: string | null;
  alreadyDeleted: boolean;
  subscriptionLookup: "ok" | "none" | "not_found" | "error";
  subscriptionLookupError?: string;
  subscription: SubscriptionImpact | null;
  storedSubscriptionId: string | null;
  storedPlanId: string | null;
  rooms: number | null;
  recordings: number | null;
  storageBytes: number;
  purgeWindowDays: number;
};

export function isDeleteConfirmed(text: string): boolean {
  return String(text ?? "").trim() === "DELETE";
}

export function buildDeleteRequestBody(options: DeletionOptions, confirmText: string) {
  return {
    cancelStripe: !!options.cancelStripe,
    revokeSessions: !!options.revokeSessions,
    scheduleMediaDeletion: !!options.scheduleMediaDeletion,
    confirm: String(confirmText ?? "").trim(),
  };
}

function money(amount: number, currency: string | null): string {
  const cur = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${cur}`;
  }
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** One line for the dialog: "Pro · $49.00/month · next billing Nov 1, 2026". */
export function formatSubscriptionSummary(impact: DeletionImpact | null | undefined): string {
  if (!impact) return "Loading…";
  if (impact.subscriptionLookup === "none") return "No subscription on file";
  if (impact.subscriptionLookup === "not_found") return `Subscription ${impact.storedSubscriptionId ?? ""} not found in Stripe (nothing to cancel)`.trim();
  if (impact.subscriptionLookup === "error" || !impact.subscription) {
    return `Could not load subscription ${impact.storedSubscriptionId ?? ""} from Stripe${impact.subscriptionLookupError ? `: ${impact.subscriptionLookupError}` : ""}`;
  }
  const s = impact.subscription;
  const parts: string[] = [s.planName || s.planId || impact.storedPlanId || "Subscription"];
  if (s.amountMonthly !== null) parts.push(`${money(s.amountMonthly, s.currency)}/month`);
  else if (s.amount !== null) parts.push(`${money(s.amount, s.currency)}/${s.interval || "period"}`);
  if (!s.billable) parts.push(`status ${s.status} (not billing)`);
  else if (s.cancelAtPeriodEnd) parts.push("already set to cancel at period end");
  else {
    const next = shortDate(s.nextBillingDate);
    parts.push(next ? `next billing ${next}` : `status ${s.status}`);
  }
  return parts.join(" · ");
}

/** True when deleting without canceling would leave Stripe charging. */
export function subscriptionStillBilling(impact: DeletionImpact | null | undefined): boolean {
  if (!impact) return false;
  if (impact.subscription) return impact.subscription.billable && !impact.subscription.cancelAtPeriodEnd;
  return impact.subscriptionLookup === "error" && !!impact.storedSubscriptionId;
}

export function formatBytes(bytes: number): string {
  const b = Math.max(0, Number(bytes) || 0);
  if (b < 1024) return `${b} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export type PerUserDeletionResult = {
  uid: string;
  label?: string;
  httpStatus: number;
  /** Server outcome when the body had one. */
  outcome?: "completed" | "partial" | "failed";
  error?: string;
  message?: string;
};

/** Normalize one DELETE response (status + parsed JSON body, possibly empty). */
export function toPerUserResult(uid: string, httpStatus: number, body: any, label?: string): PerUserDeletionResult {
  const outcome =
    body && (body.outcome === "completed" || body.outcome === "partial" || body.outcome === "failed")
      ? body.outcome
      : httpStatus >= 200 && httpStatus < 300
        ? httpStatus === 207
          ? "partial"
          : "completed"
        : "failed";
  return {
    uid,
    label,
    httpStatus,
    outcome,
    error: typeof body?.error === "string" ? body.error : httpStatus >= 400 ? `HTTP ${httpStatus}` : undefined,
    message: typeof body?.message === "string" ? body.message : typeof body?.details === "string" ? body.details : undefined,
  };
}

export type BulkDeletionSummary = {
  completed: PerUserDeletionResult[];
  partial: PerUserDeletionResult[];
  failed: PerUserDeletionResult[];
  /** Short toast text. */
  message: string;
};

export function summarizeBulkDeletion(results: PerUserDeletionResult[]): BulkDeletionSummary {
  const completed = results.filter((r) => r.outcome === "completed");
  const partial = results.filter((r) => r.outcome === "partial");
  const failed = results.filter((r) => r.outcome === "failed");
  const bits: string[] = [];
  if (completed.length) bits.push(`${completed.length} deleted`);
  if (partial.length) bits.push(`${partial.length} partially deleted`);
  if (failed.length) {
    const names = failed
      .slice(0, 3)
      .map((f) => `${f.label || f.uid} (${f.error === "stripe_cancel_failed" ? "Stripe cancel failed - not deleted" : f.error || "failed"})`)
      .join(", ");
    bits.push(`${failed.length} failed: ${names}${failed.length > 3 ? ", …" : ""}`);
  }
  return { completed, partial, failed, message: bits.join("; ") || "Nothing deleted" };
}

/** Grant input -> positive whole minutes, or null when invalid. */
export function parseGrantMinutes(input: unknown): number | null {
  const s = typeof input === "number" ? String(input) : typeof input === "string" ? input.trim() : "";
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 1_000_000) return null;
  return n;
}

/** <input type="date"> value -> end of that day UTC (epoch ms), or null when empty/invalid. */
export function parseExpiryDate(value: string): number | null {
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = Date.parse(`${s}T23:59:59.999Z`);
  return Number.isFinite(ms) ? ms : null;
}
