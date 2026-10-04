import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyChargeReversal,
  buildLedgerEntry,
  classifyChargeReversal,
  computeFees,
  DEFAULT_PLATFORM_FEE_BPS,
  getPlatformFeeBps,
  summarizeEarnings,
  type ReversalStores,
} from "./revenueLedgerPure";
import {
  deviceKeyFor,
  isEntitlementActive,
  ppvAccountEntitlementId,
  ppvDeviceEntitlementId,
  safeReturnPath,
} from "./viewerEntitlementsPure";

describe("ledger fee math", () => {
  it("10% default; fee + net === gross", () => {
    assert.equal(getPlatformFeeBps({}), DEFAULT_PLATFORM_FEE_BPS);
    assert.deepEqual(computeFees(1000, 1000), { platformFeeCents: 100, netCents: 900 });
    for (const gross of [0, 1, 99, 100, 101, 499, 999, 12345, 1_000_000]) {
      for (const bps of [0, 1, 250, 999, 1000, 1500, 10000]) {
        const f = computeFees(gross, bps);
        assert.equal(f.platformFeeCents + f.netCents, gross, `${gross}@${bps}`);
        assert.ok(f.platformFeeCents >= 0 && f.netCents >= 0);
      }
    }
  });

  it("rounds the fee half-up to the cent", () => {
    assert.deepEqual(computeFees(105, 1000), { platformFeeCents: 11, netCents: 94 }); // 10.5 → 11
    assert.deepEqual(computeFees(104, 1000), { platformFeeCents: 10, netCents: 94 }); // 10.4 → 10
    assert.deepEqual(computeFees(999, 250), { platformFeeCents: 25, netCents: 974 }); // 24.975 → 25
  });

  it("PLATFORM_FEE_BPS env: valid integers 0..10000, otherwise default", () => {
    assert.equal(getPlatformFeeBps({ PLATFORM_FEE_BPS: "0" }), 0);
    assert.equal(getPlatformFeeBps({ PLATFORM_FEE_BPS: "1500" }), 1500);
    assert.equal(getPlatformFeeBps({ PLATFORM_FEE_BPS: "10001" }), DEFAULT_PLATFORM_FEE_BPS);
    assert.equal(getPlatformFeeBps({ PLATFORM_FEE_BPS: "-5" }), DEFAULT_PLATFORM_FEE_BPS);
    assert.equal(getPlatformFeeBps({ PLATFORM_FEE_BPS: "12.5" }), DEFAULT_PLATFORM_FEE_BPS);
    assert.equal(getPlatformFeeBps({ PLATFORM_FEE_BPS: "abc" }), DEFAULT_PLATFORM_FEE_BPS);
  });

  it("buildLedgerEntry is deterministic per (event, purchase)", () => {
    const e = buildLedgerEntry({
      creatorUid: "c1",
      channelId: "emb1",
      roomId: "r1",
      eventId: "ev1",
      purchaseId: "cs_1",
      type: "access",
      grossCents: 1999,
      currency: "USD",
      stripePaymentIntentId: "pi_1",
      stripeCheckoutSessionId: "cs_1",
      bps: 1000,
      nowMs: 5,
    });
    assert.equal(e.id, "ev1__cs_1");
    assert.equal(e.platformFeeCents, 200);
    assert.equal(e.netCents, 1799);
    assert.equal(e.currency, "usd");
    assert.equal(e.status, "paid");
  });

  it("summarizes per currency; refunds/disputes excluded from net", () => {
    const rows = [
      { currency: "usd", grossCents: 1000, platformFeeCents: 100, netCents: 900, refundedCents: 0, status: "paid" as const },
      { currency: "usd", grossCents: 500, platformFeeCents: 50, netCents: 450, refundedCents: 100, status: "paid" as const },
      { currency: "usd", grossCents: 700, platformFeeCents: 70, netCents: 630, refundedCents: 700, status: "refunded" as const },
      { currency: "usd", grossCents: 300, platformFeeCents: 30, netCents: 270, refundedCents: 0, status: "disputed" as const },
      { currency: "eur", grossCents: 200, platformFeeCents: 20, netCents: 180, refundedCents: 0, status: "paid" as const },
    ];
    const [usd, eur] = summarizeEarnings(rows);
    assert.deepEqual(usd, {
      currency: "usd",
      grossCents: 1500,
      platformFeeCents: 150,
      netCents: 1250,
      refundedCents: 800,
      paidCount: 2,
      refundedCount: 1,
      disputedCount: 1,
    });
    assert.equal(eur.netCents, 180);
  });
});

