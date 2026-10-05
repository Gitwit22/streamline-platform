/**
 * Entitlement service core (dependency-injected; no Firestore import so it is
 * unit-testable). lib/entitlements/index.ts wires it to Firestore.
 */
import { LIMIT_ERRORS, type LimitErrorCode } from "../limitErrors";
import { candidatePlanIds, platformSwitchFor, resolveEntitlements } from "./resolvePlan";
import {
  hasRoomFor,
  remaining,
  type EffectiveEntitlements,
  type FeatureKey,
  type Limit,
  type LimitKey,
  type PlatformFlags,
  type ResolvedEntitlements,
} from "./types";

export type EntitlementDeps = {
  loadUserDoc: (uid: string) => Promise<any | null>;
  loadAdminsCollectionFlag: (uid: string) => Promise<boolean>;
  loadPlanDocs: (planIds: string[]) => Promise<Record<string, any | null>>;
  loadPlatformFlags: () => Promise<PlatformFlags>;
  loadPlatformBillingEnabled: () => Promise<boolean>;
  now?: () => number;
};

export type FeatureCheck = {
  allowed: boolean;
  feature: FeatureKey;
  planId: string;
  /** Set when !allowed: FEATURE_DISABLED (platform switch off) or FEATURE_NOT_ENTITLED (plan). */
  code?: LimitErrorCode;
  reason?: string;
};

export type LimitCheck = {
  allowed: boolean;
  limitKey: LimitKey;
  limit: Limit;
  used: number;
  requested: number;
  remaining: number | null;
  planId: string;
  code?: LimitErrorCode;
  reason?: string;
};

const FEATURE_LABELS: Record<FeatureKey, string> = {
  multistream: "Stream destinations",
  recording: "Recording",
  dualRecording: "Dual recording",
  hls: "HLS broadcast",
  hlsCustomization: "HLS page customization",
  editing: "Editor",
  projects: "Projects",
  contentLibrary: "Content library",
  monetization: "Monetization",
  payPerView: "Pay-per-view",
  invisibleHost: "Invisible host",
  audioMixer: "Audio mixer",
  advancedScreenShare: "Advanced screen share",
  overages: "Overages",
  watermark: "Watermark",
};

/** Pure feature check against already-resolved entitlements. */
export function checkFeature(ent: EffectiveEntitlements, feature: FeatureKey): FeatureCheck {
  if (ent.features[feature]) return { allowed: true, feature, planId: ent.planId };
  const label = FEATURE_LABELS[feature] || feature;
  if (ent.planFeatures[feature] && !platformSwitchFor(feature, ent.platformFlags)) {
    return {
      allowed: false,
      feature,
      planId: ent.planId,
      code: LIMIT_ERRORS.FEATURE_DISABLED,
      reason: `${label} is disabled platform-wide`,
    };
  }
  return {
    allowed: false,
    feature,
    planId: ent.planId,
    code: LIMIT_ERRORS.FEATURE_NOT_ENTITLED,
    reason: ent.source.subscription.blocked
      ? `Billing issue: ${ent.source.subscription.blockedReason}`
      : `${label} is not available on your plan`,
  };
}

/** Pure limit check: may `requested` more units be used on top of `used`? */
export function checkLimit(ent: EffectiveEntitlements, limitKey: LimitKey, used: number, requested = 1): LimitCheck {
  const limit = ent.limits[limitKey] as Limit;
  const allowed = hasRoomFor(used, limit, requested);
  const base: LimitCheck = {
    allowed,
    limitKey,
    limit,
    used: Math.max(0, Number(used) || 0),
    requested,
    remaining: remaining(limit, used),
    planId: ent.planId,
  };
  if (allowed) return base;
  return {
    ...base,
    code: LIMIT_ERRORS.LIMIT_EXCEEDED,
    reason: limit === 0 ? `Your plan does not include ${limitKey}` : `Plan limit reached for ${limitKey} (${limit})`,
  };
}

