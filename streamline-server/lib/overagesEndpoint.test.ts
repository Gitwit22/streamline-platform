import test from "node:test";
import assert from "node:assert/strict";
import { createOveragesEndpointHandler } from "./overagesEndpoint";

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

test("non-pro cannot enable overages (403)", async () => {
  const handler = createOveragesEndpointHandler({
    getEntitlements: async () => ({ planId: "starter", features: { overages: false } }),
    getUserDoc: async () => ({
      billingTruth: { stripeCustomerId: "cus_123", status: "active" },
      billingSettings: { overagesEnabled: false },
    }),
    patchUserDoc: async () => {
      throw new Error("should_not_patch");
    },
    retrieveStripeCustomer: async () => ({
      id: "cus_123",
      invoice_settings: { default_payment_method: "pm_123" },
    }),
    now: () => 123,
  });

  const req: any = { user: { uid: "u1" }, body: { enabled: true } };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error, "overages_not_allowed");
});

test("pro can enable overages when customer has default payment method (200)", async () => {
  let patched: any = null;

  const handler = createOveragesEndpointHandler({
    getEntitlements: async () => ({ planId: "pro", features: { overages: true } }),
    getUserDoc: async () => ({
      billingTruth: { stripeCustomerId: "cus_123", status: "active" },
      billingSettings: { overagesEnabled: false },
    }),
    patchUserDoc: async (_uid, patch) => {
      patched = patch;
    },
    retrieveStripeCustomer: async () => ({
      id: "cus_123",
      invoice_settings: { default_payment_method: "pm_123" },
    }),
    now: () => 456,
  });

  const req: any = { user: { uid: "u1" }, body: { enabled: true } };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.success, true);
  assert.equal(res.body?.billingSettings?.overagesEnabled, true);
  assert.ok(patched);
  assert.equal(patched?.billingSettings?.overagesEnabled, true);
});

test("pro enabling fails with 409 when no default payment method", async () => {
  let patched = false;

  const handler = createOveragesEndpointHandler({
    getEntitlements: async () => ({ planId: "pro", features: { overages: true } }),
    getUserDoc: async () => ({
      billingTruth: { stripeCustomerId: "cus_123", status: "active" },
      billingSettings: { overagesEnabled: false },
    }),
    patchUserDoc: async () => {
      patched = true;
    },
    retrieveStripeCustomer: async () => ({
      id: "cus_123",
      invoice_settings: { default_payment_method: null },
      default_source: null,
    }),
    now: () => 789,
  });

  const req: any = { user: { uid: "u1" }, body: { enabled: true } };
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body?.error, "payment_method_required");
  assert.equal(patched, false);
});

test("admin override plan with overages can enable without base plan pro (entitlement-driven)", async () => {
  let patched: any = null;
  const handler = createOveragesEndpointHandler({
    // Base plan free + override to a custom plan that includes overages.
    getEntitlements: async () => ({ planId: "custom_override", features: { overages: true } }),
    getUserDoc: async () => ({ planId: "free", billingTruth: { stripeCustomerId: "cus_1" } }),
    patchUserDoc: async (_uid, patch) => {
      patched = patch;
    },
    retrieveStripeCustomer: async () => ({ id: "cus_1", invoice_settings: { default_payment_method: "pm_1" } }),
    now: () => 1,
  });
  const res = makeRes();
  await handler({ user: { uid: "u1" }, body: { enabled: true } } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(patched?.billingSettings?.overagesEnabled, true);
});

test("turning overages OFF is never blocked by entitlement", async () => {
  let patched: any = null;
  const handler = createOveragesEndpointHandler({
    getEntitlements: async () => {
      throw new Error("should_not_be_called");
    },
    getUserDoc: async () => ({ billingSettings: { overagesEnabled: true } }),
    patchUserDoc: async (_uid, patch) => {
      patched = patch;
    },
    retrieveStripeCustomer: async () => null,
    now: () => 1,
  });
  const res = makeRes();
  await handler({ user: { uid: "u1" }, body: { enabled: false } } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(patched?.billingSettings?.overagesEnabled, false);
});
