import test from "node:test";
import assert from "node:assert/strict";
import {
  FEATURE_KEYS,
  LIMIT_KEYS,
  formatLimit,
  hasRoomFor,
  isWithinLimit,
  remaining,
  resolveGuestCap,
  type PlatformFlags,
} from "./types";
import { normalizePlanDoc, sanitizePlanV2Input, toPlanDocV2 } from "./normalizePlanV2";
import { PLAN_CATALOG_V2 } from "./planCatalog";
import {
  PLATFORM_FLAG_DEFAULTS,
  adminSeededFlagList,
  defaultPlatformFlags,
  resolveFlagValue,
  resolvePlatformFlags,
  toPlatformFlagsPayload,
} from "./flags";
import {
  candidatePlanIds,
  combineFeatures,
  computeBillingBlock,
  readActiveOverride,
  resolveEntitlements,
  serializeEntitlements,
  type ResolveInput,
} from "./resolvePlan";
import { EntitlementError, checkFeature, checkLimit, createEntitlementService } from "./service";
import { toLegacyEntitlementsPayload, LEGACY_UNLIMITED_COUNT } from "./legacyPayload";
import { planPlanMigration, planUserOverrideMigration } from "./migratePlans";
import { normalizePlan } from "../normalizePlan";
import { LIMIT_ERRORS } from "../limitErrors";

const GB = 1024 * 1024 * 1024;
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

// Legacy (pre-v2) seed docs as they exist in production Firestore today.
const LEGACY_DOCS: Record<string, any> = {
  free: {
    features: { recording: false, rtmp: false, multistream: false, canHls: false, hls: false, allowsOverages: false },
    limits: { monthlyMinutesIncluded: 180, transcodeMinutes: 0, maxGuests: 2, rtmpDestinationsMax: 0, maxSessionMinutes: 60, maxRecordingMinutesPerClip: 0 },
    caps: { hlsMaxMinutesPerSession: null },
    editing: { access: false, maxProjects: 0, maxStorageGB: 0, maxStorageBytes: 0 },
  },
  pro: {
    features: {
      recording: true, rtmp: true, multistream: true, dualRecording: true, allowsOverages: true,
      canHls: true, hls: true, hlsEnabled: true, hlsCustomizationEnabled: true,
      monetization: true, payPerView: true, invisibleHost: true,
    },
    limits: { monthlyMinutesIncluded: 2400, transcodeMinutes: 300, maxGuests: 10, rtmpDestinationsMax: 3, maxSessionMinutes: 480, maxRecordingMinutesPerClip: 60 },
    caps: { hlsMaxMinutesPerSession: null },
    editing: { access: true, maxProjects: 10, maxStorageGB: 25, maxStorageBytes: 25 * GB },
  },
  enterprise: {
    features: { recording: true, rtmp: true, multistream: true, dualRecording: true, allowsOverages: true, canHls: true, hls: true },
    limits: { monthlyMinutesIncluded: 6000, maxGuests: 50, rtmpDestinationsMax: 10, maxSessionMinutes: 720, maxRecordingMinutesPerClip: 120 },
    editing: { access: true, maxProjects: 0, maxStorageGB: 0, maxStorageBytes: 0 },
  },
};

function flags(overrides: Partial<PlatformFlags> = {}): PlatformFlags {
  return { ...defaultPlatformFlags(true), ...overrides };
}

