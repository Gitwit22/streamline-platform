import test from "node:test";
import assert from "node:assert/strict";
import {
  DELETION_PURGE_WINDOW_MS,
  parseDeletionRequest,
  readSubscriptionId,
  runAccountDeletion,
  summarizeDeletionOutcome,
  type DeletionDeps,
  type DeletionOptions,
  type StripeCancelResult,
} from "./accountDeletionCore";
import { evaluateRestore, shapeDeletionImpact, shapeSubscriptionImpact } from "./deletionImpact";

const NOW = Date.UTC(2026, 9, 4, 10, 0, 0);
const ALL_ON: DeletionOptions = { cancelStripe: true, revokeSessions: true, scheduleMediaDeletion: true };

type Calls = {
  patches: Array<Record<string, any>>;
  canceled: string[];
  revoked: string[];
  disabled: string[];
  audits: Array<Record<string, any>>;
};

function fakeDeps(
  user: any,
  opts: {
    stripe?: StripeCancelResult | Error;
    revokeFails?: boolean;
    disableAuthFails?: boolean;
    patchFailsOn?: (patch: Record<string, any>) => boolean;
  } = {}
): { deps: DeletionDeps; calls: Calls } {
  const calls: Calls = { patches: [], canceled: [], revoked: [], disabled: [], audits: [] };
  const deps: DeletionDeps = {
    now: () => NOW,
    loadUser: async () => user,
    cancelSubscription: async (id) => {
      calls.canceled.push(id);
      if (opts.stripe instanceof Error) throw opts.stripe;
      return opts.stripe ?? { status: "canceled", subscriptionId: id };
    },
    patchUser: async (_uid, patch) => {
      if (opts.patchFailsOn?.(patch)) throw new Error("firestore down");
      calls.patches.push(patch);
    },
    revokeAuthTokens: async (uid) => {
      if (opts.revokeFails) throw new Error("revoke failed");
      calls.revoked.push(uid);
    },
    disableAuthUser: async (uid) => {
      if (opts.disableAuthFails) throw new Error("auth down");
      calls.disabled.push(uid);
    },
    audit: async (event) => {
      calls.audits.push(event);
    },
  };
  return { deps, calls };
}

const req = (options: DeletionOptions = ALL_ON) => ({
  uid: "u1",
  actor: { type: "admin" as const, uid: "admin1" },
  options,
  reason: "admin_deleted",
});

const PAYING = { email: "a@b.c", planId: "pro", billing: { subscriptionId: "sub_123" } };

test("happy path: Stripe canceled -> sessions revoked -> disabled -> cleanup queued -> audited", async () => {
  const { deps, calls } = fakeDeps(PAYING);
  const r = await runAccountDeletion(deps, req());
  assert.equal(r.outcome, "completed");
  assert.equal(r.httpStatus, 200);
  assert.deepEqual(calls.canceled, ["sub_123"]);
  assert.deepEqual(calls.revoked, ["u1"]);
  assert.deepEqual(calls.disabled, ["u1"]);
  assert.equal(r.steps.stripe.status, "canceled");
  assert.equal(r.deletedAtMs, NOW);
  assert.equal(r.deleteAfterMs, NOW + DELETION_PURGE_WINDOW_MS);
  // Order: revoke patch, then the soft-delete patch, then the cleanup patch.
  assert.equal(calls.patches[0].authRevokedAtMs, NOW);
  assert.equal(calls.patches[1].accountStatus, "deleted");
  assert.equal(calls.patches[1].subscriptionCanceledOnDeletionAtMs, NOW);
  assert.equal(calls.patches[2].deleteAfterMs, NOW + DELETION_PURGE_WINDOW_MS);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].outcome, "completed");
});

test("Stripe cancellation FAILS -> account NOT disabled, outcome failed (502), audited", async () => {
  const { deps, calls } = fakeDeps(PAYING, { stripe: { status: "failed", subscriptionId: "sub_123", error: "card_error" } });
  const r = await runAccountDeletion(deps, req());
  assert.equal(r.outcome, "failed");
  assert.equal(r.httpStatus, 502);
  assert.equal(r.error, "stripe_cancel_failed");
  assert.equal(calls.patches.length, 0, "no Firestore writes to the user");
  assert.equal(calls.revoked.length, 0);
  assert.equal(calls.disabled.length, 0);
  assert.equal(r.deletedAtMs, null);
  assert.equal(r.deleteAfterMs, null);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].outcome, "failed");
  assert.match(r.message, /NOT deleted/);
});

test("Stripe client throws -> same as failure (no disable)", async () => {
  const { deps, calls } = fakeDeps(PAYING, { stripe: new Error("network") });
  const r = await runAccountDeletion(deps, req());
  assert.equal(r.outcome, "failed");
  assert.equal(r.steps.stripe.status, "failed");
  assert.equal(calls.disabled.length, 0);
  assert.equal(calls.patches.length, 0);
});

