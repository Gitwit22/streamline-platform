import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getSubscriptionPeriodEnd,
  getSubscriptionPeriodStart,
  getInvoiceSubscriptionId,
  getInvoiceSubscriptionMetadata,
  isTerminalSubscriptionStatus,
} from "./stripeFields";

describe("getSubscriptionPeriodEnd / Start", () => {
  it("reads from the first item (clover API)", () => {
    const sub = { items: { data: [{ current_period_end: 200, current_period_start: 100 }] } };
    assert.equal(getSubscriptionPeriodEnd(sub), 200);
    assert.equal(getSubscriptionPeriodStart(sub), 100);
  });

  it("falls back to top-level fields (legacy API)", () => {
    const sub = { current_period_end: 300, current_period_start: 250, items: { data: [{}] } };
    assert.equal(getSubscriptionPeriodEnd(sub), 300);
    assert.equal(getSubscriptionPeriodStart(sub), 250);
  });

  it("prefers item fields over top-level", () => {
    const sub = { current_period_end: 1, items: { data: [{ current_period_end: 2 }] } };
    assert.equal(getSubscriptionPeriodEnd(sub), 2);
  });

  it("returns null when absent or malformed", () => {
    assert.equal(getSubscriptionPeriodEnd(null), null);
    assert.equal(getSubscriptionPeriodEnd({}), null);
    assert.equal(getSubscriptionPeriodEnd({ current_period_end: "123" }), null);
    assert.equal(getSubscriptionPeriodStart(undefined), null);
  });
});

describe("getInvoiceSubscriptionId", () => {
  it("reads parent.subscription_details.subscription (clover API)", () => {
    const inv = { parent: { subscription_details: { subscription: "sub_new" } } };
    assert.equal(getInvoiceSubscriptionId(inv), "sub_new");
  });

  it("accepts an expanded subscription object", () => {
    const inv = { parent: { subscription_details: { subscription: { id: "sub_obj" } } } };
    assert.equal(getInvoiceSubscriptionId(inv), "sub_obj");
  });

  it("falls back to invoice.subscription (legacy API)", () => {
    assert.equal(getInvoiceSubscriptionId({ subscription: "sub_old" }), "sub_old");
    assert.equal(getInvoiceSubscriptionId({ subscription: { id: "sub_old2" } }), "sub_old2");
  });

  it("returns null when not a subscription invoice", () => {
    assert.equal(getInvoiceSubscriptionId({}), null);
    assert.equal(getInvoiceSubscriptionId({ parent: { subscription_details: null } }), null);
    assert.equal(getInvoiceSubscriptionId(null), null);
  });
});

describe("getInvoiceSubscriptionMetadata", () => {
  it("prefers parent.subscription_details.metadata", () => {
    const inv = {
      metadata: { userId: "invoice-level" },
      parent: { subscription_details: { metadata: { userId: "u1" } } },
    };
    assert.deepEqual(getInvoiceSubscriptionMetadata(inv), { userId: "u1" });
  });

  it("falls back to invoice.metadata", () => {
    assert.deepEqual(getInvoiceSubscriptionMetadata({ metadata: { userId: "u2" } }), { userId: "u2" });
  });

  it("returns {} when absent", () => {
    assert.deepEqual(getInvoiceSubscriptionMetadata({}), {});
    assert.deepEqual(getInvoiceSubscriptionMetadata(null), {});
  });
});

describe("isTerminalSubscriptionStatus", () => {
  it("treats unpaid/canceled/incomplete_expired as terminal", () => {
    assert.equal(isTerminalSubscriptionStatus("unpaid"), true);
    assert.equal(isTerminalSubscriptionStatus("canceled"), true);
    assert.equal(isTerminalSubscriptionStatus("incomplete_expired"), true);
  });

  it("keeps the plan while Stripe is still retrying", () => {
    for (const s of ["active", "trialing", "past_due", "incomplete", "paused", undefined]) {
      assert.equal(isTerminalSubscriptionStatus(s), false);
    }
  });
});
