/**
 * Effective-plan resolution (pure).
 *
 * Precedence (highest first):
 *   1. Active admin override   users/{uid}.planOverride (startsAt <= now < expiresAt)
 *                              legacy fallback: adminOverridePlanId, adminOverride:true
 *                              -> never requires a Stripe subscription.
 *   2. Platform admin          users.isAdmin / users.admin.isAdmin / admins/{uid}
 *                              -> internal_unlimited (admins bypass plan gates but get
 *                                 matching UNLIMITED limits instead of base-plan limits).
 *   3. Base plan               users/{uid}.planId (billing truth / admin "set base plan"),
 *                              unless the paid base plan is billing-blocked (missing
 *                              subscription, unpaid, canceled, ...) => free.
 *
 * Platform flags are applied last: a feature is usable only when the plan
 * includes it AND the platform switch is on (see combineFeatures()).
 */
import { normalizePlanDoc } from "./normalizePlanV2";
import { FALLBACK_PLAN_ID, INTERNAL_PLAN_ID, getCatalogPlan } from "./planCatalog";
import type {
  EffectiveEntitlements,
  EntitlementFeatures,
  FeatureKey,
  NormalizedPlan,
  OverrideSource,
  PlatformFlags,
  ResolvedEntitlements,
  SubscriptionSource,
} from "./types";

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

