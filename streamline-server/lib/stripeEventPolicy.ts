/** Pure decision logic for Stripe webhook de-duplication (see stripeEventLog.ts). */

// A "processing" marker older than this is assumed abandoned (crash/timeout).
const STALE_PROCESSING_MS = 5 * 60 * 1000;

export function isAlreadyExists(err: any): boolean {
  return err?.code === 6 || err?.code === "already-exists" || /ALREADY_EXISTS/i.test(String(err?.message || ""));
}

/**
 * Pure decision for an existing marker: may this delivery (re)process it?
 */
export function canReclaimStripeEvent(
  existing: { status?: string; startedAt?: number } | null | undefined,
  now: number
): boolean {
  if (!existing) return true;
  if (existing.status === "done") return false;
  if (existing.status !== "processing") return true;
  const startedAt = Number(existing.startedAt || 0);
  return !(startedAt > 0 && now - startedAt < STALE_PROCESSING_MS);
}
