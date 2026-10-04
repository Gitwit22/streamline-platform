import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decideViewerAccess,
  legacyViewerAccess,
  normalizeViewerAccess,
  strictestViewerAccess,
  validateViewerAccessRequest,
  VIEWER_ACCESS_MODES,
  type AccessDecisionInput,
  type PpvEventSummary,
  type ViewerAccessMode,
} from "./viewerAccess";

const EVENT: PpvEventSummary = {
  id: "ev1",
  name: "Finals",
  monetizationMode: "fixed",
  currency: "usd",
  fixedAmountCents: 500,
  pwywMinCents: null,
  status: "live",
};

type ViewerKind = "anon" | "signed_in" | "allowlisted" | "host";

function viewerFor(kind: ViewerKind) {
  switch (kind) {
    case "anon":
      return { uid: null, email: null, isHost: false };
    case "signed_in":
      return { uid: "u1", email: "fan@example.com", isHost: false };
    case "allowlisted":
      return { uid: "u2", email: "vip@example.com", isHost: false };
    case "host":
      return { uid: "owner", email: "owner@example.com", isHost: true };
  }
}

function decide(mode: ViewerAccessMode, kind: ViewerKind, hasEntitlement: boolean, over: Partial<AccessDecisionInput> = {}) {
  return decideViewerAccess({
    access: normalizeViewerAccess({ mode, ppvEventId: "ev1", allowEmails: ["VIP@example.com"] }),
    viewer: viewerFor(kind),
    hasEntitlement,
    ppvEvent: EVENT,
    ppvSalesOpen: true,
    ...over,
  });
}

function outcome(d: ReturnType<typeof decideViewerAccess>): string {
  return d.allow ? `allow:${d.via}` : `${(d as any).status}:${(d as any).error}`;
}

describe("decideViewerAccess — matrix (mode × viewer × entitlement)", () => {
  const expected: Record<ViewerAccessMode, Record<ViewerKind, [string, string]>> = {
    // [without entitlement, with entitlement]
    public: {
      anon: ["allow:public", "allow:public"],
      signed_in: ["allow:public", "allow:public"],
      allowlisted: ["allow:public", "allow:public"],
      host: ["allow:host", "allow:host"],
    },
    registered: {
      anon: ["401:login_required", "401:login_required"],
      signed_in: ["allow:registered", "allow:registered"],
      allowlisted: ["allow:registered", "allow:registered"],
      host: ["allow:host", "allow:host"],
    },
    subscriber: {
      anon: ["403:subscriber_not_available", "403:subscriber_not_available"],
      signed_in: ["403:subscriber_not_available", "403:subscriber_not_available"],
      allowlisted: ["403:subscriber_not_available", "403:subscriber_not_available"],
      host: ["allow:host", "allow:host"],
    },
    pay_per_view: {
      anon: ["402:checkout_required", "allow:entitlement"],
      signed_in: ["402:checkout_required", "allow:entitlement"],
      allowlisted: ["402:checkout_required", "allow:entitlement"],
      host: ["allow:host", "allow:host"],
    },
    private: {
      anon: ["403:private", "403:private"],
      signed_in: ["403:private", "403:private"],
      allowlisted: ["allow:allowlist", "allow:allowlist"],
      host: ["allow:host", "allow:host"],
    },
  };

  for (const mode of VIEWER_ACCESS_MODES) {
    for (const kind of Object.keys(expected[mode]) as ViewerKind[]) {
      it(`${mode} / ${kind}`, () => {
        assert.equal(outcome(decide(mode, kind, false)), expected[mode][kind][0]);
        assert.equal(outcome(decide(mode, kind, true)), expected[mode][kind][1]);
      });
    }
  }

  it("402 carries the checkout details for the client", () => {
    const d = decide("pay_per_view", "anon", false) as any;
    assert.deepEqual(d.checkout, {
      eventId: "ev1",
      eventName: "Finals",
      monetizationMode: "fixed",
      currency: "usd",
      fixedAmountCents: 500,
      pwywMinCents: null,
    });
  });

  it("PPV without a sellable event (ended / donation / none) → 403 ppv_unavailable", () => {
    assert.equal(outcome(decide("pay_per_view", "anon", false, { ppvEvent: { ...EVENT, status: "ended" } })), "403:ppv_unavailable");
    assert.equal(
      outcome(decide("pay_per_view", "anon", false, { ppvEvent: { ...EVENT, monetizationMode: "donation" } })),
      "403:ppv_unavailable"
    );
    assert.equal(outcome(decide("pay_per_view", "anon", false, { ppvEvent: null })), "403:ppv_unavailable");
  });

  it("PPV sales closed (plan/kill switch) blocks new buyers but not ticket holders", () => {
    assert.equal(outcome(decide("pay_per_view", "anon", false, { ppvSalesOpen: false })), "403:ppv_unavailable");
    assert.equal(outcome(decide("pay_per_view", "anon", true, { ppvSalesOpen: false })), "allow:entitlement");
  });

  it("private allowlist requires a signed-in account with that (verified) email", () => {
    const d = decideViewerAccess({
      access: { mode: "private", allowEmails: ["vip@example.com"] },
      viewer: { uid: null, email: "vip@example.com", isHost: false },
      hasEntitlement: false,
      ppvEvent: null,
      ppvSalesOpen: false,
    });
    assert.equal(outcome(d), "403:private");
  });

  it("subscriber mode can be satisfied once a product exists (future)", () => {
    assert.equal(
      outcome(decide("subscriber", "signed_in", false, { subscriberProductAvailable: true, hasSubscriberEntitlement: true })),
      "allow:subscriber"
    );
  });
});

