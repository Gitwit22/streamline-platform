/**
 * PUT /api/admin/plans/:planId
 * Update a plan document (any field except id)
 */

console.log("✅ admin.ts loaded");
import express from "express";

import { firestore, auth as firebaseAuth } from "../firebaseAdmin";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { requireAdmin, logAdminAction } from "../middleware/adminAuth";
import { computeUsageSummaryResult } from "./usageRoutes";
import { getPlatformBillingEnabled, invalidatePlatformBillingCache } from "../lib/userAccount";

import type { UserUsageSummary } from "../types/admin.types";
import { getCurrentMonthKey } from "../lib/usageTracker";
import {
  PLAN_CATALOG_V2,
  PLAN_LIMITS_VERSION,
  adminSeededFlagList,
  getCatalogPlan,
  getEffectiveEntitlements,
  getPlatformFlags,
  invalidateEntitlements,
  invalidatePlanCache,
  invalidatePlatformFlags,
  isOverrideActive,
  normalizePlanDoc,
  readStoredPlanOverride,
  resolveEntitlements,
  sanitizePlanV2Input,
  serializeEntitlements,
  toPlanDocV2,
  type PlatformFlags,
} from "../lib/entitlements";
import { evaluateStreamingGate, readStreamingMinutes } from "../lib/streamingMeterPure";
import { getStreamingUsageStatus, readOveragesEnabled } from "../lib/streamingMeter";
import { PLAN_IDS, PlanId, isPlanId, getAllPlanIds } from "../types/plan";
import {
  buildAdminPasswordResetState,
  buildPublicPasswordResetState,
  buildPublicRecoveryState,
  canAdminManagePasswordReset,
  generateAdminResetSecret,
  hashAdminResetSecret,
} from "../lib/accountRecovery";
import { logAuthSecurityEvent } from "../lib/authAudit";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { normalizeBillingTruthFromUser } from "../lib/billingTruth";
import adminMonitoringRoutes from "./adminMonitoring";
import adminJobsRoutes from "./adminJobs";
import { deleteAccount, loadDeletionImpact, restoreAccount } from "../lib/accountDeletion";
import { parseDeletionRequest } from "../lib/accountDeletionCore";
import {
  grantCredit,
  loadAllCredits,
  loadCreditsWithRemaining,
  migrateLegacyBonusMinutes,
  revokeCredit,
  serializeCredit,
  summarizeCredits,
} from "../lib/usageCredits";
import { activeCreditRemaining, validateCreditGrant } from "../lib/usageCreditsPure";
import { computePeriodCounters, computePlatformStats, countQuery, listUsersPage } from "../lib/adminMetrics";
import { normalizeUserListQuery } from "../lib/adminMetricsPure";
import { planMissingFieldsPatch, planResetDiff, sanitizePlanMetaInput } from "../lib/planSeedPure";
import adminSupportTicketsRoutes from "./adminSupportTickets";

// Admin responses must never include credential material. Strip hashes and
// replace reset/recovery state with their public views.
function toAdminSafeUser(raw: any): any {
  const {
    passwordHash: _passwordHash,
    passwordReset,
    recovery,
    emergencyCodeHash: _emergencyCodeHash,
    ...rest
  } = (raw || {}) as any;
  return {
    ...rest,
    passwordReset: buildPublicPasswordResetState(passwordReset),
    recovery: buildPublicRecoveryState(recovery),
    recoveryConfigured: buildPublicRecoveryState(recovery).configured,
  };
}

const router = express.Router();

function toMillis(value: any): number | null {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value?.toMillis === "function") {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    const ms = d?.getTime?.();
    return Number.isFinite(ms) ? ms : null;
  }
  const parsed = new Date(value);
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function parsePeriodRange(query: any): { startMs: number; endMs: number } {
  const now = Date.now();
  const period = String(query.period || "30d").trim().toLowerCase();
  const startRaw = typeof query.start === "string" ? query.start : query.startDate;
  const endRaw = typeof query.end === "string" ? query.end : query.endDate;

  const explicitStart = toMillis(startRaw);
  const explicitEnd = toMillis(endRaw);
  if (explicitStart !== null || explicitEnd !== null) {
    const startMs = explicitStart ?? now - 30 * 24 * 60 * 60 * 1000;
    const endMs = explicitEnd ?? now;
    return { startMs: Math.min(startMs, endMs), endMs: Math.max(startMs, endMs) };
  }

  const dayMs = 24 * 60 * 60 * 1000;
  if (period === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { startMs: d.getTime(), endMs: now };
  }
  if (period === "week" || period === "7d") {
    return { startMs: now - 7 * dayMs, endMs: now };
  }
  if (period === "month") {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return { startMs: d.getTime(), endMs: now };
  }
  if (period === "90d") {
    return { startMs: now - 90 * dayMs, endMs: now };
  }
  if (period === "all") {
    return { startMs: 0, endMs: now };
  }

  // Default and "30d"
  return { startMs: now - 30 * dayMs, endMs: now };
}

function readPath(obj: any, path: string): any {
  return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), obj);
}

function resolveProgramContext(req: any): string | null {
  const q = req.query || {};
  const programRaw =
    q.programId ||
    q.activeProgramId ||
    q.program ||
    req.header?.("x-program-id") ||
    req.header?.("x-active-program-id") ||
    "";
  const value = String(programRaw || "").trim();
  return value || null;
}

function matchesProgramContext(data: any, activeProgramId: string | null): boolean {
  if (!activeProgramId) return true;
  const candidates = [
    readPath(data, "programId"),
    readPath(data, "activeProgramId"),
    readPath(data, "program.id"),
    readPath(data, "programContext.programId"),
    readPath(data, "meta.programId"),
  ]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
  return candidates.includes(activeProgramId);
}

function isInRange(ms: number | null, startMs: number, endMs: number): boolean {
  if (ms === null) return false;
  return ms >= startMs && ms <= endMs;
}

function getDocMillis(data: any, fields: string[]): number | null {
  for (const field of fields) {
    const raw = readPath(data, field);
    const ms = toMillis(raw);
    if (ms !== null) return ms;
  }
  return null;
}

