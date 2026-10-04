/**
 * Creator revenue ledger — pure parts (fee math, refund classification,
 * reversal orchestration over injected stores). Unit-tested; the Firestore
 * wiring lives in lib/revenueLedger.ts.
 *
 * Data only: no payouts. Payouts (Stripe Connect) are out of scope.
 */

export type LedgerStatus = "paid" | "refunded" | "disputed";

export interface RevenueLedgerEntry {
  id: string;
  creatorUid: string;
  channelId: string | null;
  roomId: string | null;
  eventId: string;
  purchaseId: string;
  type: "access" | "donation";
  grossCents: number;
  currency: string;
  platformFeeBps: number;
  platformFeeCents: number;
  netCents: number;
  refundedCents: number;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string;
  status: LedgerStatus;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_PLATFORM_FEE_BPS = 1000; // 10%

/** PLATFORM_FEE_BPS (basis points, 0..10000). Invalid → default 10%. */
export function getPlatformFeeBps(env: Record<string, string | undefined> = process.env): number {
  const raw = env.PLATFORM_FEE_BPS;
  if (raw === undefined || String(raw).trim() === "") return DEFAULT_PLATFORM_FEE_BPS;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 10000) return DEFAULT_PLATFORM_FEE_BPS;
  return n;
}

/**
 * Platform fee rounds half-up to the nearest cent; the creator gets the rest,
 * so fee + net always equals gross exactly.
 */
export function computeFees(grossCents: number, bps: number): { platformFeeCents: number; netCents: number } {
  const gross = Math.max(0, Math.floor(Number(grossCents) || 0));
  const rate = Math.min(10000, Math.max(0, Math.floor(Number(bps) || 0)));
  const fee = Math.min(gross, Math.floor((gross * rate + 5000) / 10000));
  return { platformFeeCents: fee, netCents: gross - fee };
}

export function ledgerIdFor(eventId: string, purchaseId: string): string {
  return `${eventId}__${purchaseId}`;
}

export function buildLedgerEntry(input: {
  creatorUid: string;
  channelId: string | null;
  roomId: string | null;
  eventId: string;
  purchaseId: string;
  type: "access" | "donation";
  grossCents: number;
  currency: string;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string;
  bps: number;
  nowMs: number;
}): RevenueLedgerEntry {
  const { platformFeeCents, netCents } = computeFees(input.grossCents, input.bps);
  return {
    id: ledgerIdFor(input.eventId, input.purchaseId),
    creatorUid: input.creatorUid,
    channelId: input.channelId,
    roomId: input.roomId,
    eventId: input.eventId,
    purchaseId: input.purchaseId,
    type: input.type,
    grossCents: Math.max(0, Math.floor(input.grossCents || 0)),
    currency: String(input.currency || "usd").toLowerCase(),
    platformFeeBps: input.bps,
    platformFeeCents,
    netCents,
    refundedCents: 0,
    stripePaymentIntentId: input.stripePaymentIntentId,
    stripeCheckoutSessionId: input.stripeCheckoutSessionId,
    status: "paid",
    createdAt: input.nowMs,
    updatedAt: input.nowMs,
  };
}

// ---------------------------------------------------------------------------
// Earnings summary
// ---------------------------------------------------------------------------

export interface EarningsSummary {
  currency: string;
  grossCents: number;
  platformFeeCents: number;
  netCents: number;
  refundedCents: number;
  paidCount: number;
  refundedCount: number;
  disputedCount: number;
}

