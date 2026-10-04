import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_BONUS_CREDIT_ID,
  activeCreditRemaining,
  buildLegacyBonusCredit,
  creditAllowanceMinutes,
  creditStatus,
  isCreditActive,
  needsLegacyBonusMigration,
  normalizeCredit,
  planCreditConsumption,
  planLegacyBonusMigration,
  readCreditMinutesConsumed,
  serializeCredit,
  sortCreditsFifo,
  validateCreditGrant,
  withPendingLegacyCredit,
  type UsageCredit,
} from "./usageCreditsPure";
import { evaluateStreamingGate } from "./streamingMeterPure";

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function credit(id: string, remaining: number, extra: Partial<UsageCredit> = {}): UsageCredit {
  return normalizeCredit(id, {
    amount: extra.amount ?? remaining,
    remaining,
    type: "one_time",
    source: "admin_grant",
    reason: "test",
    createdBy: "admin",
    createdAt: NOW - 10 * DAY,
    ...extra,
  });
}

/** Apply a consumption plan to an in-memory credit list (what the meter tx writes). */
function apply(credits: UsageCredit[], allocations: Array<{ creditId: string; remainingAfter: number }>): UsageCredit[] {
  const byId = new Map(allocations.map((a) => [a.creditId, a.remainingAfter]));
  return credits.map((c) => (byId.has(c.id) ? { ...c, remaining: byId.get(c.id)! } : c));
}

// ---------------------------------------------------------------------------
// Consumption math
// ---------------------------------------------------------------------------

test("owner example: plan 2000 + credit 500, usage 2200 -> credit consumed 200, remaining 300", () => {
  const credits = [credit("c1", 500)];
  const plan = planCreditConsumption({ usedAfter: 2200, includedMinutes: 2000, consumedThisMonth: 0, credits, nowMs: NOW });
  assert.equal(plan.excessOverPlan, 200);
  assert.equal(plan.consumed, 200);
  assert.equal(plan.uncovered, 0);
  assert.deepEqual(plan.allocations, [{ creditId: "c1", minutes: 200, remainingAfter: 300 }]);

  const after = apply(credits, plan.allocations);
  assert.equal(activeCreditRemaining(after, NOW), 300);

  // This month: allowance 2000 + (200 consumed + 300 remaining) = 2500.
  const thisMonth = creditAllowanceMinutes({ usedMinutes: 2200, includedMinutes: 2000, consumedThisMonth: 200, credits: after, nowMs: NOW });
  assert.equal(thisMonth, 500);
  const gate = evaluateStreamingGate({ usedMinutes: 2200, includedMinutes: 2000, bonusMinutes: thisMonth, planAllowsOverages: false, overagesEnabled: false });
  assert.equal(gate.limitMinutes, 2500);
  assert.equal(gate.remainingMinutes, 300);
  assert.equal(gate.allowed, true);

  // Next month: plan allowance resets, credit remaining carries over -> 2000 + 300.
  const nextMonth = creditAllowanceMinutes({ usedMinutes: 0, includedMinutes: 2000, consumedThisMonth: 0, credits: after, nowMs: NOW + 31 * DAY });
  assert.equal(nextMonth, 300);
  const nextGate = evaluateStreamingGate({ usedMinutes: 0, includedMinutes: 2000, bonusMinutes: nextMonth, planAllowsOverages: false, overagesEnabled: false });
  assert.equal(nextGate.limitMinutes, 2300);
});

test("incremental bills consume only the new excess (no double consumption)", () => {
  let credits = [credit("c1", 500)];
  let consumed = 0;
  // Bills arrive as usage crosses 1990 -> 2050 -> 2200.
  for (const usedAfter of [1990, 2050, 2200]) {
    const plan = planCreditConsumption({ usedAfter, includedMinutes: 2000, consumedThisMonth: consumed, credits, nowMs: NOW });
    credits = apply(credits, plan.allocations);
    consumed += plan.consumed;
  }
  assert.equal(consumed, 200);
  assert.equal(credits[0].remaining, 300);
  // Re-running the last bill state (idempotent: nothing new over plan).
  const again = planCreditConsumption({ usedAfter: 2200, includedMinutes: 2000, consumedThisMonth: consumed, credits, nowMs: NOW });
  assert.equal(again.consumed, 0);
});

