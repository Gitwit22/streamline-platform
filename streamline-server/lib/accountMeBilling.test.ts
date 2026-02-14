import test from "node:test";
import assert from "node:assert/strict";
import { computeAccountMeBillingFields } from "./billingTruth";

// This test protects the invariant that /api/account/me always returns
// a stable billingTruth object, even for legacy user docs.

test("legacy user missing planId + billingTruth -> account/me billingTruth.status=free and planId=free", () => {
  const legacyUserDoc = {
    email: "legacy@example.com",
    // no planId
    // no billingTruth
    billingStatus: "none",
  };

  const { planId, billingTruth } = computeAccountMeBillingFields(legacyUserDoc, undefined, 123);

  assert.equal(planId, "free");
  assert.equal(billingTruth.planId, "free");
  assert.equal(billingTruth.status, "free");
  assert.equal(billingTruth.stripeCustomerId, null);
  assert.equal(billingTruth.subscriptionId, null);
  assert.equal(billingTruth.cancelAtPeriodEnd, false);
});
