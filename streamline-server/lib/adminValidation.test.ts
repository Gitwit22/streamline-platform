import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Re-implement the pure validation logic from admin routes / middleware ──
// This avoids importing modules that depend on Firebase.

/** featureName validation used by POST /api/admin/features/toggle */
function isValidFeatureName(name: unknown): boolean {
  return typeof name === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(name);
}

/** planId validation used by PUT /api/admin/plans/:planId */
function isValidPlanId(id: unknown): boolean {
  return typeof id === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(id);
}

/** getJwtSecret logic – rejects dev-secret in prod/staging */
function getJwtSecret(envSecret: string, nodeEnv: string): string {
  const raw = String(envSecret || "").trim();
  const env = String(nodeEnv || "development").toLowerCase();
  if ((env === "production" || env === "staging") && (!raw || raw === "dev-secret")) {
    throw new Error("Missing JWT_SECRET (no dev-secret in production)");
  }
  return raw || "dev-secret";
}

// ── featureName validation ──
describe("featureName validation", () => {
  it("accepts simple alphanumeric names", () => {
    assert.ok(isValidFeatureName("recording"));
    assert.ok(isValidFeatureName("hlsSettingsTab"));
    assert.ok(isValidFeatureName("dual_recording"));
    assert.ok(isValidFeatureName("my-flag"));
  });

  it("accepts single character name", () => {
    assert.ok(isValidFeatureName("x"));
  });

  it("rejects empty or missing values", () => {
    assert.ok(!isValidFeatureName(""));
    assert.ok(!isValidFeatureName(null));
    assert.ok(!isValidFeatureName(undefined));
    assert.ok(!isValidFeatureName(123));
  });

  it("rejects names starting with a digit or underscore", () => {
    assert.ok(!isValidFeatureName("1bad"));
    assert.ok(!isValidFeatureName("_bad"));
    assert.ok(!isValidFeatureName("-bad"));
  });

  it("rejects names with special characters or slashes", () => {
    assert.ok(!isValidFeatureName("bad/flag"));
    assert.ok(!isValidFeatureName("bad.flag"));
    assert.ok(!isValidFeatureName("bad flag"));
    assert.ok(!isValidFeatureName("bad$flag"));
    assert.ok(!isValidFeatureName("../traversal"));
  });

  it("rejects names exceeding 80 characters", () => {
    const long = "a" + "b".repeat(80);
    assert.ok(!isValidFeatureName(long));
  });
});

// ── planId validation ──
describe("planId validation", () => {
  it("accepts known plan identifiers", () => {
    assert.ok(isValidPlanId("free"));
    assert.ok(isValidPlanId("starter"));
    assert.ok(isValidPlanId("pro"));
    assert.ok(isValidPlanId("enterprise"));
    assert.ok(isValidPlanId("internal_unlimited"));
  });

  it("rejects empty or missing values", () => {
    assert.ok(!isValidPlanId(""));
    assert.ok(!isValidPlanId(null));
    assert.ok(!isValidPlanId(undefined));
  });

  it("rejects paths or special characters", () => {
    assert.ok(!isValidPlanId("../admin"));
    assert.ok(!isValidPlanId("bad/plan"));
    assert.ok(!isValidPlanId("bad plan"));
  });

  it("rejects names exceeding 40 characters", () => {
    const long = "a" + "b".repeat(40);
    assert.ok(!isValidPlanId(long));
  });
});

// ── getJwtSecret ──
describe("getJwtSecret", () => {
  it("returns the secret when set", () => {
    assert.equal(getJwtSecret("my-real-secret", "production"), "my-real-secret");
  });

  it("falls back to dev-secret in development", () => {
    assert.equal(getJwtSecret("", "development"), "dev-secret");
  });

  it("throws when dev-secret is used in production", () => {
    assert.throws(
      () => getJwtSecret("dev-secret", "production"),
      /Missing JWT_SECRET/
    );
  });

  it("throws when secret is empty in production", () => {
    assert.throws(
      () => getJwtSecret("", "production"),
      /Missing JWT_SECRET/
    );
  });

  it("throws when dev-secret is used in staging", () => {
    assert.throws(
      () => getJwtSecret("dev-secret", "staging"),
      /Missing JWT_SECRET/
    );
  });
});