test("a skipped bill is caught up by the next one (self-healing)", () => {
  const credits = [credit("c1", 500)];
  // Bill at 2100 skipped consumption (consumedThisMonth stayed 0); next bill at 2150.
  const plan = planCreditConsumption({ usedAfter: 2150, includedMinutes: 2000, consumedThisMonth: 0, credits, nowMs: NOW });
  assert.equal(plan.consumed, 150);
});

test("under the plan allowance nothing is consumed", () => {
  const plan = planCreditConsumption({ usedAfter: 1999, includedMinutes: 2000, consumedThisMonth: 0, credits: [credit("c1", 500)], nowMs: NOW });
  assert.equal(plan.consumed, 0);
  assert.deepEqual(plan.allocations, []);
});

test("unlimited plan (null) never consumes credits", () => {
  const plan = planCreditConsumption({ usedAfter: 99999, includedMinutes: null, consumedThisMonth: 0, credits: [credit("c1", 500)], nowMs: NOW });
  assert.equal(plan.consumed, 0);
  assert.equal(creditAllowanceMinutes({ usedMinutes: 5, includedMinutes: null, consumedThisMonth: 0, credits: [credit("c1", 500)], nowMs: NOW }), 500);
});

test("plan with 0 included minutes: all usage comes from credits", () => {
  const plan = planCreditConsumption({ usedAfter: 30, includedMinutes: 0, consumedThisMonth: 0, credits: [credit("c1", 100)], nowMs: NOW });
  assert.equal(plan.consumed, 30);
  assert.equal(plan.allocations[0].remainingAfter, 70);
});

test("credits exhausted -> uncovered minutes remain (overage / block territory)", () => {
  const plan = planCreditConsumption({ usedAfter: 2600, includedMinutes: 2000, consumedThisMonth: 0, credits: [credit("c1", 500)], nowMs: NOW });
  assert.equal(plan.consumed, 500);
  assert.equal(plan.uncovered, 100);
  const after = apply([credit("c1", 500)], plan.allocations);
  const allowance = creditAllowanceMinutes({ usedMinutes: 2600, includedMinutes: 2000, consumedThisMonth: 500, credits: after, nowMs: NOW });
  assert.equal(allowance, 500);
  const gate = evaluateStreamingGate({ usedMinutes: 2600, includedMinutes: 2000, bonusMinutes: allowance, planAllowsOverages: true, overagesEnabled: true });
  assert.equal(gate.overageMinutes, 100);
  const blocked = evaluateStreamingGate({ usedMinutes: 2600, includedMinutes: 2000, bonusMinutes: allowance, planAllowsOverages: false, overagesEnabled: false });
  assert.equal(blocked.allowed, false);
});

test("mid-month plan upgrade does not turn consumed credit into extra allowance", () => {
  const after = [credit("c1", 300, { amount: 500 })];
  // Consumed 200 on a 2000 plan; upgraded to 5000 with usage 2200.
  const allowance = creditAllowanceMinutes({ usedMinutes: 2200, includedMinutes: 5000, consumedThisMonth: 200, credits: after, nowMs: NOW });
  assert.equal(allowance, 300);
});

// ---------------------------------------------------------------------------
// FIFO + expiry + revocation
// ---------------------------------------------------------------------------