function buildMonthKeys(startMs: number, endMs: number): Set<string> {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  const keys = new Set<string>();
  while (cursor <= endMonth) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    keys.add(key);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

function getDeletedAtMs(raw: any): number | null {
  if (!raw) return null;
  const deletedAtMs =
    typeof raw.deletedAtMs === "number"
      ? raw.deletedAtMs
      : typeof raw.deletedAt === "number"
        ? raw.deletedAt
        : null;
  return deletedAtMs && deletedAtMs > 0 ? deletedAtMs : null;
}

function isDeletedUserRecord(raw: any): boolean {
  const status = typeof raw?.accountStatus === "string" ? String(raw.accountStatus).toLowerCase() : "";
  return status === "deleted" || Boolean(getDeletedAtMs(raw));
}

type AdminPlanContext = {
  plansMap: Record<string, any>;
  flags: PlatformFlags;
  platformBillingEnabled: boolean;
  adminUids: Set<string>;
  now: number;
};

async function loadAdminPlanContext(): Promise<AdminPlanContext> {
  const [plansSnap, flags, platformBillingEnabled, adminsSnap] = await Promise.all([
    firestore.collection("plans").get(),
    getPlatformFlags(),
    getPlatformBillingEnabled().catch(() => true),
    firestore.collection("admins").get().catch(() => null as any),
  ]);
  const adminUids = new Set<string>();
  adminsSnap?.docs?.forEach((d: any) => {
    if ((d.data() as any)?.isAdmin === true) adminUids.add(d.id);
  });
  return {
    plansMap: Object.fromEntries(plansSnap.docs.map((d) => [d.id, d.data()])),
    flags,
    platformBillingEnabled,
    adminUids,
    now: Date.now(),
  };
}

/**
 * Stripe/base plan vs admin override vs EFFECTIVE plan for one user, resolved
 * by the same engine as every runtime gate (no Firestore reads per user).
 */
function buildAdminPlanView(uid: string, userData: any, ctx: AdminPlanContext) {
  const ent = resolveEntitlements({
    uid,
    userDoc: userData || {},
    adminsCollectionFlag: ctx.adminUids.has(uid),
    platformBillingEnabled: ctx.platformBillingEnabled,
    planDocs: ctx.plansMap,
    flags: ctx.flags,
    now: ctx.now,
  });
  const stored = readStoredPlanOverride(userData || {});
  const legacy = ent.source.adminOverride?.legacy ? ent.source.adminOverride : null;
  const override = stored || legacy;
  return {
    ent,
    view: {
      basePlanId: ent.source.basePlan,
      effectivePlanId: ent.planId,
      decidedBy: ent.source.decidedBy,
      subscriptionBlockedReason: ent.source.subscription.blockedReason,
      planOverride: override
        ? {
            ...override,
            active: stored ? isOverrideActive(stored, ctx.now) : true,
          }
        : null,
    },
  };
}

// All routes require admin authentication
router.use(requireAdmin);
// In routes/admin.ts
router.use((req, res, next) => {
  console.log("🚀 Admin router received:", req.method, req.path);
  next();
});

router.get('/me', (req, res) => {
  res.json({ isAdmin: true, user: req.adminUser });
});

router.post("/users/:userId/enable-password-reset", async (req, res) => {
  try {
    const { userId } = req.params;
    const targetRef = firestore.collection("users").doc(userId);
    const targetSnap = await targetRef.get();

    if (!targetSnap.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const targetUser = targetSnap.data() || {};
    if (isDeletedUserRecord(targetUser)) {
      return res.status(400).json({ error: "Cannot enable password reset for a deleted user" });
    }

    const adminUid = req.adminUser?.uid || "";
    if (!canAdminManagePasswordReset(adminUid, userId, targetUser)) {
      return res.status(403).json({ error: "Not allowed to enable password reset for this user" });
    }

    const now = Date.now();
    // Single-use secret the admin hands to the user out of band. Only its hash
    // is stored; the plaintext is returned once in this response and never again.
    // Enabling again issues a new secret and invalidates the previous one.
    const resetSecret = generateAdminResetSecret();
    const passwordReset = buildAdminPasswordResetState(adminUid, hashAdminResetSecret(resetSecret), now);

    await targetRef.set(
      {
        passwordReset,
        updatedAt: now,
      },
      { merge: true }
    );

    await logAdminAction(adminUid, "enable_password_reset", {
      userId,
      expiresAt: passwordReset.expiresAt,
    });
    await logAuthSecurityEvent({
      event: "admin_password_reset_enabled",
      actorUserId: adminUid,
      targetUserId: userId,
      ip: req.ip || null,
      details: {
        expiresAt: passwordReset.expiresAt,
      },
    });

    res.setHeader("Cache-Control", "no-store");
    return res.json({
      success: true,
      resetSecret,
      passwordReset: buildPublicPasswordResetState(passwordReset),
      // Still true: the code is shown only once, so an admin who lost it can
      // issue a new one (which voids this one).
      canEnablePasswordReset: true,
    });
  } catch (error: any) {
    console.error("Failed to enable password reset:", error);
    return res.status(500).json({ error: "Failed to enable password reset" });
  }
});

// Lightweight environment sanity endpoint for admins.
// Returns current admin's user + plan docs, resolved limits and key feature flags.
router.get("/env-sanity", async (req, res) => {
  try {
    const adminUser = req.adminUser;
    const uid = adminUser?.uid;

    if (!uid) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED, message: "Missing admin uid" });
    }

    const userSnap = await firestore.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: "user_doc_missing", uid });
    }

    const user = userSnap.data() || {};

    // Same engine as every runtime gate (fresh, not cached).
    const ent = await getEffectiveEntitlements(uid, { fresh: true });

    return res.json({
      user: {
        uid,
        email: adminUser.email,
        basePlanId: ent.source.basePlan,
        effectivePlanId: ent.planId,
        planLegacy: user.plan ?? null,
        planOverride: ent.source.adminOverride,
        adminOverrideHls: Boolean((user as any).adminOverrideHls),
        admin: user.admin ?? null,
        isAdminUserField: Boolean(user.admin?.isAdmin ?? user.isAdmin),
      },
      plan: {
        id: ent.planId,
        exists: Boolean(ent.plan.raw && Object.keys(ent.plan.raw).length),
        limitsVersion: ent.plan.limitsVersion,
        raw: ent.plan.raw,
        features: ent.features,
        planFeatures: ent.planFeatures,
        limits: ent.limits,
        gating: {
          canUseRtmp: ent.features.multistream,
          canUseMultistream: ent.features.multistream,
          canUseDualRecording: ent.features.dualRecording,
        },
      },
      source: ent.source,
    });
  } catch (err: any) {
    console.error("/api/admin/env-sanity failed:", err);
    return res.status(500).json({
      error: "env_sanity_failed",
    });
  }
});



router.get("/plans", async (req, res) => {
  console.log("🎯 1. Plans route handler started (admin, all plans)");
  try {
    console.log("🎯 2. About to query Firestore for ALL plans");
    const snap = await firestore.collection("plans").get();
    console.log("🎯 3. Firestore returned, docs count:", snap.size);

    // `entitlements` is the v2 view the admin editor edits (null = unlimited,
    // 0 = none), resolved by the same normalizer as every runtime gate.
    const plans = snap.docs.map((d) => {
      const data = (d.data() as any) || {};
      const v2 = normalizePlanDoc(d.id, data);
      return {
        id: d.id,
        ...data,
        entitlements: {
          storedLimitsVersion: v2.limitsVersion,
          features: v2.features,
          limits: { ...toPlanDocV2(d.id, data).limits },
        },
      };
    });
    return res.json({ plans });
  } catch (err: any) {
    console.error("🎯 ERROR in plans route:", err);
    return res.status(500).json({ error: "Failed to load plans" });
  }
});

router.put("/plans/:planId", async (req, res) => {
  try {
    const { planId } = req.params;

    // Validate planId: only allow known plan identifiers
    if (!planId || !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(planId)) {
      return res.status(400).json({ error: "Invalid plan ID format" });
    }

    const body = (req.body && typeof req.body === "object" ? req.body : {}) as any;
    const planRef = firestore.collection("plans").doc(planId);
    const planSnap = await planRef.get();
    const existing = planSnap.exists ? ((planSnap.data() as any) || {}) : {};

    // Entitlement fields are ALWAYS written in v2 form (null = unlimited,
    // 0 = none). v2 bodies (limitsVersion: 2) are validated key-by-key on top
    // of the plan's current meaning; legacy bodies (old admin UI / scripts)
    // are merged onto the stored doc and converted, preserving their meaning.
    const current = toPlanDocV2(planId, planSnap.exists ? existing : getCatalogPlan(planId) || {});
    let features = current.features;
    let limits = current.limits;
    if (Number(body.limitsVersion) === PLAN_LIMITS_VERSION) {
      const { features: f, limits: l, errors } = sanitizePlanV2Input(body);
      if (errors.length) {
        return res.status(400).json({ error: "invalid_plan_entitlements", details: errors });
      }
      features = { ...features, ...f };
      limits = { ...limits, ...l };
    } else if (body.features || body.limits || body.editing || body.caps) {
      const merged = {
        ...existing,
        ...body,
        features: { ...(existing.features || {}), ...(body.features || {}) },
        limits: { ...(existing.limits || {}), ...(body.limits || {}) },
        editing: { ...(existing.editing || {}), ...(body.editing || {}) },
        caps: { ...(existing.caps || {}), ...(body.caps || {}) },
      };
      delete merged.limitsVersion;
      const converted = toPlanDocV2(planId, merged);
      features = converted.features;
      limits = converted.limits;
    }

    // Non-entitlement fields are validated (name, description, priceMonthly
    // (`price` alias), visibility, editing.maxTracks). Unknown keys and the
    // editor sub-options nothing enforces yet are ignored.
    const { meta, errors: metaErrors } = sanitizePlanMetaInput(body);
    if (metaErrors.length) {
      return res.status(400).json({ error: "invalid_plan_fields", details: metaErrors });
    }
    const { editing: editingMeta, ...metaTop } = meta as any;
    const updateData: Record<string, any> = {
      ...metaTop,
      limitsVersion: PLAN_LIMITS_VERSION,
      features,
      limits,
      updatedAt: new Date().toISOString(),
    };
    // editing.maxTracks is written as a field path so other editing keys stay.
    const editingFields: Record<string, any> = {};
    if (editingMeta && typeof editingMeta === "object") {
      for (const [k, v] of Object.entries(editingMeta)) editingFields[`editing.${k}`] = v;
    }
    if (!planSnap.exists) {
      await planRef.set({
        id: planId,
        ...updateData,
        ...(editingMeta ? { editing: editingMeta } : {}),
        createdAt: new Date().toISOString(),
      });
    } else {
      // mergeFields: replace features/limits maps wholesale (no stale legacy keys).
      const writeData: Record<string, any> = { ...updateData };
      const mergeFields: Array<string | FieldPath> = Object.keys(updateData);
      if (Object.keys(editingFields).length) {
        writeData.editing = { ...(existing.editing || {}), ...(editingMeta || {}) };
        for (const k of Object.keys(editingMeta || {})) mergeFields.push(new FieldPath("editing", k));
      }
      await planRef.set(writeData, { mergeFields });
    }
    invalidatePlanCache(planId);
    // Audit: only what changed (entitlements compared on their v2 meaning).
    const beforeV2 = toPlanDocV2(planId, planSnap.exists ? existing : getCatalogPlan(planId) || {});
    const changes: Record<string, { from: any; to: any }> = {};
    const cmp = (path: string, from: any, to: any) => {
      if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) changes[path] = { from: from ?? null, to: to ?? null };
    };
    for (const k of Object.keys(features || {})) cmp(`features.${k}`, (beforeV2.features as any)[k], (features as any)[k]);
    for (const k of Object.keys(limits || {})) cmp(`limits.${k}`, (beforeV2.limits as any)[k], (limits as any)[k]);
    for (const [k, v] of Object.entries(metaTop)) {
      cmp(k, k === "priceMonthly" ? existing.priceMonthly ?? existing.price : existing[k], v);
    }
    for (const [k, v] of Object.entries(editingMeta || {})) cmp(`editing.${k}`, existing.editing?.[k], v);
    await logAdminAction(req.adminUser!.uid, "update_plan", { planId, created: !planSnap.exists, changes });
    res.json({ success: true, planId, updated: updateData, normalized: normalizePlanDoc(planId, { ...existing, ...updateData }) });
  } catch (error: any) {
    console.error("Failed to update plan:", error);
    res.status(500).json({ error: "Failed to update plan" });
  }
});