test("admin retries with cancelStripe unchecked -> deletes, Stripe untouched and recorded as skipped", async () => {
  const { deps, calls } = fakeDeps(PAYING);
  const r = await runAccountDeletion(deps, req({ ...ALL_ON, cancelStripe: false }));
  assert.equal(r.outcome, "completed");
  assert.equal(calls.canceled.length, 0);
  assert.equal(r.steps.stripe.status, "skipped");
  assert.equal(r.steps.stripe.subscriptionId, "sub_123");
  assert.equal(calls.audits[0].options.cancelStripe, false);
});

test("already-canceled / unknown subscriptions do not block deletion", async () => {
  for (const status of ["already_canceled", "not_found"] as const) {
    const { deps } = fakeDeps(PAYING, { stripe: { status, subscriptionId: "sub_123" } });
    const r = await runAccountDeletion(deps, req());
    assert.equal(r.outcome, "completed", status);
  }
  const { deps, calls } = fakeDeps({ planId: "free" });
  const r = await runAccountDeletion(deps, req());
  assert.equal(r.steps.stripe.status, "no_subscription");
  assert.equal(calls.canceled.length, 0);
  assert.equal(r.outcome, "completed");
});

test("session revoke failure -> partial (207), account still disabled", async () => {
  const { deps, calls } = fakeDeps(PAYING, { revokeFails: true });
  const r = await runAccountDeletion(deps, req());
  assert.equal(r.outcome, "partial");
  assert.equal(r.httpStatus, 207);
  assert.equal(r.steps.sessions.status, "failed");
  assert.equal(calls.disabled.length, 1);
});

test("Firebase disable failure -> partial (Firestore soft delete still locks the account)", async () => {
  const { deps } = fakeDeps(PAYING, { disableAuthFails: true });
  const r = await runAccountDeletion(deps, req());
  assert.equal(r.outcome, "partial");
  assert.equal(r.steps.disable.status, "ok");
  assert.equal(r.steps.disable.detail, "firebase_disable_failed");
});

test("Firestore soft-delete write fails -> failed (500), no cleanup queued", async () => {
  const { deps, calls } = fakeDeps(PAYING, { patchFailsOn: (p) => p.accountStatus === "deleted" });
  const r = await runAccountDeletion(deps, req());
  assert.equal(r.outcome, "failed");
  assert.equal(r.httpStatus, 500);
  assert.equal(r.error, "disable_failed");
  assert.ok(!calls.patches.some((p) => "deleteAfterMs" in p));
});

test("scheduleMediaDeletion unchecked -> no deleteAfterMs (purge never runs), media retained", async () => {
  const { deps, calls } = fakeDeps(PAYING);
  const r = await runAccountDeletion(deps, req({ ...ALL_ON, scheduleMediaDeletion: false }));
  assert.equal(r.outcome, "completed");
  assert.equal(r.deleteAfterMs, null);
  assert.equal(r.steps.cleanup.detail, "media_retained");
  const cleanupPatch = calls.patches.find((p) => "dataCleanup" in p)!;
  assert.equal(cleanupPatch.deleteAfterMs, null);
  assert.equal(cleanupPatch.dataCleanup.scheduled, false);
});

test("revokeSessions unchecked -> no revoke calls", async () => {
  const { deps, calls } = fakeDeps(PAYING);
  const r = await runAccountDeletion(deps, req({ ...ALL_ON, revokeSessions: false }));
  assert.equal(r.steps.sessions.status, "skipped");
  assert.equal(calls.revoked.length, 0);
  assert.ok(!calls.patches.some((p) => "authRevokedAtMs" in p));
});

test("missing user -> 404 and nothing else", async () => {
  const { deps, calls } = fakeDeps(null);
  const r = await runAccountDeletion(deps, req());
  assert.equal(r.httpStatus, 404);
  assert.equal(calls.audits.length, 0);
});

test("re-running on an already deleted account keeps the original deletedAtMs", async () => {
  const { deps, calls } = fakeDeps({ ...PAYING, accountStatus: "deleted", deletedAtMs: NOW - 1000 });
  const r = await runAccountDeletion(deps, req());
  assert.equal(r.deletedAtMs, NOW - 1000);
  assert.equal(calls.patches.find((p) => p.accountStatus === "deleted")!.deletedAtMs, NOW - 1000);
});

test("audit failure -> partial", async () => {
  const { deps } = fakeDeps(PAYING);
  deps.audit = async () => {
    throw new Error("audit down");
  };
  const r = await runAccountDeletion(deps, req());
  assert.equal(r.outcome, "partial");
});

test("summarizeDeletionOutcome precedence: Stripe failure wins", () => {
  const s = summarizeDeletionOutcome({
    stripe: { status: "failed", subscriptionId: "x" },
    sessions: { status: "failed" },
    disable: { status: "skipped" },
    cleanup: { status: "skipped" },
    audit: { status: "ok" },
  });
  assert.deepEqual(s, { outcome: "failed", httpStatus: 502 });
});