test("FIFO: earliest expiry first, never-expiring last, then oldest createdAt", () => {
  const credits = [
    credit("forever-old", 100, { createdAt: NOW - 100 * DAY }),
    credit("expires-late", 100, { expiresAt: NOW + 60 * DAY }),
    credit("expires-soon", 100, { expiresAt: NOW + 5 * DAY }),
    credit("forever-new", 100, { createdAt: NOW - 1 * DAY }),
  ];
  assert.deepEqual(
    sortCreditsFifo(credits).map((c) => c.id),
    ["expires-soon", "expires-late", "forever-old", "forever-new"]
  );
  const plan = planCreditConsumption({ usedAfter: 250, includedMinutes: 0, consumedThisMonth: 0, credits, nowMs: NOW });
  assert.deepEqual(
    plan.allocations.map((a) => [a.creditId, a.minutes]),
    [
      ["expires-soon", 100],
      ["expires-late", 100],
      ["forever-old", 50],
    ]
  );
});

test("expired and revoked credits are neither counted nor consumed", () => {
  const credits = [
    credit("expired", 100, { expiresAt: NOW - 1 }),
    credit("revoked", 100, { revokedAt: NOW - DAY }),
    credit("ok", 40),
  ];
  assert.equal(activeCreditRemaining(credits, NOW), 40);
  assert.equal(isCreditActive(credits[0], NOW), false);
  assert.equal(creditStatus(credits[0], NOW), "expired");
  assert.equal(creditStatus(credits[1], NOW), "revoked");
  assert.equal(creditStatus(credits[2], NOW), "active");
  const plan = planCreditConsumption({ usedAfter: 100, includedMinutes: 0, consumedThisMonth: 0, credits, nowMs: NOW });
  assert.deepEqual(plan.allocations.map((a) => a.creditId), ["ok"]);
  assert.equal(plan.uncovered, 60);
});

test("expiry boundary: a credit expiring exactly now is inactive", () => {
  assert.equal(isCreditActive(credit("x", 10, { expiresAt: NOW }), NOW), false);
  assert.equal(isCreditActive(credit("x", 10, { expiresAt: NOW + 1 }), NOW), true);
});

test("recurring credits are modeled but never active (not implemented)", () => {
  const c = normalizeCredit("r", { amount: 100, remaining: 100, type: "recurring", recurrence: "monthly", createdAt: NOW });
  assert.equal(c.type, "recurring");
  assert.equal(isCreditActive(c, NOW), false);
  assert.equal(creditStatus(c, NOW), "unsupported");
});

test("readCreditMinutesConsumed reads usage.creditMinutesConsumed", () => {
  assert.equal(readCreditMinutesConsumed({ usage: { creditMinutesConsumed: 42 } }), 42);
  assert.equal(readCreditMinutesConsumed({}), 0);
  assert.equal(readCreditMinutesConsumed(null), 0);
});

// ---------------------------------------------------------------------------
// Legacy users.bonusMinutes migration
// ---------------------------------------------------------------------------

/** In-memory model of the migration transaction (user doc + legacy credit doc). */
function runMigration(state: { user: any; legacy: any | null }, nowMs: number) {
  const plan = planLegacyBonusMigration(state.user, state.legacy !== null, nowMs);
  if (plan.creditDoc) state.legacy = plan.creditDoc;
  if (plan.userPatch) state.user = { ...state.user, ...plan.userPatch };
  return plan;
}

test("migration: bonusMinutes -> one_time credit, bonusMinutes zeroed, idempotent", () => {
  const state = { user: { bonusMinutes: 120 } as any, legacy: null as any };
  assert.equal(needsLegacyBonusMigration(state.user), true);

  const first = runMigration(state, NOW);
  assert.ok(first.creditDoc);
  assert.equal(state.legacy.id, LEGACY_BONUS_CREDIT_ID);
  assert.equal(state.legacy.amount, 120);
  assert.equal(state.legacy.remaining, 120);
  assert.equal(state.legacy.type, "one_time");
  assert.equal(state.legacy.source, "legacy_bonus");
  assert.equal(state.user.bonusMinutes, 0);
  assert.equal(state.user.bonusMinutesMigratedAt, NOW);

  // Second run (another request / retry): no writes, credit unchanged.
  const legacyBefore = { ...state.legacy };
  const second = runMigration(state, NOW + 1000);
  assert.equal(second.creditDoc, null);
  assert.equal(second.userPatch, null);
  assert.deepEqual(state.legacy, legacyBefore);
  assert.equal(needsLegacyBonusMigration(state.user), false);
});