// ── Seed: add missing plans / missing fields ONLY (never overwrites) ──
/**
 * POST /api/admin/plans/seed
 * Creates canonical plans that don't exist and fills fields a stored plan
 * lacks. Existing values (admin edits, null = Unlimited, 0 = none) are never
 * changed; a legacy (v1) doc is converted to v2 with the same meaning.
 * Use POST /plans/:planId/reset to restore one plan to the catalog defaults.
 */
router.post("/plans/seed", async (req, res) => {
  try {
    const results: {
      created: string[];
      updated: Array<{ planId: string; added: string[]; converted: boolean }>;
      unchanged: string[];
      errors: Array<{ planId: string; error: string }>;
    } = { created: [], updated: [], unchanged: [], errors: [] };

    for (const [planId, canonical] of Object.entries(PLAN_CATALOG_V2)) {
      try {
        const docRef = firestore.collection("plans").doc(planId);
        const existingDoc = await docRef.get();
        const existing = existingDoc.exists ? ((existingDoc.data() as any) || {}) : null;
        const { patch, added, converted, created } = planMissingFieldsPatch(planId, existing, canonical);
        const nowIso = new Date().toISOString();
        if (created) {
          await docRef.set({ ...patch, createdAt: nowIso, updatedAt: nowIso });
          results.created.push(planId);
        } else if (added.length || converted) {
          if (converted) {
            // Converted maps replace the legacy ones wholesale; everything else merges.
            const { features: f, limits: l, limitsVersion: lv, ...rest } = patch as any;
            await docRef.set({ ...rest, updatedAt: nowIso }, { merge: true });
            await docRef.set({ features: f, limits: l, limitsVersion: lv }, { mergeFields: ["features", "limits", "limitsVersion"] });
          } else {
            await docRef.set({ ...patch, updatedAt: nowIso }, { merge: true });
          }
          results.updated.push({ planId, added, converted });
        } else {
          results.unchanged.push(planId);
        }
      } catch (err: any) {
        results.errors.push({ planId, error: err?.message || String(err) });
      }
    }

    invalidatePlanCache();
    await logAdminAction(req.adminUser!.uid, "seed_plans_missing_only", {
      created: results.created,
      updated: results.updated.map((u) => ({ planId: u.planId, added: u.added.slice(0, 50), converted: u.converted })),
      errors: results.errors.length,
    });
    res.json({ success: true, mode: "missing_only", ...results });
  } catch (error: any) {
    console.error("Failed to seed plans:", error);
    res.status(500).json({ error: "Failed to seed plans", details: error.message });
  }
});

/**
 * GET /api/admin/plans/:planId/reset-preview
 * Field-by-field diff of what "Reset plan to defaults" would change.
 */
router.get("/plans/:planId/reset-preview", async (req, res) => {
  try {
    const { planId } = req.params;
    const canonical = getCatalogPlan(planId);
    if (!canonical) return res.status(404).json({ error: "no_catalog_defaults", planId });
    const snap = await firestore.collection("plans").doc(planId).get();
    const diff = planResetDiff(planId, snap.exists ? snap.data() : null, canonical);
    res.json({ success: true, planId, exists: snap.exists, changes: diff, count: diff.length });
  } catch (error: any) {
    console.error("Failed to preview plan reset:", error);
    res.status(500).json({ error: "Failed to preview plan reset" });
  }
});

/**
 * POST /api/admin/plans/:planId/reset   body: { confirm: "RESET" }
 * Overwrites the plan's catalog fields (name, description, priceMonthly,
 * visibility, features, limits) with the built-in defaults. Unrelated fields
 * (e.g. Stripe price ids) are kept. Audit-logged with the full diff.
 */
router.post("/plans/:planId/reset", async (req, res) => {
  try {
    const { planId } = req.params;
    if (req.body?.confirm !== "RESET") return res.status(400).json({ error: "confirm_required", expected: "RESET" });
    const canonical = getCatalogPlan(planId);
    if (!canonical) return res.status(404).json({ error: "no_catalog_defaults", planId });
    const ref = firestore.collection("plans").doc(planId);
    const snap = await ref.get();
    const diff = planResetDiff(planId, snap.exists ? snap.data() : null, canonical);
    const nowIso = new Date().toISOString();
    const payload: any = { ...canonical, id: planId, updatedAt: nowIso };
    if (!snap.exists) payload.createdAt = nowIso;
    await ref.set(payload, { mergeFields: Object.keys(payload) });
    invalidatePlanCache(planId);
    await logAdminAction(req.adminUser!.uid, "reset_plan_to_defaults", { planId, changes: diff });
    res.json({ success: true, planId, changes: diff, count: diff.length });
  } catch (error: any) {
    console.error("Failed to reset plan:", error);
    res.status(500).json({ error: "Failed to reset plan" });
  }
});

/**
 * GET /api/admin/users
 * List all users with usage information
 */
