import test from "node:test";
import assert from "node:assert/strict";
import { computeOverage } from "./usageOverages";
import { evaluateStreamingGate } from "./streamingMeterPure";
import { normalizePlan } from "./normalizePlan";

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

test("normalizePlan internal_unlimited allows overages even when over limit", () => {
  const plan = normalizePlan("internal_unlimited", {
    limits: { monthlyMinutes: 99999, transcodeMinutes: 99999 },
  });
  assert.equal(plan.features.allowsOverages, true);

  const decision = evaluateStreamingGate({
    usedMinutes: 100000,
    includedMinutes: plan.limits.monthlyMinutes,
    planAllowsOverages: plan.features.allowsOverages,
    overagesEnabled: true,
  });
  assert.equal(decision.allowed, true);
});