/** Sums ledger rows per currency. Refunded/disputed rows contribute 0 net. */
export function summarizeEarnings(rows: Array<Pick<RevenueLedgerEntry, "currency" | "grossCents" | "platformFeeCents" | "netCents" | "refundedCents" | "status">>): EarningsSummary[] {
  const by = new Map<string, EarningsSummary>();
  for (const r of rows) {
    const cur = String(r.currency || "usd").toLowerCase();
    const s =
      by.get(cur) ||
      { currency: cur, grossCents: 0, platformFeeCents: 0, netCents: 0, refundedCents: 0, paidCount: 0, refundedCount: 0, disputedCount: 0 };
    if (r.status === "paid") {
      s.paidCount += 1;
      s.grossCents += r.grossCents;
      s.platformFeeCents += r.platformFeeCents;
      // Partial refunds come out of the creator's share.
      s.netCents += Math.max(0, r.netCents - (r.refundedCents || 0));
      s.refundedCents += r.refundedCents || 0;
    } else if (r.status === "refunded") {
      s.refundedCount += 1;
      s.refundedCents += r.refundedCents || r.grossCents;
    } else if (r.status === "disputed") {
      s.disputedCount += 1;
    }
    by.set(cur, s);
  }
  return [...by.values()].sort((a, b) => b.netCents - a.netCents);
}

// ---------------------------------------------------------------------------
// Refunds / disputes
// ---------------------------------------------------------------------------

export type ChargeReversal =
  | { kind: "full_refund"; refundedCents: number }
  | { kind: "partial_refund"; refundedCents: number }
  | { kind: "dispute"; refundedCents: 0 }
  | { kind: "none"; refundedCents: 0 };

/** Classify charge.refunded / charge.dispute.created payloads. */
export function classifyChargeReversal(eventType: string, charge: any): ChargeReversal {
  if (eventType === "charge.dispute.created") return { kind: "dispute", refundedCents: 0 };
  if (eventType !== "charge.refunded") return { kind: "none", refundedCents: 0 };
  const amount = Math.max(0, Number(charge?.amount) || 0);
  const refunded = Math.max(0, Number(charge?.amount_refunded) || 0);
  if (refunded <= 0) return { kind: "none", refundedCents: 0 };
  if (charge?.refunded === true || (amount > 0 && refunded >= amount)) return { kind: "full_refund", refundedCents: refunded };
  return { kind: "partial_refund", refundedCents: refunded };
}

export interface ReversalTarget {
  eventId: string;
  purchaseId: string;
  ledgerId: string | null;
}

export interface ReversalStores {
  /** Ledger rows / purchases tied to a PaymentIntent (with a Stripe fallback for pre-ledger purchases). */
  findTargets(paymentIntentId: string): Promise<ReversalTarget[]>;
  markLedger(ledgerId: string, patch: { status?: LedgerStatus; refundedCents?: number }): Promise<void>;
  markPurchase(eventId: string, purchaseId: string, status: "refunded" | "disputed"): Promise<void>;
  revokeEntitlementsForPurchase(purchaseId: string, reason: string): Promise<number>;
  revokeAccessCode(eventId: string, purchaseId: string): Promise<void>;
}

/**
 * Apply a refund/dispute: full refund or dispute → purchase + ledger marked,
 * entitlements and the access code revoked. Partial refund → ledger
 * refundedCents only (access kept). Idempotent (all writes are set-style).
 */
export async function applyChargeReversal(
  stores: ReversalStores,
  eventType: string,
  charge: any
): Promise<{ kind: ChargeReversal["kind"]; targets: number; revoked: number }> {
  const reversal = classifyChargeReversal(eventType, charge);
  const pi = typeof charge?.payment_intent === "string" ? charge.payment_intent : charge?.payment_intent?.id;
  if (reversal.kind === "none" || !pi) return { kind: reversal.kind, targets: 0, revoked: 0 };

  const targets = await stores.findTargets(String(pi));
  let revoked = 0;
  for (const t of targets) {
    if (reversal.kind === "partial_refund") {
      if (t.ledgerId) await stores.markLedger(t.ledgerId, { refundedCents: reversal.refundedCents });
      continue;
    }
    const status = reversal.kind === "dispute" ? "disputed" : "refunded";
    await stores.markPurchase(t.eventId, t.purchaseId, status);
    if (t.ledgerId) {
      await stores.markLedger(
        t.ledgerId,
        reversal.kind === "full_refund" ? { status, refundedCents: reversal.refundedCents } : { status }
      );
    }
    revoked += await stores.revokeEntitlementsForPurchase(t.purchaseId, status);
    await stores.revokeAccessCode(t.eventId, t.purchaseId);
  }
  return { kind: reversal.kind, targets: targets.length, revoked };
}
