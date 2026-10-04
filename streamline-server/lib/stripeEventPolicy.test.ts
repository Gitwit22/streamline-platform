import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canReclaimStripeEvent, isAlreadyExists } from "./stripeEventPolicy";

describe("canReclaimStripeEvent", () => {
  const now = 1_000_000_000;

  it("processes when no marker exists", () => {
    assert.equal(canReclaimStripeEvent(null, now), true);
  });

  it("skips events already done", () => {
    assert.equal(canReclaimStripeEvent({ status: "done", startedAt: now - 10 }, now), false);
  });

  it("skips events in flight", () => {
    assert.equal(canReclaimStripeEvent({ status: "processing", startedAt: now - 1000 }, now), false);
  });

  it("reclaims stale processing markers", () => {
    assert.equal(canReclaimStripeEvent({ status: "processing", startedAt: now - 6 * 60 * 1000 }, now), true);
  });

  it("reclaims markers with any other status", () => {
    assert.equal(canReclaimStripeEvent({ status: "failed", startedAt: now }, now), true);
  });
});

describe("isAlreadyExists", () => {
  it("recognizes Firestore ALREADY_EXISTS errors", () => {
    assert.equal(isAlreadyExists({ code: 6 }), true);
    assert.equal(isAlreadyExists({ code: "already-exists" }), true);
    assert.equal(isAlreadyExists({ message: "6 ALREADY_EXISTS: Document already exists" }), true);
    assert.equal(isAlreadyExists({ code: 14, message: "UNAVAILABLE" }), false);
    assert.equal(isAlreadyExists(null), false);
  });
});