router.get("/users", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const planFilter = req.query.plan as PlanId | undefined;
    const includeDeleted = (() => {
      const raw = String(req.query.includeDeleted || "").trim().toLowerCase();
      return raw === "1" || raw === "true" || raw === "yes";
    })();

    let query = firestore.collection("users").orderBy("createdAt", "desc");

    if (planFilter) {
      query = query.where("planId", "==", planFilter) as any;
    }

    const snapshot = await query.limit(limit).offset(offset).get();

    const now = Date.now();
    const planCtx = await loadAdminPlanContext();
    // "Minutes" column: streaming minutes this month (same reader as the gate).
    const monthKey = getCurrentMonthKey();
    const usageByUid = new Map<string, any>();
    if (snapshot.docs.length) {
      try {
        const usageSnaps = await firestore.getAll(
          ...snapshot.docs.map((d) => firestore.collection("usageMonthly").doc(`${d.id}_${monthKey}`))
        );
        usageSnaps.forEach((u, i) => usageByUid.set(snapshot.docs[i].id, u.exists ? u.data() : {}));
      } catch (e: any) {
        console.warn("[admin/users] usage lookup failed:", e?.message || e);
      }
    }

    const users = await Promise.all(snapshot.docs.map(async (doc) => {
      const raw = doc.data() || {};
      const planId = typeof (raw as any).planId === "string" && String((raw as any).planId).trim() ? (raw as any).planId : "free";
      const billingTruth = normalizeBillingTruthFromUser({ ...raw, planId }, now);
      const { view } = buildAdminPlanView(doc.id, raw, planCtx);
      // One-time usage credit balance (legacy un-migrated bonusMinutes counted as a credit).
      const credits = await loadCreditsWithRemaining(doc.id).catch(() => []);
      const creditSummary = summarizeCredits({ credits, userDoc: raw, usageDoc: {}, usedMinutes: 0, includedMinutes: null, nowMs: now });
      return {
        uid: doc.id,
        ...toAdminSafeUser(raw),
        planId,
        minutesUsed: readStreamingMinutes(usageByUid.get(doc.id) || {}),
        streamingMinutesThisMonth: readStreamingMinutes(usageByUid.get(doc.id) || {}),
        lastActiveAt: typeof (raw as any).lastActiveAt === "number" ? (raw as any).lastActiveAt : null,
        creditRemainingMinutes: creditSummary.remainingMinutes,
        // billingEnabled is tri-state in Firestore; missing => ON.
        billingEnabled: (raw as any).billingEnabled !== false,
        // Stripe/base plan vs admin override vs EFFECTIVE plan.
        ...view,
        billingTruth,
        billingReady: true,
        stripeConnected: Boolean(billingTruth.stripeCustomerId),
      };
    }));

    const filteredUsers = includeDeleted
      ? users.map((u: any) => {
          // Always include deletedAtMs and deleteAfterMs for deleted users
          if (typeof u?.deletedAtMs === "number" && u.deletedAtMs > 0) {
            return {
              ...u,
              deletedAt: new Date(u.deletedAtMs).toISOString(),
              deleteAfter: u.deleteAfterMs ? new Date(u.deleteAfterMs).toISOString() : null,
              purgeInDays: u.deleteAfterMs ? Math.max(0, Math.ceil((u.deleteAfterMs - Date.now()) / (1000 * 60 * 60 * 24))) : null,
            };
          }
          return u;
        })
      : users.filter((u: any) => !isDeletedUserRecord(u));

    res.json({
      users: filteredUsers,
      total: filteredUsers.length,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error("Failed to fetch users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});
/**
 * GET /api/admin/users/:userId/deletion-impact
 * What deleting this account affects: Stripe subscription (plan, amount,
 * next billing date via Stripe), rooms, recordings, storage.
 */
router.get("/users/:userId/deletion-impact", async (req, res) => {
  try {
    const impact = await loadDeletionImpact(req.params.userId);
    if (!impact) return res.status(404).json({ error: "User not found" });
    res.json({ success: true, impact });
  } catch (error: any) {
    console.error("Failed to load deletion impact:", error);
    res.status(500).json({ error: "Failed to load deletion impact" });
  }
});

/**
 * DELETE /api/admin/users/:userId
 * Body: { cancelStripe, revokeSessions, scheduleMediaDeletion, confirm: "DELETE" }
 * (checkboxes default to true). Shared workflow (lib/accountDeletion.ts):
 * cancel Stripe -> revoke sessions -> disable (soft delete) -> queue cleanup
 * (purge after 7 days) -> audit. If Stripe cancellation was requested and
 * fails, NOTHING else happens and the response is 502 outcome "failed".
 * Partial results (e.g. Firebase revoke failed) return 207 outcome "partial".
 */
router.delete("/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const adminUid = req.adminUser!.uid;
    if (userId === adminUid) {
      return res.status(400).json({ error: "You cannot delete your own account here" });
    }
    const parsed = parseDeletionRequest(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error, details: parsed.details });
    }
    const result = await deleteAccount({
      uid: userId,
      actor: { type: "admin", uid: adminUid },
      options: parsed.options,
      reason: "admin_deleted",
      extraAudit: (event) =>
        logAdminAction(adminUid, "delete_user", {
          userId,
          mode: "soft",
          options: parsed.options,
          outcome: event.outcome,
          stripe: event.steps?.stripe,
          sessions: event.steps?.sessions?.status,
          disable: event.steps?.disable?.status,
          cleanup: event.steps?.cleanup?.status,
        }),
    });
    res.status(result.httpStatus).json({
      success: result.outcome !== "failed",
      userId,
      ...result,
    });
  } catch (error) {
    console.error("Failed to delete user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

/**
 * POST /api/admin/users/:userId/restore
 * Undo a soft delete within the purge window (clears the deletion fields,
 * re-enables the Firebase user). A Stripe subscription canceled by the
 * deletion is NOT restored; the user must subscribe again.
 */
router.post("/users/:userId/restore", async (req, res) => {
  try {
    const { userId } = req.params;
    const adminUid = req.adminUser!.uid;
    const result = await restoreAccount(userId, adminUid);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, details: result.details });
    }
    await logAdminAction(adminUid, "restore_user", { userId, ...result });
    res.json({
      success: true,
      userId,
      firebaseReenabled: result.firebaseReenabled,
      stripeWasCanceled: result.stripeWasCanceled,
      note: "Canceled Stripe subscriptions are not restored; the user must subscribe again.",
    });
  } catch (error) {
    console.error("Failed to restore user:", error);
    res.status(500).json({ error: "Failed to restore user" });
  }
});
/**
 * POST /api/admin/users/:userId/revoke-sessions   body: { reason? }
 * Signs the user out everywhere: authRevokedAtMs = now (requireAuth /
 * requireAdmin reject tokens issued earlier) + Firebase revokeRefreshTokens.
 * Audit-logged.
 */
router.post("/users/:userId/revoke-sessions", async (req, res) => {
  try {
    const { userId } = req.params;
    const adminUid = req.adminUser!.uid;
    if (userId === adminUid) {
      return res.status(400).json({ error: "Use 'log out everywhere' in your own account settings to revoke your own sessions" });
    }
    const ref = firestore.collection("users").doc(userId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "User not found" });
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
    const nowMs = Date.now();
    await ref.set({ authRevokedAtMs: nowMs, updatedAt: nowMs }, { merge: true });
    let firebaseRevoked: boolean | "no_firebase_user" = true;
    try {
      await firebaseAuth.revokeRefreshTokens(userId);
    } catch (e: any) {
      const code = String(e?.code || "");
      if (code === "auth/user-not-found") firebaseRevoked = "no_firebase_user";
      else {
        firebaseRevoked = false;
        console.warn("[admin] revokeRefreshTokens failed:", code || e?.message || e);
      }
    }
    invalidateEntitlements(userId);
    await logAdminAction(adminUid, "revoke_sessions", { userId, reason: reason || undefined, authRevokedAtMs: nowMs, firebaseRevoked });
    await logAuthSecurityEvent({
      event: "admin_sessions_revoked",
      actorUserId: adminUid,
      targetUserId: userId,
      ip: req.ip || null,
      details: { authRevokedAtMs: nowMs },
    }).catch(() => undefined);
    res.json({ success: true, userId, authRevokedAtMs: nowMs, firebaseRevoked });
  } catch (error: any) {
    console.error("Failed to revoke sessions:", error);
    res.status(500).json({ error: "Failed to revoke sessions" });
  }
});

function toMsLoose(v: any): number | null {
  const ms = toMillis(v);
  return ms === null ? null : ms;
}

/** adminLogs for one user (new targetUid field + legacy details.userId), newest first. */
async function loadAdminLogsForUser(uid: string, limit = 20): Promise<any[]> {
  const col = firestore.collection("adminLogs");
  const run = async (field: string) => {
    try {
      const snap = await col.where(field, "==", uid).orderBy("timestamp", "desc").limit(limit).get();
      return snap.docs;
    } catch {
      // Composite index missing: bounded unordered read, sorted in memory.
      try {
        const snap = await col.where(field, "==", uid).limit(100).get();
        return snap.docs;
      } catch (e: any) {
        console.warn("[admin] adminLogs lookup failed:", field, e?.message || e);
        return [];
      }
    }
  };
  const [a, b] = await Promise.all([run("targetUid"), run("details.userId")]);
  const byId = new Map<string, any>();
  [...a, ...b].forEach((d) => {
    const x = (d.data() || {}) as any;
    byId.set(d.id, {
      id: d.id,
      action: x.action || null,
      adminId: x.adminId || null,
      timestampMs: toMsLoose(x.timestamp),
      details: x.details || {},
    });
  });
  return Array.from(byId.values())
    .sort((x, y) => Number(y.timestampMs || 0) - Number(x.timestampMs || 0))
    .slice(0, limit);
}

/**
 * GET /api/admin/users/:userId/detail
 * Everything the admin user drawer shows, in one call with bounded queries:
 * profile, plan sources + entitlements, usage this month, storage, rooms,
 * recordings, billing state and the last 20 admin audit entries.
 */
