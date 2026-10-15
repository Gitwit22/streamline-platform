import test from "node:test";
import assert from "node:assert/strict";
import { testPlanChangeRefusal } from "./testPlanChangePure";

test("test-mode plan switch: non-admins are always refused", () => {
  for (const billing of [false, true, null, undefined]) {
    assert.deepEqual(testPlanChangeRefusal({ isPlatformAdmin: false, effectiveBillingEnabled: billing }), {
      status: 403,
      error: "insufficient_permissions",
    });
  }
});

test("test-mode plan switch: admins only while billing is off", () => {
  assert.equal(testPlanChangeRefusal({ isPlatformAdmin: true, effectiveBillingEnabled: false }), null);
  assert.deepEqual(testPlanChangeRefusal({ isPlatformAdmin: true, effectiveBillingEnabled: true }), { status: 403, error: "billing_live" });
  assert.deepEqual(testPlanChangeRefusal({ isPlatformAdmin: true, effectiveBillingEnabled: undefined }), { status: 403, error: "billing_live" });
});