describe("refund / dispute → revoke", () => {
  it("classifies charge events", () => {
    assert.deepEqual(classifyChargeReversal("charge.refunded", { amount: 500, amount_refunded: 500, refunded: true }), {
      kind: "full_refund",
      refundedCents: 500,
    });
    assert.deepEqual(classifyChargeReversal("charge.refunded", { amount: 500, amount_refunded: 200, refunded: false }), {
      kind: "partial_refund",
      refundedCents: 200,
    });
    assert.equal(classifyChargeReversal("charge.dispute.created", {}).kind, "dispute");
    assert.equal(classifyChargeReversal("charge.refunded", { amount: 500, amount_refunded: 0 }).kind, "none");
    assert.equal(classifyChargeReversal("charge.succeeded", {}).kind, "none");
  });

  function fakeStores(targets: Array<{ eventId: string; purchaseId: string; ledgerId: string | null }>) {
    const calls: string[] = [];
    const stores: ReversalStores = {
      async findTargets(pi) {
        calls.push(`find:${pi}`);
        return targets;
      },
      async markLedger(id, patch) {
        calls.push(`ledger:${id}:${patch.status ?? "-"}:${patch.refundedCents ?? "-"}`);
      },
      async markPurchase(eventId, purchaseId, status) {
        calls.push(`purchase:${eventId}/${purchaseId}:${status}`);
      },
      async revokeEntitlementsForPurchase(purchaseId, reason) {
        calls.push(`revoke:${purchaseId}:${reason}`);
        return 2;
      },
      async revokeAccessCode(eventId, purchaseId) {
        calls.push(`code:${eventId}/${purchaseId}`);
      },
    };
    return { stores, calls };
  }

  it("full refund marks purchase + ledger refunded and revokes entitlements + code", async () => {
    const { stores, calls } = fakeStores([{ eventId: "ev1", purchaseId: "cs_1", ledgerId: "ev1__cs_1" }]);
    const r = await applyChargeReversal(stores, "charge.refunded", { payment_intent: "pi_1", amount: 500, amount_refunded: 500, refunded: true });
    assert.deepEqual(r, { kind: "full_refund", targets: 1, revoked: 2 });
    assert.deepEqual(calls, [
      "find:pi_1",
      "purchase:ev1/cs_1:refunded",
      "ledger:ev1__cs_1:refunded:500",
      "revoke:cs_1:refunded",
      "code:ev1/cs_1",
    ]);
  });

  it("dispute revokes access and marks disputed (pre-ledger purchase: no ledger write)", async () => {
    const { stores, calls } = fakeStores([{ eventId: "ev1", purchaseId: "cs_2", ledgerId: null }]);
    const r = await applyChargeReversal(stores, "charge.dispute.created", { payment_intent: { id: "pi_2" } });
    assert.equal(r.kind, "dispute");
    assert.deepEqual(calls, ["find:pi_2", "purchase:ev1/cs_2:disputed", "revoke:cs_2:disputed", "code:ev1/cs_2"]);
  });

  it("partial refund only records refundedCents (access kept)", async () => {
    const { stores, calls } = fakeStores([{ eventId: "ev1", purchaseId: "cs_3", ledgerId: "L3" }]);
    await applyChargeReversal(stores, "charge.refunded", { payment_intent: "pi_3", amount: 1000, amount_refunded: 300 });
    assert.deepEqual(calls, ["find:pi_3", "ledger:L3:-:300"]);
  });

  it("no payment intent or unrelated event → nothing touched", async () => {
    const { stores, calls } = fakeStores([]);
    await applyChargeReversal(stores, "charge.refunded", { amount: 1, amount_refunded: 1, refunded: true });
    await applyChargeReversal(stores, "charge.captured", { payment_intent: "pi" });
    assert.deepEqual(calls, []);
  });
});

describe("viewer entitlement ids", () => {
  it("device keys are stable hashes, never the raw cookie", () => {
    const k = deviceKeyFor("2b1e7f0e-1111-4222-8333-944455556666");
    assert.match(k, /^[a-f0-9]{40}$/);
    assert.equal(k, deviceKeyFor("2b1e7f0e-1111-4222-8333-944455556666"));
    assert.ok(!k.includes("2b1e7f0e"));
    assert.equal(ppvDeviceEntitlementId("ev1", k), `ppv_ev1__dev_${k}`);
    assert.equal(ppvAccountEntitlementId("ev1", "uid/../x"), "ppv_ev1__uid_uid____x");
  });

  it("liveness honours revocation and expiry", () => {
    assert.equal(isEntitlementActive({ revokedAt: null, expiresAt: null }, 10), true);
    assert.equal(isEntitlementActive({ revokedAt: 5 }, 10), false);
    assert.equal(isEntitlementActive({ revokedAt: null, expiresAt: 10 }, 10), false);
    assert.equal(isEntitlementActive(null, 10), false);
  });

  it("checkout return paths are restricted to viewer pages", () => {
    assert.equal(safeReturnPath("/live/abc123"), "/live/abc123");
    assert.equal(safeReturnPath("/ppv/ev_1"), "/ppv/ev_1");
    assert.equal(safeReturnPath("https://evil.example/live/x"), null);
    assert.equal(safeReturnPath("//evil.example/live/x"), null);
    assert.equal(safeReturnPath("/settings/billing"), null);
    assert.equal(safeReturnPath("/live/a/../../x"), null);
  });
});