router.get("/users/:userId/detail", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) return res.status(400).json({ error: "invalid_user_id" });
    const userSnap = await firestore.collection("users").doc(userId).get();
    if (!userSnap.exists) return res.status(404).json({ error: "User not found" });
    const raw = (userSnap.data() || {}) as any;
    const nowMs = Date.now();
    const monthKey = getCurrentMonthKey();
    const roomsQ = firestore.collection("rooms").where("ownerId", "==", userId);
    const recQ = firestore.collection("recordings").where("userId", "==", userId);

    const [status, ent, usageSnap, roomsCount, roomsSnap, recCount, recSnap, auditLog, platformBillingEnabled] = await Promise.all([
      getStreamingUsageStatus(userId).catch((e: any) => {
        console.warn("[admin/detail] usage status failed:", e?.message || e);
        return null;
      }),
      getEffectiveEntitlements(userId, { fresh: true }),
      firestore.collection("usageMonthly").doc(`${userId}_${monthKey}`).get(),
      countQuery(roomsQ, "detail rooms"),
      roomsQ.limit(50).get().catch(() => null),
      countQuery(recQ, "detail recordings"),
      recQ.limit(50).get().catch(() => null),
      loadAdminLogsForUser(userId, 20),
      getPlatformBillingEnabled().catch(() => true),
    ]);

    const usageDoc = usageSnap.exists ? ((usageSnap.data() || {}) as any) : {};
    const usage = usageDoc.usage || {};
    const storedOverride = readStoredPlanOverride(raw);
    const billingTruth = normalizeBillingTruthFromUser({ ...raw, planId: raw.planId || "free" }, nowMs);

    const recentRooms = (roomsSnap?.docs || [])
      .map((d) => {
        const x = (d.data() || {}) as any;
        return {
          roomId: d.id,
          name: x.name || x.title || null,
          status: x.status || null,
          access: x.access || null,
          createdAt: toMsLoose(x.createdAt),
          lastLiveAt: x.viewerStats?.startedAt ?? null,
        };
      })
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, 10);
    const recentRecordings = (recSnap?.docs || [])
      .map((d) => {
        const x = (d.data() || {}) as any;
        return {
          id: d.id,
          roomId: x.roomId || null,
          title: x.title || x.name || null,
          status: x.status || null,
          startedAt: toMsLoose(x.startedAt) ?? toMsLoose(x.createdAt),
          durationMs: typeof x.durationMs === "number" ? x.durationMs : null,
          billedMinutes: typeof x.billedMinutes === "number" ? x.billedMinutes : null,
          sizeBytes: typeof x.sizeBytes === "number" ? x.sizeBytes : typeof x.fileSize === "number" ? x.fileSize : null,
        };
      })
      .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))
      .slice(0, 10);

    const deletedAtMs = getDeletedAtMs(raw);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      success: true,
      profile: {
        uid: userId,
        email: raw.email || null,
        displayName: raw.displayName || null,
        createdAt: toMsLoose(raw.createdAt),
        lastActiveAt: toMsLoose(raw.lastActiveAt) ?? toMsLoose(raw.lastActive),
        accountStatus: raw.accountStatus || "active",
        deleted: isDeletedUserRecord(raw),
        deletedAtMs,
        deleteAfterMs: typeof raw.deleteAfterMs === "number" ? raw.deleteAfterMs : null,
        isAdmin: Boolean(raw.admin?.isAdmin ?? raw.isAdmin),
        authRevokedAtMs: typeof raw.authRevokedAtMs === "number" ? raw.authRevokedAtMs : null,
        timeZone: raw.timeZone || null,
        passwordReset: buildPublicPasswordResetState(raw.passwordReset),
        recoveryConfigured: buildPublicRecoveryState(raw.recovery).configured,
        canEnablePasswordReset: canAdminManagePasswordReset(req.adminUser!.uid, userId, raw),
      },
      plan: {
        basePlanId: ent.source.basePlan,
        stripePlanId: billingTruth.planId ?? null,
        effectivePlanId: ent.planId,
        effectivePlanName: ent.planName,
        decidedBy: ent.source.decidedBy,
        subscriptionBlockedReason: ent.source.subscription.blockedReason,
        planOverride: storedOverride
          ? { ...storedOverride, active: isOverrideActive(storedOverride, nowMs) }
          : ent.source.adminOverride
            ? { ...ent.source.adminOverride, active: true }
            : null,
      },
      entitlements: serializeEntitlements(ent),
      usage: {
        monthKey,
        streamingMinutes: readStreamingMinutes(usageDoc),
        destinationMinutes: Number(usage.destinationMinutes ?? 0),
        recordingMinutes: Number(usage.recordingMinutes ?? usage.minutes?.recording?.currentPeriod ?? 0),
        hlsMinutes: Number(usage.outputMinutes?.hls ?? 0),
        limitMinutes: status ? status.decision.limitMinutes : ent.limits.monthlyStreamingMinutes,
        planAllowanceMinutes: ent.limits.monthlyStreamingMinutes,
        creditRemainingMinutes: status ? status.credits.remainingMinutes : null,
        creditConsumedThisMonth: status ? status.credits.consumedThisMonth : null,
        isBlocked: status ? !status.decision.allowed : false,
        storageUsedBytes: Number(raw.usage?.storageUsedBytes) || 0,
        storageLimitBytes: ent.limits.storageBytes,
        lifetimeStreamingMinutes: Number(raw.usage?.lifetime?.streamingMinutes || 0),
      },
      rooms: { count: roomsCount, recent: recentRooms },
      recordings: { count: recCount, recent: recentRecordings },
      billing: {
        status: billingTruth.status,
        stripeCustomerId: billingTruth.stripeCustomerId ?? null,
        subscriptionId: billingTruth.subscriptionId ?? null,
        billingEnabled: raw.billingEnabled !== false,
        platformBillingEnabled,
        pendingPlan: raw.pendingPlan ?? null,
        billingTruth,
      },
      auditLog,
    });
  } catch (error: any) {
    console.error("Failed to load user detail:", error);
    res.status(500).json({ error: "Failed to load user detail" });
  }
});

/**
 * GET /api/admin/users/:userId
 * Get detailed information about a specific user
 */
router.get("/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const userDoc = await firestore.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userDoc.data();

    // Current month streaming minutes vs the effective plan (+ one-time usage credits),
    // evaluated exactly like the start gate.
    const status = await getStreamingUsageStatus(userId);
    const currentMonthUsage = status.decision.usedMinutes;
    const planLimitOrNull = status.decision.limitMinutes; // null = unlimited
    const planLimit = planLimitOrNull ?? 0; // legacy field: 0 = unlimited
    const lifetime = ((userData as any)?.usage?.lifetime || {}) as any;

    const userSummary: UserUsageSummary = {
      user: {
        uid: userId,
        ...toAdminSafeUser(userData),
      } as any,
      currentMonthUsage,
      allTimeUsage: Number(lifetime.streamingMinutes || 0),
      planLimit,
      percentUsed: planLimit > 0 ? Math.round((currentMonthUsage / planLimit) * 100) : 0,
      isBlocked: !status.decision.allowed,
      recentActivity: [],
    };

    const ent = await getEffectiveEntitlements(userId, { fresh: true });
    const storedOverride = readStoredPlanOverride(userData || {});
    res.json({
      ...userSummary,
      planLimitMinutes: planLimitOrNull,
      // Plan allowance vs one-time usage credits.
      planAllowanceMinutes: status.entitlements.limits.monthlyStreamingMinutes,
      creditRemainingMinutes: status.credits.remainingMinutes,
      creditConsumedThisMonth: status.credits.consumedThisMonth,
      creditAllowanceMinutes: status.credits.allowanceMinutes,
      basePlanId: ent.source.basePlan,
      effectivePlanId: ent.planId,
      planOverride: storedOverride
        ? { ...storedOverride, active: isOverrideActive(storedOverride, Date.now()) }
        : ent.source.adminOverride
          ? { ...ent.source.adminOverride, active: true }
          : null,
      entitlements: serializeEntitlements(ent),
    });
  } catch (error: any) {
    console.error("Failed to fetch user details:", error);
    res.status(500).json({ error: "Failed to fetch user details" });
  }
});

/**
 * POST /api/admin/users/:userId/grant-minutes   (alias: POST /users/:userId/credits)
 * Body: { minutes (positive integer), reason (required), expiresAt? (ISO / epoch ms) }
 * Grants a ONE-TIME usage credit (users/{uid}/usageCredits/{id}): consumed
 * only by minutes beyond the plan allowance, remaining carries over month to
 * month. It is not a monthly top-up. type "recurring" is rejected (not
 * implemented yet).
 */