test("parseDeletionRequest: confirm DELETE required, checkboxes default ON, booleans validated", () => {
  assert.equal(parseDeletionRequest({}).ok, false);
  assert.equal(parseDeletionRequest({ confirm: "delete" }).error, "confirmation_required");
  assert.deepEqual(parseDeletionRequest({ confirm: "DELETE" }).options, ALL_ON);
  assert.deepEqual(parseDeletionRequest({ confirm: "DELETE", cancelStripe: false, scheduleMediaDeletion: false }).options, {
    cancelStripe: false,
    revokeSessions: true,
    scheduleMediaDeletion: false,
  });
  assert.equal(parseDeletionRequest({ confirm: "DELETE", cancelStripe: "nope" }).error, "invalid_option");
});

test("readSubscriptionId prefers billingTruth, then billing, then legacy", () => {
  assert.equal(readSubscriptionId({ stripeSubscriptionId: "a" }), "a");
  assert.equal(readSubscriptionId({ billing: { subscriptionId: "b" }, stripeSubscriptionId: "a" }), "b");
  assert.equal(readSubscriptionId({ billingTruth: { subscriptionId: "c" }, billing: { subscriptionId: "b" } }), "c");
  assert.equal(readSubscriptionId({ billing: { subscriptionId: "  " } }), null);
});

// ---------------------------------------------------------------------------
// Deletion impact shaping
// ---------------------------------------------------------------------------

const periodEnd = Math.floor(Date.UTC(2026, 10, 1) / 1000);

test("shapeSubscriptionImpact: plan, $/month, next billing date (basil item period)", () => {
  const s = shapeSubscriptionImpact({
    id: "sub_1",
    status: "active",
    currency: "usd",
    cancel_at_period_end: false,
    metadata: { planId: "pro" },
    items: {
      data: [
        {
          quantity: 1,
          current_period_end: periodEnd,
          price: { unit_amount: 4900, currency: "usd", recurring: { interval: "month", interval_count: 1 }, product: { name: "Pro" } },
        },
      ],
    },
  })!;
  assert.equal(s.planId, "pro");
  assert.equal(s.planName, "Pro");
  assert.equal(s.amount, 49);
  assert.equal(s.amountMonthly, 49);
  assert.equal(s.currency, "USD");
  assert.equal(s.nextBillingDate, new Date(periodEnd * 1000).toISOString());
  assert.equal(s.billable, true);
});

test("shapeSubscriptionImpact: yearly normalized to monthly; cancel_at_period_end => no next charge", () => {
  const s = shapeSubscriptionImpact({
    id: "sub_2",
    status: "active",
    cancel_at_period_end: true,
    current_period_end: periodEnd,
    items: { data: [{ quantity: 2, price: { unit_amount: 12000, nickname: "Studio yearly", recurring: { interval: "year" } } }] },
  })!;
  assert.equal(s.amount, 240);
  assert.equal(s.amountMonthly, 20);
  assert.equal(s.planName, "Studio yearly");
  assert.equal(s.nextBillingDate, null);
  assert.equal(s.cancelAtPeriodEnd, true);
});

test("shapeSubscriptionImpact: canceled sub is not billable; junk input -> null", () => {
  const s = shapeSubscriptionImpact({ id: "sub_3", status: "canceled", items: { data: [] } })!;
  assert.equal(s.billable, false);
  assert.equal(s.amount, null);
  assert.equal(shapeSubscriptionImpact(null), null);
  assert.equal(shapeSubscriptionImpact({}), null);
});

test("shapeDeletionImpact: counts, storage, lookup status, stored ids", () => {
  const impact = shapeDeletionImpact({
    uid: "u1",
    user: { email: "a@b.c", planId: "pro", billing: { subscriptionId: "sub_9" } },
    subscription: null,
    subscriptionLookup: "error",
    subscriptionLookupError: "stripe down",
    rooms: 3,
    recordings: null,
    storageBytes: 1024,
  });
  assert.equal(impact.subscriptionLookup, "error");
  assert.equal(impact.subscriptionLookupError, "stripe down");
  assert.equal(impact.storedSubscriptionId, "sub_9");
  assert.equal(impact.subscription, null);
  assert.equal(impact.rooms, 3);
  assert.equal(impact.recordings, null);
  assert.equal(impact.storageBytes, 1024);
  assert.equal(impact.purgeWindowDays, 7);
  assert.equal(impact.alreadyDeleted, false);
});

test("evaluateRestore: only deleted accounts inside the purge window", () => {
  assert.equal(evaluateRestore(null, NOW).status, 404);
  assert.equal(evaluateRestore({ planId: "free" }, NOW).status, 409);
  assert.equal(evaluateRestore({ accountStatus: "deleted", deletedAtMs: NOW - 1, deleteAfterMs: NOW - 1 }, NOW).status, 410);
  assert.equal(evaluateRestore({ accountStatus: "deleted", deletedAtMs: NOW - 1, deleteAfterMs: NOW + 1000 }, NOW).ok, true);
  // Media retained (no deleteAfterMs): restorable any time.
  assert.equal(evaluateRestore({ accountStatus: "deleted", deletedAtMs: NOW - 1 }, NOW).ok, true);
});
