/**
 * Pure planning helpers for scripts/migratePlansToV2.ts (no I/O).
 *
 * Plan docs: legacy (no limitsVersion) -> v2 (null = unlimited, 0 = none),
 * preserving each plan's CURRENT runtime meaning (legacy 0 = unlimited
 * becomes null). The previous entitlement fields are kept under
 * `legacyEntitlementsBackup` so a migration can be inspected / reverted.
 *
 * User docs: legacy adminOverridePlanId / adminOverride:true -> planOverride.
 */
import { isV2PlanDoc, toPlanDocV2 } from "./normalizePlanV2";
import { INTERNAL_PLAN_ID } from "./planCatalog";
import type { PlanOverride } from "./types";

export type PlanMigrationStep = {
  planId: string;
  action: "skip_already_v2" | "migrate";
  /** Fields to write with mergeFields (only for "migrate"). */
  update?: Record<string, any>;
  before?: { features: any; limits: any; editing: any; caps: any };
};

export function planPlanMigration(planId: string, doc: any, nowIso: string): PlanMigrationStep {
  if (isV2PlanDoc(doc)) return { planId, action: "skip_already_v2" };
  const v2 = toPlanDocV2(planId, doc || {});
  const before = {
    features: doc?.features ?? null,
    limits: doc?.limits ?? null,
    editing: doc?.editing ?? null,
    caps: doc?.caps ?? null,
  };
  return {
    planId,
    action: "migrate",
    before,
    update: {
      limitsVersion: v2.limitsVersion,
      features: v2.features,
      limits: v2.limits,
      legacyEntitlementsBackup: { ...before, migratedAt: nowIso },
      updatedAt: nowIso,
    },
  };
}

export type UserOverrideMigrationStep = {
  uid: string;
  action: "skip" | "migrate";
  planOverride?: PlanOverride;
};

export function planUserOverrideMigration(uid: string, userDoc: any, now: number): UserOverrideMigrationStep {
  if (!userDoc || userDoc.planOverride) return { uid, action: "skip" };
  const legacyPlanId = typeof userDoc.adminOverridePlanId === "string" ? userDoc.adminOverridePlanId.trim() : "";
  const planId = legacyPlanId || (userDoc.adminOverride === true ? INTERNAL_PLAN_ID : "");
  if (!planId) return { uid, action: "skip" };
  return {
    uid,
    action: "migrate",
    planOverride: {
      planId,
      reason: legacyPlanId ? "Migrated from adminOverridePlanId" : "Migrated from adminOverride flag",
      createdBy: "migration:migratePlansToV2",
      startsAt: 0,
      expiresAt: null,
      createdAt: now,
    },
  };
}