async function handleGrantCredit(req: any, res: any) {
  try {
    const { userId } = req.params;
    const adminUid = req.adminUser!.uid;
    const nowMs = Date.now();
    const parsed = validateCreditGrant(req.body, nowMs);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error, details: parsed.details });
    }

    const userDoc = await firestore.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    // Fold any legacy users.bonusMinutes into a credit first so the two never double count.
    await migrateLegacyBonusMinutes(userId, nowMs).catch((e: any) =>
      console.error("[admin] legacy bonus migration before grant failed", { userId, error: e?.message || e })
    );

    const credit = await grantCredit(userId, parsed.value, adminUid, nowMs);
    await logAdminAction(adminUid, "grant_usage_credit", {
      userId,
      creditId: credit.id,
      minutes: credit.amount,
      type: credit.type,
      source: credit.source,
      reason: credit.reason,
      expiresAt: credit.expiresAt,
    });
    invalidateEntitlements(userId);

    const credits = await loadCreditsWithRemaining(userId);
    const remainingMinutes = activeCreditRemaining(credits, Date.now());
    res.json({
      success: true,
      userId,
      credit: serializeCredit(credit, nowMs),
      minutesGranted: credit.amount,
      creditRemainingMinutes: remainingMinutes,
      // Legacy response field (older admin UIs): remaining one-time credit minutes.
      totalBonusMinutes: remainingMinutes,
      reason: credit.reason,
    });
  } catch (error: any) {
    console.error("Failed to grant usage credit:", error);
    res.status(500).json({ error: "Failed to grant minutes" });
  }
}
router.post("/users/:userId/grant-minutes", handleGrantCredit);
router.post("/users/:userId/credits", handleGrantCredit);

/**
 * GET /api/admin/users/:userId/credits
 * All usage credits (active, depleted, expired, revoked) + this month's summary.
 */
router.get("/users/:userId/credits", async (req, res) => {
  try {
    const { userId } = req.params;
    const userDoc = await firestore.collection("users").doc(userId).get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
    // Migrates legacy bonusMinutes and returns plan / credit allowance for this month.
    const status = await getStreamingUsageStatus(userId);
    const credits = await loadAllCredits(userId);
    const nowMs = Date.now();
    res.json({
      success: true,
      userId,
      monthKey: status.monthKey,
      planAllowanceMinutes: status.entitlements.limits.monthlyStreamingMinutes,
      usedMinutes: status.decision.usedMinutes,
      limitMinutes: status.decision.limitMinutes,
      creditRemainingMinutes: status.credits.remainingMinutes,
      creditConsumedThisMonth: status.credits.consumedThisMonth,
      creditAllowanceMinutes: status.credits.allowanceMinutes,
      credits: credits.map((c) => serializeCredit(c, nowMs)),
    });
  } catch (error: any) {
    console.error("Failed to list usage credits:", error);
    res.status(500).json({ error: "Failed to list usage credits" });
  }
});

/**
 * POST /api/admin/users/:userId/credits/:creditId/revoke
 * Body: { reason? }. Sets remaining to 0 (already-consumed minutes stay billed).
 */
router.post("/users/:userId/credits/:creditId/revoke", async (req, res) => {
  try {
    const { userId, creditId } = req.params;
    const adminUid = req.adminUser!.uid;
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
    const result = await revokeCredit(userId, creditId, adminUid, reason);
    if (!result) return res.status(404).json({ error: "Credit not found" });
    await logAdminAction(adminUid, "revoke_usage_credit", {
      userId,
      creditId,
      reason: reason || undefined,
      remainingBefore: result.before.remaining,
      alreadyRevoked: Boolean(result.before.revokedAt),
    });
    invalidateEntitlements(userId);
    res.json({ success: true, userId, credit: serializeCredit(result.after, Date.now()), revokedMinutes: result.before.remaining });
  } catch (error: any) {
    console.error("Failed to revoke usage credit:", error);
    res.status(500).json({ error: "Failed to revoke usage credit" });
  }
});

/**
 * POST /api/admin/users/:userId/change-plan
 * Set the user's BASE plan (users.planId, normally owned by Stripe/billing).
 * A paid base plan without a Stripe subscription is billing-blocked (falls
 * back to Free). To grant a plan without billing, use the admin override:
 * PUT /api/admin/users/:userId/plan-override.
 */
router.post("/users/:userId/change-plan", async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPlan, reason } = req.body;
    

    // Dynamically fetch all valid plan IDs from Firestore
    const plansSnap = await firestore.collection("plans").get();
const validPlans: string[] = plansSnap.docs.map((d) => d.id);
    if (!validPlans.includes(newPlan)) {
      return res.status(400).json({ error: "Invalid plan", validPlans });
    }

    const userRef = firestore.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const oldPlan = userDoc.data()?.planId || "free";

    await userRef.update({
      planId: newPlan,
      updatedAt: new Date(),
      planChangedBy: "admin",
      planChangedAt: new Date(),
      pendingPlan: null,

    });

    invalidateEntitlements(userId);
    // Log the action
    await logAdminAction(req.adminUser!.uid, "change_plan", {
      userId,
      oldPlan,
      newPlan,
      reason,
      kind: "set_base_plan",
    });

    console.log(
      `Admin ${req.adminUser!.email} changed user ${userId} plan from ${oldPlan} to ${newPlan}`
    );

    res.json({
      success: true,
      userId,
      oldPlan,
      newPlan,
      reason,
    });
  } catch (error: any) {
    console.error("Failed to change plan:", error);
    res.status(500).json({ error: "Failed to change plan" });
  }
});

/**
 * PUT /api/admin/users/:userId/plan-override
 * Body: { planId, reason, expiresAt?, startsAt? }
 * Admin override: the EFFECTIVE plan becomes planId (no Stripe subscription
 * required). Stored as users/{uid}.planOverride; replaces legacy
 * adminOverridePlanId / adminOverride fields. Audit-logged.
 */
router.put("/users/:userId/plan-override", async (req, res) => {
  try {
    const { userId } = req.params;
    const body = (req.body || {}) as any;
    const planId = typeof body.planId === "string" ? body.planId.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!planId) return res.status(400).json({ error: "planId is required" });
    if (!reason) return res.status(400).json({ error: "reason is required" });

    const now = Date.now();
    const parseTime = (v: any): number | null | "invalid" => {
      if (v === undefined || v === null || v === "") return null;
      const t = typeof v === "number" ? v : new Date(String(v)).getTime();
      return Number.isFinite(t) ? t : "invalid";
    };
    const expiresAt = parseTime(body.expiresAt);
    const startsAtRaw = parseTime(body.startsAt);
    if (expiresAt === "invalid" || startsAtRaw === "invalid") {
      return res.status(400).json({ error: "invalid_date" });
    }
    const startsAt = startsAtRaw ?? now;
    if (expiresAt !== null && expiresAt <= Math.max(now, startsAt)) {
      return res.status(400).json({ error: "expiresAt must be in the future" });
    }

    const planSnap = await firestore.collection("plans").doc(planId).get();
    if (!planSnap.exists && !getCatalogPlan(planId)) {
      return res.status(400).json({ error: "Invalid plan", planId });
    }

    const userRef = firestore.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
    const before = (userDoc.data() as any) || {};

    const planOverride = {
      planId,
      reason,
      createdBy: req.adminUser!.uid,
      startsAt,
      expiresAt,
      createdAt: now,
    };
    await userRef.update({
      planOverride,
      adminOverridePlanId: FieldValue.delete(),
      adminOverride: FieldValue.delete(),
      updatedAt: new Date(),
    });
    invalidateEntitlements(userId);

    await logAdminAction(req.adminUser!.uid, "set_plan_override", {
      userId,
      planOverride,
      previousOverride: before.planOverride ?? null,
      previousLegacy: {
        adminOverridePlanId: before.adminOverridePlanId ?? null,
        adminOverride: before.adminOverride ?? null,
      },
    });

    const ent = await getEffectiveEntitlements(userId, { fresh: true });
    return res.json({ success: true, userId, planOverride, entitlements: serializeEntitlements(ent) });
  } catch (error: any) {
    console.error("Failed to set plan override:", error);
    return res.status(500).json({ error: "Failed to set plan override" });
  }
});

/**
 * DELETE /api/admin/users/:userId/plan-override
 * Remove the admin override (and any legacy override fields). Audit-logged.
 */
router.delete("/users/:userId/plan-override", async (req, res) => {
  try {
    const { userId } = req.params;
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : undefined;
    const userRef = firestore.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });
    const before = (userDoc.data() as any) || {};

    await userRef.update({
      planOverride: FieldValue.delete(),
      adminOverridePlanId: FieldValue.delete(),
      adminOverride: FieldValue.delete(),
      updatedAt: new Date(),
    });
    invalidateEntitlements(userId);

    await logAdminAction(req.adminUser!.uid, "remove_plan_override", {
      userId,
      reason,
      previousOverride: before.planOverride ?? null,
      previousLegacy: {
        adminOverridePlanId: before.adminOverridePlanId ?? null,
        adminOverride: before.adminOverride ?? null,
      },
    });

    const ent = await getEffectiveEntitlements(userId, { fresh: true });
    return res.json({ success: true, userId, entitlements: serializeEntitlements(ent) });
  } catch (error: any) {
    console.error("Failed to remove plan override:", error);
    return res.status(500).json({ error: "Failed to remove plan override" });
  }
});