describe("normalizeViewerAccess / legacy / strictest", () => {
  it("defaults to public for missing or malformed values (existing channels unchanged)", () => {
    assert.deepEqual(normalizeViewerAccess(undefined), { mode: "public" });
    assert.deepEqual(normalizeViewerAccess({ mode: "bogus" }), { mode: "public" });
    assert.deepEqual(normalizeViewerAccess("pay_per_view"), { mode: "public" });
  });

  it("keeps ppvEventId only for PPV and normalizes allowlist emails", () => {
    assert.deepEqual(normalizeViewerAccess({ mode: "registered", ppvEventId: "x" }), { mode: "registered" });
    assert.deepEqual(normalizeViewerAccess({ mode: "private", allowEmails: [" A@B.co ", "nope", 3, "a@b.co"] }), {
      mode: "private",
      allowEmails: ["a@b.co"],
    });
  });

  it("legacy: active paid event → pay_per_view; otherwise public (dead toggles alone do nothing)", () => {
    assert.deepEqual(legacyViewerAccess({ payPerViewEnabled: true }, "ev9"), { mode: "pay_per_view", ppvEventId: "ev9" });
    assert.deepEqual(legacyViewerAccess({ payPerViewEnabled: false }, "ev9"), { mode: "pay_per_view", ppvEventId: "ev9" });
    assert.deepEqual(legacyViewerAccess({ payPerViewEnabled: true }, null), { mode: "public" });
  });

  it("strictest wins: room public + channel PPV → PPV; private beats all", () => {
    assert.deepEqual(strictestViewerAccess({ mode: "public" }, { mode: "pay_per_view", ppvEventId: "e" }), {
      mode: "pay_per_view",
      ppvEventId: "e",
    });
    assert.equal(strictestViewerAccess({ mode: "registered" }, { mode: "private", allowEmails: [] }, null).mode, "private");
    assert.deepEqual(strictestViewerAccess(null, undefined), { mode: "public" });
    // PPV picked from an explicit setting without event id inherits the legacy event id.
    assert.deepEqual(strictestViewerAccess({ mode: "pay_per_view" }, { mode: "pay_per_view", ppvEventId: "legacy" }), {
      mode: "pay_per_view",
      ppvEventId: "legacy",
    });
  });
});

describe("validateViewerAccessRequest", () => {
  const all = { hls: true, monetization: true, payPerView: true };

  it("public is always allowed (even without any plan feature)", () => {
    const r = validateViewerAccessRequest({ mode: "public" }, { hls: false, monetization: false, payPerView: false }, { activePaidEventIds: [] });
    assert.deepEqual(r, { ok: true, value: { mode: "public" } });
  });

  it("rejects unknown modes", () => {
    const r = validateViewerAccessRequest({ mode: "vip" }, all, { activePaidEventIds: [] }) as any;
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_mode");
  });

  it("subscriber is rejected with subscriber_not_available", () => {
    const r = validateViewerAccessRequest({ mode: "subscriber" }, all, { activePaidEventIds: [] }) as any;
    assert.equal(r.status, 403);
    assert.equal(r.error, "subscriber_not_available");
  });

  it("pay_per_view requires monetization + payPerView entitlements and an active paid event", () => {
    assert.equal((validateViewerAccessRequest({ mode: "pay_per_view" }, { ...all, payPerView: false }, { activePaidEventIds: ["e"] }) as any).error, "ppv_not_entitled");
    assert.equal((validateViewerAccessRequest({ mode: "pay_per_view" }, { ...all, monetization: false }, { activePaidEventIds: ["e"] }) as any).error, "monetization_not_enabled");
    assert.equal((validateViewerAccessRequest({ mode: "pay_per_view" }, all, { activePaidEventIds: [] }) as any).error, "ppv_event_required");
    assert.equal((validateViewerAccessRequest({ mode: "pay_per_view", ppvEventId: "zzz" }, all, { activePaidEventIds: ["e"] }) as any).error, "ppv_event_invalid");
    assert.deepEqual(validateViewerAccessRequest({ mode: "pay_per_view" }, all, { activePaidEventIds: ["e1", "e2"] }), {
      ok: true,
      value: { mode: "pay_per_view", ppvEventId: "e1" },
    });
  });

  it("registered / private need HLS on the plan; private keeps the allowlist", () => {
    assert.equal((validateViewerAccessRequest({ mode: "registered" }, { ...all, hls: false }, { activePaidEventIds: [] }) as any).error, "hls_not_in_plan");
    assert.deepEqual(validateViewerAccessRequest({ mode: "private", allowEmails: ["x@y.io"] }, all, { activePaidEventIds: [] }), {
      ok: true,
      value: { mode: "private", allowEmails: ["x@y.io"] },
    });
  });
});