test("migration: credit doc already exists -> only the user patch (never a second credit)", () => {
  const state = { user: { bonusMinutes: 50 } as any, legacy: { id: LEGACY_BONUS_CREDIT_ID, amount: 50, remaining: 10 } as any };
  const plan = runMigration(state, NOW);
  assert.equal(plan.creditDoc, null);
  assert.equal(state.legacy.remaining, 10);
  assert.equal(state.user.bonusMinutes, 0);
});

test("migration: nothing to migrate for 0 / missing / already-migrated bonus", () => {
  assert.equal(needsLegacyBonusMigration({}), false);
  assert.equal(needsLegacyBonusMigration({ bonusMinutes: 0 }), false);
  assert.equal(needsLegacyBonusMigration({ bonusMinutes: "abc" }), false);
  assert.equal(needsLegacyBonusMigration({ bonusMinutes: 30, bonusMinutesMigratedAt: NOW }), false);
  assert.equal(buildLegacyBonusCredit({ bonusMinutes: 0 }, NOW), null);
});

test("read-only views count un-migrated bonus once (virtual credit)", () => {
  const user = { bonusMinutes: 60 };
  const withLegacy = withPendingLegacyCredit([credit("c1", 40)], user, NOW);
  assert.equal(activeCreditRemaining(withLegacy, NOW), 100);
  // Already stored: not added twice.
  const stored = withPendingLegacyCredit([credit(LEGACY_BONUS_CREDIT_ID, 60)], user, NOW);
  assert.equal(stored.length, 1);
});

// ---------------------------------------------------------------------------
// Admin grant validation
// ---------------------------------------------------------------------------

test("validateCreditGrant: numeric validation (no more untyped minutes)", () => {
  assert.equal(validateCreditGrant({ minutes: 60, reason: "promo" }, NOW).ok, true);
  assert.equal(validateCreditGrant({ minutes: "60", reason: "promo" }, NOW).value?.amount, 60);
  for (const bad of [0, -5, 1.5, "1e3", "abc", "", null, undefined, NaN, Infinity, "60m", true, [60], { n: 1 }]) {
    const r = validateCreditGrant({ minutes: bad, reason: "x" }, NOW);
    assert.equal(r.ok, false, `expected rejection for ${String(bad)}`);
    assert.equal(r.error, "invalid_minutes");
  }
  assert.equal(validateCreditGrant({ minutes: 2_000_000, reason: "x" }, NOW).ok, false);
});

test("validateCreditGrant: reason required, expiry must be future, recurring rejected", () => {
  assert.equal(validateCreditGrant({ minutes: 10 }, NOW).error, "reason_required");
  assert.equal(validateCreditGrant({ minutes: 10, reason: "x", expiresAt: NOW - 1 }, NOW).error, "invalid_expiry");
  assert.equal(validateCreditGrant({ minutes: 10, reason: "x", expiresAt: "not a date" }, NOW).error, "invalid_expiry");
  const iso = new Date(NOW + 30 * DAY).toISOString();
  assert.equal(validateCreditGrant({ minutes: 10, reason: "x", expiresAt: iso }, NOW).value?.expiresAt, NOW + 30 * DAY);
  assert.equal(validateCreditGrant({ minutes: 10, reason: "x", type: "recurring" }, NOW).error, "recurring_credits_not_supported");
  assert.equal(validateCreditGrant({ minutes: 10, reason: "x", type: "weird" }, NOW).error, "invalid_type");
});

test("serializeCredit exposes ISO dates and status", () => {
  const s = serializeCredit(credit("c1", 0, { amount: 100, consumedMinutes: 100 }), NOW);
  assert.equal(s.status, "depleted");
  assert.equal(s.consumedMinutes, 100);
  assert.equal(typeof s.createdAt, "string");
  assert.equal(s.expiresAt, null);
});