export function toEpochMsLoose(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  const anyVal = value as any;
  if (typeof anyVal?.toMillis === "function") {
    const t = anyVal.toMillis();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "string") {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function isOverrideActive(override: { startsAt?: unknown; expiresAt?: unknown } | null | undefined, now: number): boolean {
  if (!override) return false;
  const startsAt = toEpochMsLoose(override.startsAt) ?? 0;
  const expiresAt = toEpochMsLoose(override.expiresAt);
  if (startsAt > now) return false;
  if (expiresAt !== null && now >= expiresAt) return false;
  return true;
}

/** Read the stored planOverride as-is (active or not); null when absent/invalid. */
export function readStoredPlanOverride(userDoc: any): OverrideSource | null {
  const raw = userDoc?.planOverride;
  if (!raw || typeof raw !== "object") return null;
  const planId = typeof raw.planId === "string" ? raw.planId.trim() : "";
  if (!planId) return null;
  return {
    planId,
    reason: typeof raw.reason === "string" ? raw.reason : "",
    createdBy: typeof raw.createdBy === "string" ? raw.createdBy : "",
    startsAt: toEpochMsLoose(raw.startsAt) ?? 0,
    expiresAt: toEpochMsLoose(raw.expiresAt),
    createdAt: toEpochMsLoose(raw.createdAt) ?? undefined,
  };
}

/**
 * Active override for a user, or null. A stored `planOverride` (even an
 * expired one) takes precedence over the legacy fields; the legacy fields are
 * only read when no `planOverride` exists at all.
 */
export function readActiveOverride(userDoc: any, now: number): OverrideSource | null {
  const stored = readStoredPlanOverride(userDoc);
  if (stored) return isOverrideActive(stored, now) ? stored : null;
  if (userDoc?.planOverride) return null;

  const legacyPlanId = typeof userDoc?.adminOverridePlanId === "string" ? userDoc.adminOverridePlanId.trim() : "";
  if (legacyPlanId) {
    return {
      planId: legacyPlanId,
      reason: "legacy adminOverridePlanId",
      createdBy: "",
      startsAt: 0,
      expiresAt: null,
      legacy: true,
      legacyField: "adminOverridePlanId",
    };
  }
  if (userDoc?.adminOverride === true) {
    return {
      planId: INTERNAL_PLAN_ID,
      reason: "legacy adminOverride flag",
      createdBy: "",
      startsAt: 0,
      expiresAt: null,
      legacy: true,
      legacyField: "adminOverride",
    };
  }
  return null;
}

export function isInternalAdmin(userDoc: any, adminsCollectionFlag: boolean): boolean {
  return userDoc?.isAdmin === true || userDoc?.admin?.isAdmin === true || adminsCollectionFlag === true;
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

const PAID_PLAN_IDS = new Set(["starter", "pro", "basic", "enterprise"]);
// Only terminal states block. past_due / incomplete are Stripe's retry window:
// the customer keeps their paid plan until Stripe gives up (unpaid/canceled),
// matching the invoice.payment_failed policy in the webhook.
const BAD_BILLING_STATUSES = new Set(["unpaid", "incomplete_expired", "canceled"]);

export function isPaidBasePlan(planId: string): boolean {
  let canonical = String(planId || "").toLowerCase();
  canonical = canonical.replace(/_(paid|trial)$/i, "");
  return PAID_PLAN_IDS.has(canonical);
}

/**
 * Why a paid base plan cannot apply (null = no problem). Never applies when
 * billing is not enforced (platform billing off / user test mode).
 */
export function computeBillingBlock(userDoc: any, basePlanId: string, billingEnforced: boolean): string | null {
  if (!billingEnforced) return null;
  if (!isPaidBasePlan(basePlanId)) return null;
  const subscriptionId = userDoc?.stripeSubscriptionId || userDoc?.billing?.subscriptionId;
  if (!subscriptionId) return "Missing subscription";
  const status = userDoc?.billingStatus;
  // billingActive=false is also written during Stripe's retry window
  // (past_due); only treat it as blocking when the status doesn't say otherwise.
  if (userDoc?.billingActive === false && !(status && !BAD_BILLING_STATUSES.has(String(status)))) {
    return "Billing inactive";
  }
  if (status && BAD_BILLING_STATUSES.has(String(status))) return `Billing ${status}`;
  if (!status) return "Missing billing status";
  return null;
}

export function readBillingEnforced(userDoc: any, platformBillingEnabled: boolean): boolean {
  const userBillingEnabled = userDoc?.billingEnabled === false ? false : true;
  return platformBillingEnabled && userBillingEnabled;
}

// ---------------------------------------------------------------------------
// Feature combination
// ---------------------------------------------------------------------------

/** Plan features AND platform switches. */
export function combineFeatures(plan: EntitlementFeatures, flags: PlatformFlags): EntitlementFeatures {
  const recording = plan.recording && flags.recording;
  const monetization = plan.monetization && flags.monetizationEnabled;
  return {
    multistream: plan.multistream && flags.transcodeEnabled,
    recording,
    dualRecording: plan.dualRecording && recording,
    hls: plan.hls && flags.hlsSettingsTab,
    hlsCustomization: plan.hlsCustomization && flags.hlsSettingsTab,
    editing: plan.editing && flags.editorEnabled,
    projects: plan.projects && flags.projectsEnabled,
    contentLibrary: plan.contentLibrary && flags.contentLibraryEnabled,
    monetization,
    payPerView: plan.payPerView && flags.payPerViewEnabled && monetization,
    invisibleHost: plan.invisibleHost && flags.invisibleHostEnabled,
    overages: plan.overages,
    watermark: plan.watermark,
  };
}

/** Which platform switch gates a feature (for FEATURE_DISABLED vs NOT_ENTITLED errors). */
export function platformSwitchFor(feature: FeatureKey, flags: PlatformFlags): boolean {
  switch (feature) {
    case "multistream":
      return flags.transcodeEnabled;
    case "recording":
    case "dualRecording":
      return flags.recording;
    case "hls":
    case "hlsCustomization":
      return flags.hlsSettingsTab;
    case "editing":
      return flags.editorEnabled;
    case "projects":
      return flags.projectsEnabled;
    case "contentLibrary":
      return flags.contentLibraryEnabled;
    case "monetization":
      return flags.monetizationEnabled;
    case "payPerView":
      return flags.payPerViewEnabled && flags.monetizationEnabled;
    case "invisibleHost":
      return flags.invisibleHostEnabled;
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Full resolution
// ---------------------------------------------------------------------------

export type ResolveInput = {
  uid: string;
  /** users/{uid} data ({} when missing). */
  userDoc: any;
  /** admins/{uid}.isAdmin === true */
  adminsCollectionFlag: boolean;
  /** config/features.billingSystemEnabled (default true). */
  platformBillingEnabled: boolean;
  /**
   * Firestore plan docs by id for every candidate plan id. `null`/`undefined`
   * means the doc does not exist (known ids then use the built-in catalog).
   */
  planDocs: Record<string, any | null | undefined>;
  flags: PlatformFlags;
  now: number;
};

/** Plan doc for an id, or null when neither Firestore nor the catalog knows it. */
export function planDocFor(planId: string, planDocs: ResolveInput["planDocs"]): any | null {
  const stored = planDocs[planId];
  if (stored) return stored;
  return getCatalogPlan(planId);
}

/** Every plan id the resolver may need (so loaders can fetch them up front). */
export function candidatePlanIds(userDoc: any, now: number): string[] {
  const ids = new Set<string>([FALLBACK_PLAN_ID, INTERNAL_PLAN_ID]);
  const base = typeof userDoc?.planId === "string" ? userDoc.planId.trim() : "";
  if (base) ids.add(base);
  const override = readActiveOverride(userDoc, now);
  if (override) ids.add(override.planId);
  return Array.from(ids);
}

export function resolveEntitlements(input: ResolveInput): ResolvedEntitlements {
  const { userDoc = {}, planDocs, flags, now } = input;

  const storedBase = typeof userDoc.planId === "string" ? userDoc.planId.trim() : "";
  const basePlanId = storedBase && planDocFor(storedBase, planDocs) ? storedBase : FALLBACK_PLAN_ID;

  const billingEnforced = readBillingEnforced(userDoc, input.platformBillingEnabled);
  const subscriptionId =
    (typeof userDoc.stripeSubscriptionId === "string" && userDoc.stripeSubscriptionId) ||
    (typeof userDoc.billing?.subscriptionId === "string" && userDoc.billing.subscriptionId) ||
    null;
  const blockedReason = computeBillingBlock(userDoc, basePlanId, billingEnforced);
  const subscription: SubscriptionSource = {
    status: String(userDoc.billingTruth?.status ?? userDoc.billingStatus ?? (subscriptionId ? "unknown" : "none")),
    subscriptionId,
    blocked: !!blockedReason,
    blockedReason,
    billingEnforced,
  };

  let override = readActiveOverride(userDoc, now);
  if (override && !planDocFor(override.planId, planDocs)) {
    // Override points at a plan that no longer exists: ignore it.
    override = null;
  }
  const internalAdmin = isInternalAdmin(userDoc, input.adminsCollectionFlag);

  let planId: string;
  let decidedBy: EffectiveEntitlements["source"]["decidedBy"];
  if (override) {
    planId = override.planId;
    decidedBy = "override";
  } else if (internalAdmin) {
    planId = INTERNAL_PLAN_ID;
    decidedBy = "internal_admin";
  } else if (blockedReason) {
    planId = FALLBACK_PLAN_ID;
    decidedBy = "billing_block";
  } else {
    planId = basePlanId;
    decidedBy = "base";
  }

  const plan: NormalizedPlan = normalizePlanDoc(planId, planDocFor(planId, planDocs) || {});

  const grants: FeatureKey[] = [];
  const planFeatures: EntitlementFeatures = { ...plan.features };
  if (userDoc.adminOverrideHls === true && !planFeatures.hls) {
    planFeatures.hls = true;
    grants.push("hls");
  }

  return {
    planId: plan.id,
    planName: plan.name,
    features: combineFeatures(planFeatures, flags),
    planFeatures,
    limits: { ...plan.limits },
    source: {
      basePlan: basePlanId,
      subscription,
      adminOverride: override,
      internalAdmin,
      decidedBy,
      grants,
    },
    platformFlags: { ...flags },
    computedAt: now,
    plan,
  };
}

/** Client/wire shape (no raw plan doc). Same shape as EffectiveEntitlements. */
export function serializeEntitlements(ent: EffectiveEntitlements): EffectiveEntitlements {
  return {
    planId: ent.planId,
    planName: ent.planName,
    features: { ...ent.features },
    planFeatures: { ...ent.planFeatures },
    limits: { ...ent.limits },
    source: {
      ...ent.source,
      adminOverride: ent.source.adminOverride ? { ...ent.source.adminOverride } : null,
      subscription: { ...ent.source.subscription },
      grants: [...ent.source.grants],
    },
    platformFlags: { ...ent.platformFlags },
    computedAt: ent.computedAt,
  };
}