function input(userDoc: any, extra: Partial<ResolveInput> = {}): ResolveInput {
  return {
    uid: "u1",
    userDoc,
    adminsCollectionFlag: false,
    platformBillingEnabled: true,
    planDocs: { ...PLAN_CATALOG_V2 },
    flags: flags(),
    now: NOW,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Limit helpers: 0 = zero, null = unlimited
// ---------------------------------------------------------------------------

test("limit helpers: null = unlimited, 0 = none", () => {
  assert.equal(hasRoomFor(1_000_000, null), true);
  assert.equal(hasRoomFor(0, 0), false);
  assert.equal(hasRoomFor(2, 3), true);
  assert.equal(hasRoomFor(3, 3), false);
  assert.equal(hasRoomFor(1, 3, 2), true);
  assert.equal(hasRoomFor(2, 3, 2), false);
  assert.equal(isWithinLimit(3, 3), true);
  assert.equal(isWithinLimit(4, 3), false);
  assert.equal(isWithinLimit(0, 0), true);
  assert.equal(isWithinLimit(1, 0), false);
  assert.equal(remaining(null, 50), null);
  assert.equal(remaining(0, 0), 0);
  assert.equal(remaining(10, 4), 6);
  assert.equal(remaining(10, 40), 0);
  assert.equal(formatLimit(null), "Unlimited");
  assert.equal(formatLimit(0), "None");
  assert.equal(formatLimit(5, "guests"), "5 guests");
});

test("guest cap: plan limit wins, unlimited falls back to env safety cap", () => {
  assert.equal(resolveGuestCap(5, "50"), 5);
  assert.equal(resolveGuestCap(0, "50"), 0);
  assert.equal(resolveGuestCap(null, "50"), 50);
  assert.equal(resolveGuestCap(null, undefined), undefined);
  assert.equal(resolveGuestCap(null, "0"), undefined);
});

// ---------------------------------------------------------------------------
// Override precedence & expiry
// ---------------------------------------------------------------------------

test("override precedence: base Free + no Stripe + override Pro => effective Pro (no billing block)", () => {
  const ent = resolveEntitlements(
    input({
      planId: "free",
      planOverride: { planId: "pro", reason: "partner", createdBy: "admin1", startsAt: NOW - DAY, expiresAt: NOW + DAY },
    })
  );
  assert.equal(ent.planId, "pro");
  assert.equal(ent.source.basePlan, "free");
  assert.equal(ent.source.decidedBy, "override");
  assert.equal(ent.source.adminOverride?.planId, "pro");
  assert.equal(ent.source.subscription.blocked, false);
  assert.equal(ent.features.recording, true);
  assert.equal(ent.limits.guests, 10);
});

test("override applies even when the base PAID plan is billing-blocked", () => {
  const ent = resolveEntitlements(
    input({ planId: "starter", planOverride: { planId: "pro", reason: "r", createdBy: "a", startsAt: 0 } })
  );
  assert.equal(ent.planId, "pro");
  assert.equal(ent.source.subscription.blocked, true);
});

test("expired override is ignored automatically", () => {
  const ent = resolveEntitlements(
    input({
      planId: "free",
      planOverride: { planId: "pro", reason: "trial", createdBy: "a", startsAt: NOW - 2 * DAY, expiresAt: NOW - 1 },
    })
  );
  assert.equal(ent.planId, "free");
  assert.equal(ent.source.adminOverride, null);
  assert.equal(ent.source.decidedBy, "base");
});

test("override that has not started yet is ignored", () => {
  const ent = resolveEntitlements(
    input({ planId: "free", planOverride: { planId: "pro", reason: "r", createdBy: "a", startsAt: NOW + DAY } })
  );
  assert.equal(ent.planId, "free");
});

test("override expiry boundary: active until expiresAt (exclusive)", () => {
  const doc = { planOverride: { planId: "pro", reason: "r", createdBy: "a", startsAt: 0, expiresAt: NOW } };
  assert.equal(readActiveOverride(doc, NOW - 1)?.planId, "pro");
  assert.equal(readActiveOverride(doc, NOW), null);
});

test("legacy adminOverridePlanId / adminOverride are honored when no planOverride exists", () => {
  const a = resolveEntitlements(input({ planId: "free", adminOverridePlanId: "pro" }));
  assert.equal(a.planId, "pro");
  assert.equal(a.source.adminOverride?.legacy, true);
  const b = resolveEntitlements(input({ planId: "free", adminOverride: true }));
  assert.equal(b.planId, "internal_unlimited");
  assert.equal(b.limits.monthlyStreamingMinutes, null);
});

test("a stored planOverride (even expired) supersedes legacy override fields", () => {
  const ent = resolveEntitlements(
    input({
      planId: "free",
      adminOverridePlanId: "pro",
      planOverride: { planId: "starter", reason: "r", createdBy: "a", startsAt: 0, expiresAt: NOW - 1 },
    })
  );
  assert.equal(ent.planId, "free");
});

test("override to a plan that does not exist is ignored", () => {
  const ent = resolveEntitlements(
    input({ planId: "free", planOverride: { planId: "ghost_plan", reason: "r", createdBy: "a", startsAt: 0 } })
  );
  assert.equal(ent.planId, "free");
});

test("override to a custom (non-catalog) plan doc works", () => {
  const custom = { limitsVersion: 2, name: "Partner", features: { recording: true }, limits: { guests: 25, monthlyStreamingMinutes: null } };
  const ent = resolveEntitlements(
    input(
      { planId: "free", planOverride: { planId: "partner", reason: "r", createdBy: "a", startsAt: 0 } },
      { planDocs: { ...PLAN_CATALOG_V2, partner: custom } }
    )
  );
  assert.equal(ent.planId, "partner");
  assert.equal(ent.limits.guests, 25);
  assert.equal(ent.limits.monthlyStreamingMinutes, null);
  assert.equal(ent.limits.destinations, 0); // missing v2 key => 0 (fail closed)
});

test("candidatePlanIds includes base, active override, free and internal", () => {
  const ids = candidatePlanIds({ planId: "starter", planOverride: { planId: "pro", startsAt: 0 } }, NOW);
  for (const id of ["starter", "pro", "free", "internal_unlimited"]) assert.ok(ids.includes(id), id);
});

// ---------------------------------------------------------------------------
// Billing & admins
// ---------------------------------------------------------------------------

test("paid base plan without subscription is billing-blocked => Free; test mode is not", () => {
  assert.equal(computeBillingBlock({}, "pro", true), "Missing subscription");
  // Retry window keeps the paid plan; terminal states block.
  assert.equal(computeBillingBlock({ stripeSubscriptionId: "sub", billingStatus: "past_due" }, "pro", true), null);
  assert.equal(computeBillingBlock({ stripeSubscriptionId: "sub", billingStatus: "unpaid" }, "pro", true), "Billing unpaid");
  assert.equal(computeBillingBlock({ stripeSubscriptionId: "sub", billingStatus: "active" }, "pro", true), null);
  assert.equal(computeBillingBlock({}, "free", true), null);
  assert.equal(computeBillingBlock({}, "internal_unlimited", true), null);

  const blocked = resolveEntitlements(input({ planId: "pro" }));
  assert.equal(blocked.planId, "free");
  assert.equal(blocked.source.decidedBy, "billing_block");
  assert.equal(checkFeature(blocked, "recording").reason?.startsWith("Billing issue"), true);

  const testMode = resolveEntitlements(input({ planId: "pro" }, { platformBillingEnabled: false }));
  assert.equal(testMode.planId, "pro");
  const userTestMode = resolveEntitlements(input({ planId: "pro", billingEnabled: false }));
  assert.equal(userTestMode.planId, "pro");

  const paying = resolveEntitlements(input({ planId: "pro", stripeSubscriptionId: "sub_1", billingStatus: "active" }));
  assert.equal(paying.planId, "pro");
  assert.equal(paying.source.decidedBy, "base");
});

test("platform admins get internal_unlimited limits (null), not base-plan limits", () => {
  for (const doc of [{ planId: "free", isAdmin: true }, { planId: "free", admin: { isAdmin: true } }]) {
    const ent = resolveEntitlements(input(doc));
    assert.equal(ent.planId, "internal_unlimited");
    assert.equal(ent.source.internalAdmin, true);
    for (const k of LIMIT_KEYS) assert.equal(ent.limits[k], null, k);
  }
  const viaCollection = resolveEntitlements(input({ planId: "free" }, { adminsCollectionFlag: true }));
  assert.equal(viaCollection.planId, "internal_unlimited");
  assert.equal(viaCollection.limits.maxSessionMinutes, null);
});

test("admins still respect platform kill switches", () => {
  const ent = resolveEntitlements(input({ isAdmin: true }, { flags: flags({ recording: false, invisibleHostEnabled: false }) }));
  assert.equal(ent.planFeatures.recording, true);
  assert.equal(ent.features.recording, false);
  assert.equal(ent.features.invisibleHost, false);
});

test("an explicit override beats platform-admin internal_unlimited (lets admins test plans)", () => {
  const ent = resolveEntitlements(input({ isAdmin: true, planOverride: { planId: "free", reason: "qa", createdBy: "a", startsAt: 0 } }));
  assert.equal(ent.planId, "free");
});

test("legacy adminOverrideHls grants HLS on top of the effective plan", () => {
  const ent = resolveEntitlements(input({ planId: "free", adminOverrideHls: true }));
  assert.equal(ent.features.hls, true);
  assert.deepEqual(ent.source.grants, ["hls"]);
});

// ---------------------------------------------------------------------------
// Legacy vs v2 limit semantics
// ---------------------------------------------------------------------------

test("legacy docs: 0 / missing keep their legacy UNLIMITED meaning (no behavior change on deploy)", () => {
  const ent = normalizePlanDoc("enterprise", LEGACY_DOCS.enterprise);
  assert.equal(ent.limitsVersion, 1);
  assert.equal(ent.limits.projects, null); // editing.maxProjects 0 => unlimited
  assert.equal(ent.limits.storageBytes, null); // maxStorageGB 0 => unlimited
  assert.equal(ent.limits.hlsMaxMinutesPerSession, null);
  assert.equal(ent.limits.monthlyStreamingMinutes, 6000);
  assert.equal(ent.limits.destinations, 10);

  const empty = normalizePlanDoc("custom", { features: { recording: true } });
  assert.equal(empty.limits.monthlyStreamingMinutes, null);
  assert.equal(empty.limits.guests, null);
  assert.equal(empty.limits.maxSessionMinutes, null);
  assert.equal(empty.limits.recordingMinutesPerClip, null);
  assert.equal(empty.limits.storageBytes, null);
});

test("v2 docs: 0 = none, null = unlimited, missing = 0", () => {
  const plan = normalizePlanDoc("x", {
    limitsVersion: 2,
    features: { multistream: true, recording: true },
    limits: { monthlyStreamingMinutes: 0, destinations: 2, guests: null, storageBytes: 0, projects: 0, maxSessionMinutes: null },
  });
  assert.equal(plan.limitsVersion, 2);
  assert.equal(plan.limits.monthlyStreamingMinutes, 0);
  assert.equal(plan.limits.destinations, 2);
  assert.equal(plan.limits.guests, null);
  assert.equal(plan.limits.storageBytes, 0);
  assert.equal(plan.limits.projects, 0);
  assert.equal(plan.limits.maxSessionMinutes, null);
  assert.equal(plan.limits.recordingMinutesPerClip, 0); // missing => 0
  assert.equal(plan.limits.hlsMaxMinutesPerSession, 0);
});

test("legacy storage reader keeps storagePure order (first POSITIVE candidate)", () => {
  assert.equal(normalizePlanDoc("p", { editing: { maxStorageGB: 0, maxStorageBytes: 5 * GB } }).limits.storageBytes, 5 * GB);
  assert.equal(normalizePlanDoc("p", { editing: { maxStorageGB: 2 } }).limits.storageBytes, 2 * GB);
  assert.equal(normalizePlanDoc("p", { maxStorageBytes: 7 }).limits.storageBytes, 7);
});

test("migration preserves meaning: legacy doc and its v2 conversion normalize identically", () => {
  for (const [id, doc] of Object.entries(LEGACY_DOCS)) {
    const legacy = normalizePlanDoc(id, doc);
    const step = planPlanMigration(id, doc, "2026-10-04T00:00:00.000Z");
    assert.equal(step.action, "migrate");
    const migrated = normalizePlanDoc(id, { ...doc, ...step.update });
    assert.equal(migrated.limitsVersion, 2, id);
    assert.deepEqual(migrated.limits, legacy.limits, id);
    assert.deepEqual(migrated.features, legacy.features, id);
    assert.deepEqual(step.update?.legacyEntitlementsBackup?.limits, doc.limits ?? null);
  }
  assert.equal(planPlanMigration("pro", PLAN_CATALOG_V2.pro, "x").action, "skip_already_v2");
});

test("v2 catalog round-trips through the normalizer and toPlanDocV2", () => {
  for (const [id, doc] of Object.entries(PLAN_CATALOG_V2)) {
    const n = normalizePlanDoc(id, doc);
    for (const k of LIMIT_KEYS) assert.equal(n.limits[k], (doc.limits as any)[k], `${id}.${k}`);
    for (const k of FEATURE_KEYS) assert.equal(n.features[k], doc.features[k], `${id}.${k}`);
    const back = toPlanDocV2(id, doc);
    assert.deepEqual(back.limits, doc.limits, id);
  }
  // Seeded convention: internal_unlimited is unlimited everywhere; free gets none of the paid resources.
  for (const k of LIMIT_KEYS) assert.equal(PLAN_CATALOG_V2.internal_unlimited.limits[k], null);
  assert.equal(PLAN_CATALOG_V2.free.limits.destinations, 0);
  assert.equal(PLAN_CATALOG_V2.free.limits.storageBytes, 0);
});

test("legacy normalizePlan wrapper keeps its legacy encoding (0 = no cap)", () => {
  const legacy = normalizePlan("enterprise", LEGACY_DOCS.enterprise);
  assert.equal(legacy.limits.maxStorageGB, 0);
  assert.equal(legacy.v2.limits.storageBytes, null);
  const pro = normalizePlan("pro", LEGACY_DOCS.pro);
  assert.equal(pro.limits.rtmpDestinationsMax, 3);
  assert.equal(pro.features.multistream, true);
  assert.equal(pro.features.allowsOverages, true);
});

// ---------------------------------------------------------------------------
// Multistream: the admin "off" toggle must win; destinations 0 = none
// ---------------------------------------------------------------------------

test("multistream OFF via admin toggle blocks even if seeded features.multistream:true survives", () => {
  const toggledOff = {
    ...LEGACY_DOCS.pro,
    features: { ...LEGACY_DOCS.pro.features, multistream: true, rtmp: false, rtmpMultistream: false },
    limits: { ...LEGACY_DOCS.pro.limits, rtmpDestinationsMax: 0, maxDestinations: 0, rtmpDestinations: 0 },
  };
  const plan = normalizePlanDoc("pro", toggledOff);
  assert.equal(plan.features.multistream, false);
  assert.equal(plan.limits.destinations, 0);

  const ent = resolveEntitlements(
    input({ planId: "pro", stripeSubscriptionId: "s", billingStatus: "active" }, { planDocs: { ...PLAN_CATALOG_V2, pro: toggledOff } })
  );
  const check = checkFeature(ent, "multistream");
  assert.equal(check.allowed, false);
  assert.equal(check.code, LIMIT_ERRORS.FEATURE_NOT_ENTITLED);
  assert.equal(toLegacyEntitlementsPayload(ent).features.rtmpMultistream, false);
});

test("v2: destinations 0 means NONE (multistream off), never 'no cap'", () => {
  const plan = normalizePlanDoc("x", { limitsVersion: 2, features: { multistream: true }, limits: { destinations: 0 } });
  assert.equal(plan.features.multistream, false);
  assert.equal(plan.limits.destinations, 0);
  assert.equal(hasRoomFor(0, plan.limits.destinations, 1), false);
});

test("legacy multistream on with no cap stays unlimited; built-in caps for pro/internal", () => {
  assert.equal(normalizePlanDoc("custom", { features: { rtmp: true } }).limits.destinations, null);
  assert.equal(normalizePlanDoc("pro", { features: { rtmp: true } }).limits.destinations, 3);
  assert.equal(normalizePlanDoc("internal_unlimited", { features: { rtmp: true } }).limits.destinations, 10);
  // Legacy cap > 0 alone still enables destinations (old featureAccess behavior).
  assert.equal(normalizePlanDoc("custom", { limits: { maxDestinations: 2 } }).features.multistream, true);
});

test("checkLimit / assert semantics for destinations", () => {
  const ent = resolveEntitlements(input({ planId: "starter", stripeSubscriptionId: "s", billingStatus: "active" }));
  assert.equal(checkLimit(ent, "destinations", 2, 1).allowed, true);
  assert.equal(checkLimit(ent, "destinations", 3, 1).allowed, false);
  const free = resolveEntitlements(input({ planId: "free" }));
  const none = checkLimit(free, "destinations", 0, 1);
  assert.equal(none.allowed, false);
  assert.equal(none.limit, 0);
});

test("legacy HLS defaults: Basic OFF (matches the gate), Pro ON when no key is stored", () => {
  assert.equal(normalizePlanDoc("basic", {}).features.hls, false);
  assert.equal(normalizePlanDoc("pro", {}).features.hls, true);
  assert.equal(normalizePlanDoc("basic", { features: { hlsEnabled: true } }).features.hls, true);
  assert.equal(normalizePlanDoc("pro", { features: { hls: false, canHls: false, hlsEnabled: false } }).features.hls, false);
});

// ---------------------------------------------------------------------------
// Platform flags: one defaults table
// ---------------------------------------------------------------------------

test("flag defaults are single-source: kill switches ON, opt-in switches OFF when missing", () => {
  const f = resolvePlatformFlags({}, true);
  for (const name of ["recording", "hlsSettingsTab", "contentLibraryEnabled", "projectsEnabled", "editorEnabled", "myContentEnabled", "myContentRecordingsEnabled"] as const) {
    assert.equal(f[name], true, name);
  }
  for (const name of ["monetizationEnabled", "payPerViewEnabled", "invisibleHostEnabled", "collaboratorDelegationEnabled", "audioMixerEnabled", "advancedScreenShareEnabled"] as const) {
    assert.equal(f[name], false, name);
  }
  // /me and /api/plans share the same payload builder.
  const payload = toPlatformFlagsPayload(f);
  assert.equal(payload.recordingEnabled, true);
  assert.equal(payload.hlsEnabled, true);
  assert.equal(payload.projectsEnabled, true);
  assert.equal(payload.monetizationEnabled, false);
});

test("flag doc values: boolean `enabled` wins; HLS doc accepts legacy `hlsEnabled`", () => {
  assert.equal(resolveFlagValue("projectsEnabled", { enabled: false }), false);
  assert.equal(resolveFlagValue("monetizationEnabled", { enabled: true }), true);
  assert.equal(resolveFlagValue("monetizationEnabled", { enabled: "yes" }), false);
  assert.equal(resolveFlagValue("hlsSettingsTab", { hlsEnabled: false }), false);
  assert.equal(resolveFlagValue("hlsSettingsTab", { enabled: true, hlsEnabled: false }), true);
  assert.equal(resolveFlagValue("hlsSettingsTab", undefined), true);
});

test("admin seeded flag list covers every flag incl. recording / monetization / PPV", () => {
  const list = adminSeededFlagList();
  const names = list.map((f) => f.name);
  for (const n of Object.keys(PLATFORM_FLAG_DEFAULTS)) assert.ok(names.includes(n as any), n);
  for (const n of ["recording", "monetizationEnabled", "payPerViewEnabled"]) assert.ok(names.includes(n as any), n);
  assert.equal(list.find((f) => f.name === "projectsEnabled")?.enabled, true);
  assert.equal(list.find((f) => f.name === "payPerViewEnabled")?.enabled, false);
});

test("kill switches are enforced in effective features; codes distinguish platform vs plan", () => {
  const plan = normalizePlanDoc("pro", PLAN_CATALOG_V2.pro).features;
  const off = combineFeatures(plan, flags({ monetizationEnabled: false, payPerViewEnabled: true, invisibleHostEnabled: false, hlsSettingsTab: false, transcodeEnabled: false, projectsEnabled: false }));
  assert.equal(off.monetization, false);
  assert.equal(off.payPerView, false); // PPV requires monetization
  assert.equal(off.invisibleHost, false);
  assert.equal(off.hls, false);
  assert.equal(off.hlsCustomization, false);
  assert.equal(off.multistream, false);
  assert.equal(off.projects, false);
  assert.equal(off.editing, true);

  const on = combineFeatures(plan, flags({ monetizationEnabled: true, payPerViewEnabled: true, invisibleHostEnabled: true }));
  assert.equal(on.monetization, true);
  assert.equal(on.payPerView, true);
  assert.equal(on.invisibleHost, true);

  const ent = resolveEntitlements(
    input({ planId: "free", planOverride: { planId: "pro", reason: "r", createdBy: "a", startsAt: 0 } }, { flags: flags({ invisibleHostEnabled: false }) })
  );
  assert.equal(checkFeature(ent, "invisibleHost").code, LIMIT_ERRORS.FEATURE_DISABLED);
  const free = resolveEntitlements(input({ planId: "free" }, { flags: flags({ invisibleHostEnabled: true }) }));
  assert.equal(checkFeature(free, "invisibleHost").code, LIMIT_ERRORS.FEATURE_NOT_ENTITLED);
});

// ---------------------------------------------------------------------------
// Service: caching, invalidation, assertions
// ---------------------------------------------------------------------------

function fakeService(userDoc: any) {
  const calls = { user: 0 };
  let t = NOW;
  const svc = createEntitlementService(
    {
      loadUserDoc: async () => {
        calls.user++;
        return userDoc;
      },
      loadAdminsCollectionFlag: async () => false,
      loadPlanDocs: async (ids) => Object.fromEntries(ids.map((id) => [id, null])),
      loadPlatformFlags: async () => flags(),
      loadPlatformBillingEnabled: async () => true,
      now: () => t,
    },
    { ttlMs: 5_000 }
  );
  return { svc, calls, advance: (ms: number) => (t += ms) };
}

test("service caches per uid for the TTL and supports invalidate / fresh", async () => {
  const { svc, calls, advance } = fakeService({ planId: "free" });
  await svc.getEffectiveEntitlements("u1");
  await svc.getEffectiveEntitlements("u1");
  assert.equal(calls.user, 1);
  advance(6_000);
  await svc.getEffectiveEntitlements("u1");
  assert.equal(calls.user, 2);
  svc.invalidate("u1");
  await svc.getEffectiveEntitlements("u1");
  assert.equal(calls.user, 3);
  await svc.getEffectiveEntitlements("u1", { fresh: true });
  assert.equal(calls.user, 4);
});

test("missing plan docs fall back to the built-in v2 catalog", async () => {
  const { svc } = fakeService({ planId: "free", planOverride: { planId: "pro", reason: "r", createdBy: "a", startsAt: 0 } });
  const ent = await svc.getEffectiveEntitlements("u1");
  assert.equal(ent.planId, "pro");
  assert.equal(ent.limits.monthlyStreamingMinutes, 2400);
});

test("assertFeature / assertWithinLimit throw EntitlementError with stable codes", async () => {
  const { svc } = fakeService({ planId: "free" });
  await assert.rejects(svc.assertFeature("u1", "recording"), (err: any) => {
    assert.ok(err instanceof EntitlementError);
    assert.equal(err.status, 403);
    assert.equal(err.body.error, LIMIT_ERRORS.FEATURE_NOT_ENTITLED);
    return true;
  });
  await assert.rejects(svc.assertWithinLimit("u1", "destinations", 0), (err: any) => {
    assert.equal(err.status, 403); // plan has none
    assert.equal(err.body.error, LIMIT_ERRORS.LIMIT_EXCEEDED);
    return true;
  });
  const ok = await svc.assertWithinLimit("u1", "guests", 1);
  assert.equal(ok.allowed, true);
  await assert.rejects(svc.assertWithinLimit("u1", "guests", 2), (err: any) => err.status === 409);
});

// ---------------------------------------------------------------------------
// Wire payloads
// ---------------------------------------------------------------------------

test("serialized entitlements keep null = unlimited and never leak the raw plan doc", () => {
  const ent = resolveEntitlements(input({ isAdmin: true }));
  const wire = JSON.parse(JSON.stringify(serializeEntitlements(ent)));
  assert.equal(wire.limits.storageBytes, null);
  assert.equal(wire.plan, undefined);
  assert.ok(wire.features && wire.planFeatures && wire.source && wire.platformFlags);
});

test("legacy payload: unlimited destinations stay usable for old clients", () => {
  const ent = resolveEntitlements(input({ isAdmin: true }));
  const legacy = toLegacyEntitlementsPayload(ent);
  assert.equal(legacy.limits.rtmpDestinationsMax, LEGACY_UNLIMITED_COUNT);
  assert.equal(legacy.limits.maxGuests, 0); // legacy 0 = no cap
  assert.equal(legacy.features.overagesAllowed, true);
});

// ---------------------------------------------------------------------------
// Admin plan editor input + user override migration
// ---------------------------------------------------------------------------

test("sanitizePlanV2Input accepts null (unlimited) and 0 (none), rejects junk", () => {
  const ok = sanitizePlanV2Input({ features: { hls: true }, limits: { guests: null, destinations: 0, projects: "5", maxPresetId: "" } });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.limits.guests, null);
  assert.equal(ok.limits.destinations, 0);
  assert.equal(ok.limits.projects, 5);
  assert.equal(ok.limits.maxPresetId, null);
  const bad = sanitizePlanV2Input({ features: { hls: "yes" }, limits: { guests: -1, storageBytes: true } });
  assert.equal(bad.errors.length, 3);
});

test("user override migration converts legacy fields once", () => {
  assert.equal(planUserOverrideMigration("u", { adminOverridePlanId: "pro" }, NOW).planOverride?.planId, "pro");
  assert.equal(planUserOverrideMigration("u", { adminOverride: true }, NOW).planOverride?.planId, "internal_unlimited");
  assert.equal(planUserOverrideMigration("u", { adminOverridePlanId: "pro", planOverride: { planId: "x" } }, NOW).action, "skip");
  assert.equal(planUserOverrideMigration("u", {}, NOW).action, "skip");
});

test("audioMixer: plan feature (default on when missing) AND platform switch", () => {
  // Legacy and v2 docs that predate the feature keep it.
  assert.equal(normalizePlanDoc("pro", { name: "Pro" }).features.audioMixer, true);
  assert.equal(normalizePlanDoc("pro", { limitsVersion: 2, features: { recording: true }, limits: {} }).features.audioMixer, true);
  // Explicit false turns it off for the plan.
  assert.equal(normalizePlanDoc("pro", { limitsVersion: 2, features: { audioMixer: false }, limits: {} }).features.audioMixer, false);
  assert.equal(normalizePlanDoc("pro", { features: { audioMixer: false } }).features.audioMixer, false);

  const plan = normalizePlanDoc("pro", PLAN_CATALOG_V2.pro).features;
  assert.equal(plan.audioMixer, true);
  assert.equal(combineFeatures(plan, flags({ audioMixerEnabled: false })).audioMixer, false);
  assert.equal(combineFeatures(plan, flags({ audioMixerEnabled: true })).audioMixer, true);
  assert.equal(combineFeatures({ ...plan, audioMixer: false }, flags({ audioMixerEnabled: true })).audioMixer, false);

  const ent = resolveEntitlements(input({ planId: "pro" }, { flags: flags({ audioMixerEnabled: false }) }));
  assert.equal(checkFeature(ent, "audioMixer").code, LIMIT_ERRORS.FEATURE_DISABLED);
  assert.deepEqual(sanitizePlanV2Input({ features: { audioMixer: false } }).features, { audioMixer: false });
});

test("advancedScreenShare: plan feature (default on when missing) AND platform switch", () => {
  assert.equal(normalizePlanDoc("pro", { name: "Pro" }).features.advancedScreenShare, true);
  assert.equal(normalizePlanDoc("pro", { limitsVersion: 2, features: {}, limits: {} }).features.advancedScreenShare, true);
  assert.equal(
    normalizePlanDoc("pro", { limitsVersion: 2, features: { advancedScreenShare: false }, limits: {} }).features.advancedScreenShare,
    false
  );
  const plan = normalizePlanDoc("pro", PLAN_CATALOG_V2.pro).features;
  assert.equal(combineFeatures(plan, flags({ advancedScreenShareEnabled: false })).advancedScreenShare, false);
  assert.equal(combineFeatures(plan, flags({ advancedScreenShareEnabled: true })).advancedScreenShare, true);

  const disabled = resolveEntitlements(input({ planId: "pro" }, { flags: flags({ advancedScreenShareEnabled: false }) }));
  assert.equal(checkFeature(disabled, "advancedScreenShare").code, LIMIT_ERRORS.FEATURE_DISABLED);
  const allowed = resolveEntitlements(input({ planId: "pro" }, { flags: flags({ advancedScreenShareEnabled: true }) }));
  assert.equal(checkFeature(allowed, "advancedScreenShare").allowed, true);
});
