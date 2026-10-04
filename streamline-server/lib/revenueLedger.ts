/**
 * Creator revenue ledger (Firestore: revenueLedger/{eventId__purchaseId}).
 * Pure parts (fee math, refunds, summaries): lib/revenueLedgerPure.ts.
 * Data only — payouts (Stripe Connect) are not implemented.
 */
import { firestore as db } from "../firebaseAdmin";
import { stripe } from "./stripe";
import {
  buildLedgerEntry,
  getPlatformFeeBps,
  ledgerIdFor,
  type LedgerStatus,
  type ReversalStores,
  type ReversalTarget,
  type RevenueLedgerEntry,
} from "./revenueLedgerPure";
import { revokeAccessCodeForPurchase, setPurchaseStatus } from "./monetization";
import { revokeEntitlementsForPurchase } from "./viewerEntitlements";

function col() {
  return db.collection("revenueLedger");
}

function isAlreadyExists(err: any): boolean {
  return err?.code === 6 || err?.code === "already-exists" || /ALREADY_EXISTS/i.test(String(err?.message || ""));
}

/** Idempotent per (event, purchase): a redelivered webhook never double-counts. */
export async function recordLedgerEntry(input: Omit<Parameters<typeof buildLedgerEntry>[0], "bps" | "nowMs">): Promise<RevenueLedgerEntry> {
  const entry = buildLedgerEntry({ ...input, bps: getPlatformFeeBps(), nowMs: Date.now() });
  const ref = col().doc(entry.id);
  try {
    await ref.create(entry);
    return entry;
  } catch (err: any) {
    if (!isAlreadyExists(err)) throw err;
    return (await ref.get()).data() as RevenueLedgerEntry;
  }
}

export async function listLedgerForCreator(creatorUid: string, limit = 1000): Promise<RevenueLedgerEntry[]> {
  // Single-field equality query (no composite index); sorted in memory.
  const snap = await col().where("creatorUid", "==", creatorUid).limit(limit).get();
  return snap.docs.map((d) => d.data() as RevenueLedgerEntry).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** Firestore + Stripe wiring for applyChargeReversal. */
export const reversalStores: ReversalStores = {
  async findTargets(paymentIntentId: string): Promise<ReversalTarget[]> {
    const snap = await col().where("stripePaymentIntentId", "==", paymentIntentId).get();
    if (!snap.empty) {
      return snap.docs.map((d) => {
        const e = d.data() as RevenueLedgerEntry;
        return { eventId: e.eventId, purchaseId: e.purchaseId, ledgerId: d.id };
      });
    }
    // Purchases made before the ledger existed: find the checkout session.
    try {
      const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
      const s = sessions.data[0];
      if (s && s.metadata?.source === "streamline_monetization" && s.metadata?.eventId) {
        return [{ eventId: String(s.metadata.eventId), purchaseId: s.id, ledgerId: null }];
      }
    } catch (err: any) {
      console.warn("[revenueLedger] session lookup for refund failed", { paymentIntentId, error: err?.message });
      throw err; // let Stripe retry
    }
    return [];
  },
  async markLedger(ledgerId: string, patch: { status?: LedgerStatus; refundedCents?: number }) {
    await col().doc(ledgerId).set({ ...patch, updatedAt: Date.now() }, { merge: true });
  },
  async markPurchase(eventId: string, purchaseId: string, status: "refunded" | "disputed") {
    await setPurchaseStatus(eventId, purchaseId, status);
  },
  revokeEntitlementsForPurchase,
  revokeAccessCode: revokeAccessCodeForPurchase,
};

export { ledgerIdFor };
