import test from "node:test";
import assert from "node:assert/strict";
import { buildNewUserDoc } from "./newUserDefaults";

test("buildNewUserDoc: billing defaults enabled", () => {
  const user = buildNewUserDoc({
    email: "test@example.com",
    passwordHash: "hash",
    displayName: "Test",
    timeZone: "America/Chicago",
    nowMs: 1700000000000,
    tosAcceptedIp: "127.0.0.1",
    tosUserAgent: "node-test",
  });

  assert.equal(user.planId, "free");
  assert.equal(user.billingEnabled, true);
  assert.equal(user.billingActive, false);
  assert.equal(user.billingStatus, "free");

  assert.ok(user.billingTruth);
  assert.equal(user.billingTruth.planId, "free");
  assert.equal(user.billingTruth.status, "free");
  assert.equal(user.billingTruth.subscriptionId, null);

  assert.equal(user.tosVersion.length > 0, true);
  assert.equal(user.tosAcceptedAt, 1700000000000);
});