/** Thrown by assertFeature / assertWithinLimit. */
export class EntitlementError extends Error {
  status: number;
  code: LimitErrorCode;
  body: Record<string, any>;
  constructor(status: number, code: LimitErrorCode, body: Record<string, any>) {
    super(String(body.reason || code));
    this.status = status;
    this.code = code;
    this.body = { error: code, ...body };
  }
}

export function isEntitlementError(err: unknown): err is EntitlementError {
  return err instanceof EntitlementError;
}

export function createEntitlementService(deps: EntitlementDeps, opts: { ttlMs?: number } = {}) {
  const ttlMs = opts.ttlMs ?? 5_000;
  const now = deps.now || (() => Date.now());
  const cache = new Map<string, { at: number; value: Promise<ResolvedEntitlements> }>();

  async function compute(uid: string): Promise<ResolvedEntitlements> {
    const t = now();
    const [userDoc, adminsFlag, flags, platformBillingEnabled] = await Promise.all([
      deps.loadUserDoc(uid),
      deps.loadAdminsCollectionFlag(uid).catch(() => false),
      deps.loadPlatformFlags(),
      deps.loadPlatformBillingEnabled().catch(() => true),
    ]);
    const doc = userDoc || {};
    const planDocs = await deps.loadPlanDocs(candidatePlanIds(doc, t));
    return resolveEntitlements({
      uid,
      userDoc: doc,
      adminsCollectionFlag: adminsFlag,
      platformBillingEnabled,
      planDocs,
      flags,
      now: t,
    });
  }

  async function getEffectiveEntitlements(uid: string, options: { fresh?: boolean } = {}): Promise<ResolvedEntitlements> {
    const key = String(uid || "").trim();
    if (!key) throw new Error("getEffectiveEntitlements: uid is required");
    const t = now();
    const hit = cache.get(key);
    if (!options.fresh && hit && t - hit.at < ttlMs) return hit.value;
    const value = compute(key);
    cache.set(key, { at: t, value });
    value.catch(() => {
      if (cache.get(key)?.value === value) cache.delete(key);
    });
    if (cache.size > 5_000) {
      for (const [k, v] of cache) if (t - v.at >= ttlMs) cache.delete(k);
    }
    return value;
  }

  function invalidate(uid?: string) {
    if (uid) cache.delete(String(uid).trim());
    else cache.clear();
  }

  async function resolveArg(uidOrEnt: string | EffectiveEntitlements): Promise<EffectiveEntitlements> {
    return typeof uidOrEnt === "string" ? getEffectiveEntitlements(uidOrEnt) : uidOrEnt;
  }

  /** Throws EntitlementError (403) unless the feature is usable. Returns the entitlements. */
  async function assertFeature(uidOrEnt: string | EffectiveEntitlements, feature: FeatureKey): Promise<EffectiveEntitlements> {
    const ent = await resolveArg(uidOrEnt);
    const check = checkFeature(ent, feature);
    if (!check.allowed) {
      throw new EntitlementError(403, check.code, { feature, reason: check.reason, planId: ent.planId });
    }
    return ent;
  }

  /** Throws EntitlementError (409 limit_exceeded / 403 when the plan has none) unless `requested` more fit. */
  async function assertWithinLimit(
    uidOrEnt: string | EffectiveEntitlements,
    limitKey: LimitKey,
    used: number,
    requested = 1
  ): Promise<LimitCheck> {
    const ent = await resolveArg(uidOrEnt);
    const check = checkLimit(ent, limitKey, used, requested);
    if (!check.allowed) {
      throw new EntitlementError(check.limit === 0 ? 403 : 409, LIMIT_ERRORS.LIMIT_EXCEEDED, {
        limitKey,
        limit: check.limit,
        used: check.used,
        requested,
        reason: check.reason,
        planId: ent.planId,
      });
    }
    return check;
  }

  return { getEffectiveEntitlements, invalidate, assertFeature, assertWithinLimit };
}

export type EntitlementService = ReturnType<typeof createEntitlementService>;
