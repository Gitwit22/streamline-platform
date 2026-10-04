/**
 * THE entitlement engine. Every plan / limit / feature decision on the server
 * goes through here:
 *
 *   const ent = await getEffectiveEntitlements(uid);   // cached ~5s per uid
 *   ent.planId                  // effective plan (override > admin > base)
 *   ent.features.multistream    // plan AND platform switch
 *   ent.limits.destinations     // null = unlimited, 0 = none
 *
 *   await assertFeature(uid, "recording");              // throws EntitlementError
 *   await assertWithinLimit(uid, "projects", count);    // throws EntitlementError
 *
 * Cleanup is never gated: DELETE / revoke / download of the caller's own data
 * must not call these helpers.
 */
import type { Response } from "express";
import { firestore } from "../../firebaseAdmin";
import { getPlatformBillingEnabled } from "../userAccount";
import { normalizePlanDoc } from "./normalizePlanV2";
import { getCatalogPlan } from "./planCatalog";
import {
  PLATFORM_FLAG_NAMES,
  readTranscodeEnabledEnv,
  resolvePlatformFlags,
  type PlatformFlagName,
} from "./flags";
import {
  createEntitlementService,
  isEntitlementError,
  type EntitlementError,
} from "./service";
import type { NormalizedPlan, PlatformFlags } from "./types";

export * from "./types";
export * from "./flags";
export { normalizePlanDoc, toPlanDocV2, sanitizePlanV2Input, isV2PlanDoc } from "./normalizePlanV2";
export {
  PLAN_CATALOG_V2,
  PLAN_LIMITS_VERSION,
  INTERNAL_PLAN_ID,
  FALLBACK_PLAN_ID,
  getCatalogPlan,
} from "./planCatalog";
export {
  resolveEntitlements,
  serializeEntitlements,
  readActiveOverride,
  readStoredPlanOverride,
  isOverrideActive,
  combineFeatures,
} from "./resolvePlan";
export { checkFeature, checkLimit, EntitlementError, isEntitlementError } from "./service";
export { toLegacyEntitlementsPayload, LEGACY_UNLIMITED_COUNT } from "./legacyPayload";
export type { FeatureCheck, LimitCheck } from "./service";

// ---------------------------------------------------------------------------
// Firestore-backed caches
// ---------------------------------------------------------------------------

const PLAN_CACHE_TTL_MS = 15_000;
const FLAGS_CACHE_TTL_MS = 15_000;

const planCache = new Map<string, { at: number; doc: any | null }>();

async function loadPlanDocs(planIds: string[]): Promise<Record<string, any | null>> {
  const now = Date.now();
  const out: Record<string, any | null> = {};
  const missing: string[] = [];
  for (const id of planIds) {
    const hit = planCache.get(id);
    if (hit && now - hit.at < PLAN_CACHE_TTL_MS) out[id] = hit.doc;
    else missing.push(id);
  }
  if (missing.length) {
    const refs = missing.map((id) => firestore.collection("plans").doc(id));
    const snaps = await firestore.getAll(...refs);
    snaps.forEach((snap, i) => {
      const id = missing[i];
      const doc = snap.exists ? (snap.data() as any) || {} : null;
      planCache.set(id, { at: now, doc });
      out[id] = doc;
    });
  }
  return out;
}

export function invalidatePlanCache(planId?: string) {
  if (planId) planCache.delete(planId);
  else planCache.clear();
  service.invalidate();
}

let flagsCache: { at: number; value: Promise<PlatformFlags> } | null = null;

async function readPlatformFlagsFromFirestore(): Promise<PlatformFlags> {
  const refs = PLATFORM_FLAG_NAMES.map((name) => firestore.collection("featureFlags").doc(name));
  try {
    const snaps = await firestore.getAll(...refs);
    const docs: Partial<Record<PlatformFlagName, any>> = {};
    snaps.forEach((snap, i) => {
      if (snap.exists) docs[PLATFORM_FLAG_NAMES[i]] = snap.data() || {};
    });
    return resolvePlatformFlags(docs, readTranscodeEnabledEnv());
  } catch (err: any) {
    console.error("[entitlements] failed to load platform flags; using defaults", err?.message || err);
    return resolvePlatformFlags({}, readTranscodeEnabledEnv());
  }
}

/** All platform flags (single defaults table, cached ~15s). */
export async function getPlatformFlags(): Promise<PlatformFlags> {
  const now = Date.now();
  if (flagsCache && now - flagsCache.at < FLAGS_CACHE_TTL_MS) return flagsCache.value;
  const value = readPlatformFlagsFromFirestore();
  flagsCache = { at: now, value };
  return value;
}

export async function getPlatformFlag(name: PlatformFlagName): Promise<boolean> {
  return (await getPlatformFlags())[name];
}

export function invalidatePlatformFlags() {
  flagsCache = null;
  service.invalidate();
}

async function loadAdminsCollectionFlag(uid: string): Promise<boolean> {
  const snap = await firestore.collection("admins").doc(uid).get();
  return snap.exists && (snap.data() as any)?.isAdmin === true;
}

async function loadUserDoc(uid: string): Promise<any | null> {
  const snap = await firestore.collection("users").doc(uid).get();
  return snap.exists ? (snap.data() as any) || {} : null;
}

const service = createEntitlementService({
  loadUserDoc,
  loadAdminsCollectionFlag,
  loadPlanDocs,
  loadPlatformFlags: getPlatformFlags,
  loadPlatformBillingEnabled: getPlatformBillingEnabled,
});

export const getEffectiveEntitlements = service.getEffectiveEntitlements;
export const assertFeature = service.assertFeature;
export const assertWithinLimit = service.assertWithinLimit;
/** Drop cached entitlements (one user, or everyone). Call after override / plan changes. */
export const invalidateEntitlements = service.invalidate;

/** Normalized plan by id (Firestore doc, else built-in catalog, else null). */
export async function getNormalizedPlan(planId: string): Promise<NormalizedPlan | null> {
  const docs = await loadPlanDocs([planId]);
  const doc = docs[planId] || getCatalogPlan(planId);
  return doc ? normalizePlanDoc(planId, doc) : null;
}

/** Send an EntitlementError as JSON; returns false when `err` is not one. */
export function sendEntitlementError(res: Response, err: unknown): boolean {
  if (!isEntitlementError(err)) return false;
  const e = err as EntitlementError;
  res.status(e.status).json(e.body);
  return true;
}
