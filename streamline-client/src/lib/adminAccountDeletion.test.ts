import { describe, expect, it } from "vitest";
import {
  DEFAULT_DELETION_OPTIONS,
  buildDeleteRequestBody,
  formatBytes,
  formatSubscriptionSummary,
  isDeleteConfirmed,
  parseExpiryDate,
  parseGrantMinutes,
  subscriptionStillBilling,
  summarizeBulkDeletion,
  toPerUserResult,
  type DeletionImpact,
} from "./adminAccountDeletion";
import { canShowOveragesToggleFor, formatCreditLine, parseUsageSummary } from "./usageSummary";

const baseImpact: DeletionImpact = {
  uid: "u1",
  email: "a@b.c",
  displayName: null,
  alreadyDeleted: false,
  subscriptionLookup: "ok",
  subscription: {
    id: "sub_1",
    status: "active",
    planId: "pro",
    planName: "Pro",
    amount: 49,
    amountMonthly: 49,
    currency: "USD",
    interval: "month",
    intervalCount: 1,
    nextBillingDate: "2026-11-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    billable: true,
  },
  storedSubscriptionId: "sub_1",
  storedPlanId: "pro",
  rooms: 2,
  recordings: 5,
  storageBytes: 1536,
  purgeWindowDays: 7,
};

describe("delete dialog helpers", () => {
  it("requires exactly DELETE", () => {
    expect(isDeleteConfirmed("DELETE")).toBe(true);
    expect(isDeleteConfirmed(" DELETE ")).toBe(true);
    expect(isDeleteConfirmed("delete")).toBe(false);
    expect(isDeleteConfirmed("")).toBe(false);
  });

  it("builds the DELETE body with the chosen options", () => {
    expect(buildDeleteRequestBody({ ...DEFAULT_DELETION_OPTIONS, cancelStripe: false }, "DELETE")).toEqual({
      cancelStripe: false,
      revokeSessions: true,
      scheduleMediaDeletion: true,
      confirm: "DELETE",
    });
  });

  it("summarizes the subscription (plan, $/month, next billing date)", () => {
    expect(formatSubscriptionSummary(baseImpact)).toBe("Pro · $49.00/month · next billing Nov 1, 2026");
    expect(formatSubscriptionSummary({ ...baseImpact, subscriptionLookup: "none", subscription: null })).toBe("No subscription on file");
    expect(formatSubscriptionSummary({ ...baseImpact, subscriptionLookup: "error", subscription: null, subscriptionLookupError: "timeout" })).toMatch(
      /Could not load subscription sub_1.*timeout/
    );
    expect(
      formatSubscriptionSummary({ ...baseImpact, subscription: { ...baseImpact.subscription!, cancelAtPeriodEnd: true } })
    ).toMatch(/already set to cancel/);
  });

  it("flags subscriptions that would keep billing", () => {
    expect(subscriptionStillBilling(baseImpact)).toBe(true);
    expect(subscriptionStillBilling({ ...baseImpact, subscription: { ...baseImpact.subscription!, status: "canceled", billable: false } })).toBe(false);
    expect(subscriptionStillBilling({ ...baseImpact, subscriptionLookup: "error", subscription: null })).toBe(true);
    expect(subscriptionStillBilling({ ...baseImpact, subscriptionLookup: "none", subscription: null, storedSubscriptionId: null })).toBe(false);
  });

  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5.0 GB");
  });
});

describe("bulk deletion reporting", () => {
  it("checks every response and reports failures (no silent success)", () => {
    const results = [
      toPerUserResult("u1", 200, { outcome: "completed" }, "a@x"),
      toPerUserResult("u2", 502, { outcome: "failed", error: "stripe_cancel_failed" }, "b@x"),
      toPerUserResult("u3", 207, { outcome: "partial" }, "c@x"),
      toPerUserResult("u4", 500, {}, "d@x"),
    ];
    const s = summarizeBulkDeletion(results);
    expect(s.completed.map((r) => r.uid)).toEqual(["u1"]);
    expect(s.partial.map((r) => r.uid)).toEqual(["u3"]);
    expect(s.failed.map((r) => r.uid)).toEqual(["u2", "u4"]);
    expect(s.message).toContain("1 deleted");
    expect(s.message).toContain("2 failed");
    expect(s.message).toContain("Stripe cancel failed - not deleted");
  });

  it("derives outcome from HTTP status when the body is empty", () => {
    expect(toPerUserResult("u", 200, null).outcome).toBe("completed");
    expect(toPerUserResult("u", 207, null).outcome).toBe("partial");
    expect(toPerUserResult("u", 404, null).outcome).toBe("failed");
  });
});

describe("grant input validation", () => {
  it("accepts positive whole minutes only", () => {
    expect(parseGrantMinutes("60")).toBe(60);
    expect(parseGrantMinutes(" 120 ")).toBe(120);
    expect(parseGrantMinutes(30)).toBe(30);
    for (const bad of ["", "0", "-5", "1.5", "1e3", "abc", "60m", 2_000_000, null, undefined]) {
      expect(parseGrantMinutes(bad as any)).toBeNull();
    }
  });

  it("parses expiry dates to end of day UTC", () => {
    expect(parseExpiryDate("2026-12-31")).toBe(Date.parse("2026-12-31T23:59:59.999Z"));
    expect(parseExpiryDate("")).toBeNull();
    expect(parseExpiryDate("12/31/2026")).toBeNull();
  });
});

describe("usage credits + overage toggle", () => {
  it("parses credit remaining / consumption and plan usage", () => {
    const m = parseUsageSummary({
      streaming: {
        usedMinutes: 2200,
        includedMinutes: 2000,
        bonusMinutes: 500,
        limitMinutes: 2500,
        planUsedMinutes: 2000,
        credits: { remainingMinutes: 300, consumedThisMonth: 200 },
      },
    });
    expect(m.streaming.credits).toEqual({ remaining: 300, consumedThisMonth: 200 });
    expect(m.streaming.planUsed).toBe(2000);
    expect(formatCreditLine(m.streaming.credits)).toBe(
      "200 min from one-time credits this month · 300 credit min left (carries over). "
    );
    expect(formatCreditLine({ remaining: 0, consumedThisMonth: 0 })).toBe("");
  });

  it("shows the overage toggle for any effective plan with overages allowed", () => {
    expect(canShowOveragesToggleFor({ entitlements: { features: { overages: true } }, effectiveEntitlements: { planId: "studio" } })).toBe(true);
    // Canonical engine value wins over legacy fields / plan id.
    expect(canShowOveragesToggleFor({ entitlements: { features: { overages: false } }, effectiveEntitlements: { planId: "pro", features: { overagesAllowed: true } } })).toBe(false);
    expect(canShowOveragesToggleFor({ overagesAllowed: true })).toBe(true);
    expect(canShowOveragesToggleFor({ effectiveEntitlements: { features: { allowsOverages: true } } })).toBe(true);
    expect(canShowOveragesToggleFor({ effectiveEntitlements: { planId: "pro" } })).toBe(false);
    expect(canShowOveragesToggleFor(null)).toBe(false);
  });
});
