import test from "node:test";
import assert from "node:assert/strict";
import { computeOverage, evaluateUsageGate } from "./usageOverages";
import { normalizePlan } from "./normalizePlan";
import { LIMIT_ERRORS } from "./limitErrors";

test("computeOverage returns 0 for unlimited/invalid", () => {
  assert.equal(computeOverage(0, 999), 0);
  assert.equal(computeOverage(-1, 999), 0);
  assert.equal(computeOverage(Number.NaN as any, 999), 0);
  assert.equal(computeOverage(100, "oops" as any), 0);
});

test("computeOverage returns positive delta when exceeded", () => {
  assert.equal(computeOverage(100, 100), 0);
  assert.equal(computeOverage(100, 101), 1);
  assert.equal(computeOverage(100, 125), 25);
});

test("normalizePlan defaults allowsOverages for pro and internal_unlimited", () => {
  assert.equal(normalizePlan("starter", {}).features.allowsOverages, false);
  assert.equal(normalizePlan("free", {}).features.allowsOverages, false);
  assert.equal(normalizePlan("pro", {}).features.allowsOverages, true);
  assert.equal(normalizePlan("internal_unlimited", {}).features.allowsOverages, true);
});

test("normalizePlan honors explicit overage flags", () => {
  assert.equal(normalizePlan("starter", { features: { allowsOverages: true } }).features.allowsOverages, true);
  assert.equal(normalizePlan("pro", { features: { allowsOverages: false } }).features.allowsOverages, false);

  // Legacy alias
  assert.equal(normalizePlan("starter", { features: { overagesAllowed: true } }).features.allowsOverages, true);
});

test("evaluateUsageGate blocks non-overage plans at or above limit", () => {
  const decision = evaluateUsageGate({
    allowsOverages: false,
    limits: { participantMinutes: 100, transcodeMinutes: 50 },
    usage: { participantMinutes: 100, transcodeMinutes: 0 },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, LIMIT_ERRORS.USAGE_EXHAUSTED);
  assert.equal(decision.requiresUpgrade, true);
});

test("evaluateUsageGate allows Pro at limit but only logs after exceeding", () => {
  const atLimit = evaluateUsageGate({
    allowsOverages: true,
    limits: { participantMinutes: 100, transcodeMinutes: 50 },
    usage: { participantMinutes: 100, transcodeMinutes: 0 },
  });
  assert.equal(atLimit.allowed, true);
  assert.equal(atLimit.shouldLogOverages, false);

  const exceeded = evaluateUsageGate({
    allowsOverages: true,
    limits: { participantMinutes: 100, transcodeMinutes: 50 },
    usage: { participantMinutes: 120, transcodeMinutes: 55 },
  });
  assert.equal(exceeded.allowed, true);
  assert.equal(exceeded.shouldLogOverages, true);
  assert.deepEqual(exceeded.overageTotals, { participantMinutes: 20, transcodeMinutes: 5 });
});

test("evaluateUsageGate treats zero limits as unlimited (never blocks)", () => {
  const highUsageZeroLimit = evaluateUsageGate({
    allowsOverages: false,
    limits: { participantMinutes: 0, transcodeMinutes: 0 },
    usage: { participantMinutes: 999999, transcodeMinutes: 999999 },
  });
  assert.equal(highUsageZeroLimit.allowed, true);
});

test("normalizePlan internal_unlimited allows overages even when over limit", () => {
  const plan = normalizePlan("internal_unlimited", {
    limits: { monthlyMinutes: 99999, transcodeMinutes: 99999 },
  });
  assert.equal(plan.features.allowsOverages, true);

  const decision = evaluateUsageGate({
    allowsOverages: plan.features.allowsOverages,
    limits: {
      participantMinutes: plan.limits.monthlyMinutes,
      transcodeMinutes: Number(plan.limits.transcodeMinutes || 0),
    },
    usage: { participantMinutes: 100000, transcodeMinutes: 100000 },
  });
  assert.equal(decision.allowed, true);
});