/**
 * POST /api/admin/users/:userId/toggle-billing
 * Enable or disable billing for a user
 */
router.post("/users/:userId/toggle-billing", async (req, res) => {
  try {
    const { userId } = req.params;
    const { enabled, reason } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }

    const userRef = firestore.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const previousState = userDoc.data()?.billingEnabled || false;

    await userRef.update({
      billingEnabled: enabled,
      updatedAt: new Date(),
    });
    invalidateEntitlements(userId);

    // Log the action
    await logAdminAction(req.adminUser!.uid, "toggle_billing", {
      userId,
      previousState,
      newState: enabled,
      reason,
    });

    console.log(
      `Admin ${req.adminUser!.email} ${enabled ? "enabled" : "disabled"} billing for user ${userId}`
    );

    res.json({
      success: true,
      userId,
      billingEnabled: enabled,
      previousState,
      reason,
    });
  } catch (error: any) {
    console.error("Failed to toggle billing:", error);
    res.status(500).json({ error: "Failed to toggle billing" });
  }
});

/**
 * POST /api/admin/users/:userId/reset-plan-guards
 * Reset billing guards, plan-change locks, and cooldowns so the user can change plans again.
 */
router.post("/users/:userId/reset-plan-guards", async (req, res) => {
  try {
    const { userId } = req.params;
    const userRef = firestore.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    await userRef.update({
      billingGuards: null,
      planChangeLock: null,
      planChangeCooldownUntil: null,
      planChangeRequestId: null,
      planChangeRequestResult: null,
      updatedAt: new Date(),
    });

    await logAdminAction(req.adminUser!.uid, "reset_plan_guards", { userId });

    console.log(
      `Admin ${req.adminUser!.email} reset plan-change guards for user ${userId}`
    );

    res.json({ success: true, userId });
  } catch (error: any) {
    console.error("Failed to reset plan guards:", error);
    res.status(500).json({ error: "Failed to reset plan guards" });
  }
});

// Plan schema migration is NOT exposed over HTTP. Use the internal CLI:
//   npx tsx scripts/migratePlansToV2.ts            (dry run)
//   npx tsx scripts/migratePlansToV2.ts --apply    (write)

/**
 * POST /api/admin/feature-flags/billing
 * Toggle the platform-wide billing system flag.
 *
 * Persists to config/features.billingSystemEnabled and logs an admin action.
 */
router.post("/feature-flags/billing", async (req, res) => {
  try {
    const { enabled, reason } = req.body || {};

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }

    const isProd = process.env.NODE_ENV === "production";
    if (isProd && enabled === false && (typeof reason !== "string" || reason.trim().length === 0)) {
      return res.status(400).json({ error: "reason_required_in_production" });
    }

    const docRef = firestore.collection("config").doc("features");
    const now = new Date();

    const beforeSnap = await docRef.get();
    const beforeData = (beforeSnap.exists ? beforeSnap.data() || {} : {}) as any;
    const previous =
      typeof beforeData.billingSystemEnabled === "boolean"
        ? beforeData.billingSystemEnabled
        : true;

    // Firestore rejects `undefined` values unless ignoreUndefinedProperties is enabled.
    // Build the payload explicitly to avoid accidentally writing `reason: undefined`.
    const update: any = {
      billingSystemEnabled: enabled,
      updatedAt: now,
      updatedBy: req.adminUser!.uid,
    };
    if (typeof reason === "string") {
      update.reason = reason;
    } else if (enabled === true) {
      // Clear any previous disable reason when billing is enabled.
      update.reason = null;
    }

    await docRef.set(update, { merge: true });

    // Invalidate in-memory cache so the new value is visible immediately
    // from subsequent getUserAccount() calls on this instance.
    invalidatePlatformBillingCache();
    invalidateEntitlements();

    await logAdminAction(req.adminUser!.uid, "toggle_billing_system", {
      previousBillingSystemEnabled: previous,
      nextBillingSystemEnabled: enabled,
      reason,
    });

    console.log(
      `Admin ${req.adminUser!.email} ${enabled ? "enabled" : "disabled"} platform billing (previous=${previous})`
    );

    return res.json({ success: true, billingSystemEnabled: enabled });
  } catch (error: any) {
    console.error("Failed to toggle platform billing:", error);
    return res.status(500).json({
      error: "Failed to toggle platform billing",
    });
  }
});

/**
 * GET /api/admin/usage
 *   ?limit (1-200, default 50) &cursor (last userId of the previous page)
 *   &search (email prefix; users.emailLower / email) &plan (base plan id)
 *   &includeDeleted &counters=0 (skip the Support Hub period counters)
 * Users are ordered by createdAt desc (search results: by email).
 * Period counters (ticketsToday, activeUsers, ...) come from cached count()/
 * sum() aggregates (see GET /usage/counters); they are kept in this response
 * for the Support Hub.
 */
router.get("/usage", async (req, res) => {
  try {
    const listQuery = normalizeUserListQuery(req.query || {}, { limit: 50, maxLimit: 200 });
    const { limit, includeDeleted } = listQuery;
    const { startMs, endMs } = parsePeriodRange(req.query || {});
    const activeProgramId = resolveProgramContext(req);
    const wantCounters = String(req.query.counters ?? "1") !== "0";
    const monthKey = getCurrentMonthKey();

    // Load platform billing flag once so the admin UI can accurately show
    // whether Stripe is globally enabled.
    const platformBillingEnabled = await getPlatformBillingEnabled().catch(() => true);

    const page = await listUsersPage(listQuery);
    const userDocs = includeDeleted ? page.docs : page.docs.filter((doc) => !isDeletedUserRecord(doc.data()));

    // Plans, flags, admins loaded once; each user resolved by the engine.
    const planCtx = await loadAdminPlanContext();

    const usageData = await Promise.all(
      userDocs.map(async (doc) => {
        const userData = doc.data();
        const userId = doc.id;
        // usageMonthly doc id shape: `${uid}_${YYYY-MM}`
        const usageDocId = `${userId}_${monthKey}`;
        const usageSnap = await firestore.collection("usageMonthly").doc(usageDocId).get();
        const usageData = usageSnap.exists ? (usageSnap.data() as any) : {};
        const usage = usageData.usage || {};
        // Monthly streaming minutes (union of output time), same reader as the gate.
        const minutesUsed = readStreamingMinutes(usageData);
        const destinationMinutes = Number(usage.destinationMinutes ?? 0);
        const recordingMinutes = Number(usage.recordingMinutes ?? usage.minutes?.recording?.currentPeriod ?? 0);

        const overages = (usageData.overages || {}) as any;
        const overageStreamingMinutes = Number(overages.streamingMinutes ?? overages.participantMinutes ?? 0);
        const overageParticipantMinutes = overageStreamingMinutes;
        const overageTranscodeMinutes = 0;
        const overageMinutesTotal = overageStreamingMinutes;

        const planIdRaw = userData.planId || "free";
        const planId: PlanId | string = planIdRaw;
        // Effective plan + limits from the same engine as the start gate.
        const { ent, view } = buildAdminPlanView(userId, userData, planCtx);
        const effectivePlanId = ent.planId;
        const planLimit = ent.limits.monthlyStreamingMinutes; // null = unlimited
        // One-time usage credits (read-only here; legacy bonusMinutes counted until migrated).
        const credits = await loadCreditsWithRemaining(userId).catch(() => []);
        const creditSummary = summarizeCredits({
          credits,
          userDoc: userData,
          usageDoc: usageData,
          usedMinutes: minutesUsed,
          includedMinutes: planLimit,
          nowMs: Date.now(),
        });
        // Legacy field name: credit minutes in this month's allowance.
        const bonusMinutes = creditSummary.allowanceMinutes;
        const gate = evaluateStreamingGate({
          usedMinutes: minutesUsed,
          includedMinutes: planLimit,
          bonusMinutes,
          planAllowsOverages: !!ent.features.overages,
          overagesEnabled: readOveragesEnabled(userData),
        });
        const effectiveLimit = gate.limitMinutes; // null = unlimited

        // billingEnabled is tri-state in Firestore; missing => true.
        const billingEnabled = userData.billingEnabled === false ? false : true;
        const effectiveBillingEnabled = platformBillingEnabled && billingEnabled;

        const billingTruth = normalizeBillingTruthFromUser(userData, Date.now());
        const canEnablePasswordReset = canAdminManagePasswordReset(req.adminUser!.uid, userId, userData);

        return {
          userId,
          email: userData.email,
          displayName: userData.displayName,
          isAdmin: Boolean(userData.admin?.isAdmin ?? userData.isAdmin),
          planId,
          billingTruthStatus: billingTruth.status,
          stripeConnected: Boolean(billingTruth.stripeCustomerId),
          stripeCustomerId: billingTruth.stripeCustomerId,
          passwordReset: buildPublicPasswordResetState(userData.passwordReset),
          recovery: buildPublicRecoveryState(userData.recovery),
          recoveryConfigured: buildPublicRecoveryState(userData.recovery).configured,
          canEnablePasswordReset,
          billingEnabled,
          platformBillingEnabled,
          effectiveBillingEnabled,
          minutesUsed,
          streamingMinutes: minutesUsed,
          destinationMinutes,
          recordingMinutes,
          effectivePlanId,
          basePlanId: view.basePlanId,
          planOverride: view.planOverride,
          decidedBy: view.decidedBy,
          subscriptionBlockedReason: view.subscriptionBlockedReason,
          unlimited: gate.unlimited,
          overageStreamingMinutes,
          overageParticipantMinutes,
          overageTranscodeMinutes,
          overageMinutesTotal,
          bonusMinutes,
          creditRemainingMinutes: creditSummary.remainingMinutes,
          creditConsumedThisMonth: creditSummary.consumedThisMonth,
          planUsedMinutes: planLimit === null ? minutesUsed : Math.min(minutesUsed, planLimit),
          planLimit,
          effectiveLimit,
          percentUsed: effectiveLimit !== null && effectiveLimit > 0 ? (minutesUsed / effectiveLimit) * 100 : effectiveLimit === 0 && minutesUsed > 0 ? 100 : 0,
          // Same decision as the start gate (bonus, override plan, overage opt-in).
          isBlocked: !gate.allowed,
          lastActive: userData.lastActive,
          lastActiveAt: typeof userData.lastActiveAt === "number" ? userData.lastActiveAt : null,
        };
      })
    );

    // Sort by percent used within the page (most blocked users first)
    usageData.sort((a, b) => b.percentUsed - a.percentUsed);

    const counters = wantCounters
      ? await computePeriodCounters(startMs, endMs, activeProgramId).catch((e: any) => {
          console.error("[admin/usage] counters failed:", e?.message || e);
          return null;
        })
      : null;

    res.json({
      ticketsToday: Number(counters?.ticketsToday || 0),
      activeUsers: Number(counters?.activeUsers || 0),
      roomsCreated: Number(counters?.roomsCreated || 0),
      messagesSent: Number(counters?.messagesSent || 0),
      streamMinutes: Number(counters?.streamMinutes || 0),
      apiRequests: Number(counters?.apiRequests || 0),
      recordingsCreated: Number(counters?.recordingsCreated || 0),
      hlsMinutes: Number(counters?.hlsMinutes || 0),
      countersIncluded: Boolean(counters),
      usage: usageData,
      total: usageData.length,
      limit,
      nextCursor: page.nextCursor,
      search: listQuery.search || null,
      plan: listQuery.plan,
      monthKey,
      period: {
        startMs,
        endMs,
      },
      activeProgramId,
    });
  } catch (error: any) {
    console.error("Failed to fetch usage stats:", error);
    res.status(500).json({ error: "Failed to fetch usage stats" });
  }
});

/**
 * GET /api/admin/usage/counters?period=today|7d|30d|month|90d|all&start=&end=
 * Support Hub period counters via count()/sum() aggregates (cached 2 min).
 */
router.get("/usage/counters", async (req, res) => {
  try {
    const { startMs, endMs } = parsePeriodRange(req.query || {});
    const counters = await computePeriodCounters(startMs, endMs, resolveProgramContext(req));
    res.json({ success: true, ...counters });
  } catch (error: any) {
    console.error("Failed to compute usage counters:", error);
    res.status(500).json({ error: "Failed to compute usage counters" });
  }
});

/**
 * GET /api/admin/usage/summary?uid=...
 * Admin-only usage summary lookup for any user.
 * Uses the same payload shape as GET /api/usage/summary.
 */
router.get("/usage/summary", async (req, res) => {
  try {
    const uid = String(req.query.uid || "").trim();
    if (!uid) {
      return res.status(400).json({ success: false, error: "uid query param is required" });
    }

    const result = await computeUsageSummaryResult(uid);
    return res.status(result.status).json(result.body);
  } catch (error: any) {
    console.error("Admin usage summary lookup failed:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch usage summary",
    });
  }
});

/**
 * GET /api/admin/stats[?fresh=1]
 * Platform statistics from count()/sum() aggregates (cached 60s):
 * active users from users.lastActiveAt, streaming minutes this month from
 * usageMonthly, users by base plan + override count.
 */
router.get("/stats", async (req, res) => {
  try {
    const stats = await computePlatformStats({ fresh: String(req.query.fresh || "") === "1" });
    res.json(stats);
  } catch (error: any) {
    console.error("Failed to fetch stats:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

/**
 * POST /api/admin/features/toggle
 * Toggle a global feature flag
 */
router.post("/features/toggle", async (req, res) => {
  try {
    const { featureName, enabled, reason } = req.body;

    if (!featureName || typeof featureName !== "string") {
      return res.status(400).json({ error: "featureName is required" });
    }

    // Validate featureName: only allow alphanumeric, underscores, hyphens (1-80 chars)
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(featureName)) {
      return res.status(400).json({ error: "featureName must start with a letter and contain only letters, digits, underscores, or hyphens (max 80 chars)" });
    }

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }

    const featureRef = firestore.collection("featureFlags").doc(featureName);
    
    await featureRef.set(
      {
        enabled,
        updatedAt: new Date(),
        updatedBy: req.adminUser!.uid,
      },
      { merge: true }
    );

    invalidatePlatformFlags();
    // Log the action
    await logAdminAction(req.adminUser!.uid, "toggle_feature", {
      featureName,
      enabled,
      reason,
    });

    console.log(
      `Admin ${req.adminUser!.email} ${enabled ? "enabled" : "disabled"} feature: ${featureName}`
    );

    res.json({
      success: true,
      featureName,
      enabled,
      reason,
    });
  } catch (error: any) {
    console.error("Failed to toggle feature:", error);
    res.status(500).json({ error: "Failed to toggle feature" });
  }
});

/**
 * GET /api/admin/features
 * List all feature flags
 */
router.get("/features", async (req, res) => {
  try {
    const snapshot = await firestore.collection("featureFlags").get();

    // Ensure important flags are visible in the Admin UI even before they have
    // been explicitly created in Firestore.
    // Every platform flag from the single defaults table (lib/entitlements/flags.ts),
    // shown with its effective default until a doc exists.
    const seededDefaults: Array<{ name: string; enabled: boolean }> = adminSeededFlagList();

    const byName = new Map<string, any>();
    snapshot.docs.forEach((doc) => {
      byName.set(doc.id, doc.data());
    });

    const features: any[] = snapshot.docs
      .map((doc) => ({
        name: doc.id,
        ...doc.data(),
      }))
      // Legacy / orphaned flags that should not appear in the Admin UI.
      .filter((f) => ![
        "advancedPermissions",
        "editing_access",
        "Editing",
        "editing",
        "editingEnabled",
        "postProduction",
      ].includes(f.name));

    for (const seed of seededDefaults) {
      if (!byName.has(seed.name)) {
        features.push({ name: seed.name, enabled: seed.enabled, seeded: true });
      }
    }

    features.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));

    res.json({ features });
  } catch (error: any) {
    console.error("Failed to fetch features:", error);
    res.status(500).json({ error: "Failed to fetch features" });
  }
});

// Support tickets (supportTickets collection): list / detail / status + notes
router.use("/support/tickets", adminSupportTicketsRoutes);
// Mount admin monitoring & operational awareness sub-routes
// (monitoring/overview, monitoring/services, monitoring/webhooks, alerts, rooms/active, rooms/:id/stream-summary)
router.use(adminMonitoringRoutes);
// System Jobs: GET /jobs, POST /jobs/:name/run (lib/jobs)
router.use(adminJobsRoutes);



export default router;