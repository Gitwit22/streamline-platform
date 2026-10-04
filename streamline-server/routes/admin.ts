/**
 * PUT /api/admin/plans/:planId
 * Update a plan document (any field except id)
 */

console.log("✅ admin.ts loaded");
import express from "express";

import { firestore, auth as firebaseAuth } from "../firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
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

    const passthrough: Record<string, any> = {};
    for (const [k, v] of Object.entries(body)) {
      if (["id", "features", "limits", "limitsVersion", "caps", "createdAt", "entitlements"].includes(k)) continue;
      const prev = existing[k];
      const isPlainObject = (x: any) => !!x && typeof x === "object" && !Array.isArray(x);
      // mergeFields replaces whole fields: keep untouched nested keys (e.g. editing.ai).
      passthrough[k] = isPlainObject(v) && isPlainObject(prev) ? { ...prev, ...(v as any) } : v;
    }
    const updateData: Record<string, any> = {
      ...passthrough,
      limitsVersion: PLAN_LIMITS_VERSION,
      features,
      limits,
      updatedAt: new Date().toISOString(),
    };

    if (!planSnap.exists) {
      await planRef.set({ id: planId, ...updateData, createdAt: new Date().toISOString() });
    } else {
      // mergeFields: replace features/limits maps wholesale (no stale legacy keys).
      await planRef.set(updateData, { mergeFields: Object.keys(updateData) });
    }
    invalidatePlanCache(planId);
    await logAdminAction(req.adminUser!.uid, "update_plan", { planId, updateData });
    res.json({ success: true, planId, updated: updateData, normalized: normalizePlanDoc(planId, { ...existing, ...updateData }) });
  } catch (error: any) {
    console.error("Failed to update plan:", error);
    res.status(500).json({ error: "Failed to update plan" });
  }
});

// ── Seed / ensure all canonical plan documents exist with full features+limits ──
router.post("/plans/seed", async (req, res) => {
  try {
    // Built-in v2 catalog (null = unlimited, 0 = none); same data as seed-plans.js.
    const PLANS: Record<string, any> = PLAN_CATALOG_V2;

    const results: { created: string[]; updated: string[]; errors: Array<{ planId: string; error: string }> } = {
      created: [], updated: [], errors: [],
    };

    for (const [planId, planData] of Object.entries(PLANS)) {
      try {
        const docRef = firestore.collection("plans").doc(planId);
        const existingDoc = await docRef.get();
        const payload: any = { ...planData, id: planId, updatedAt: new Date().toISOString() };
        if (!existingDoc.exists) payload.createdAt = new Date().toISOString();
        // mergeFields: replace features/limits maps wholesale (drops stale
        // legacy keys) while preserving unrelated fields such as stripePriceId.
        await docRef.set(payload, { mergeFields: Object.keys(payload) });
        (existingDoc.exists ? results.updated : results.created).push(planId);
      } catch (err: any) {
        results.errors.push({ planId, error: err?.message || String(err) });
      }
    }

    invalidatePlanCache();
    await logAdminAction(req.adminUser!.uid, "seed_plans", { created: results.created, updated: results.updated, errors: results.errors.length });
    res.json({ success: true, ...results });
  } catch (error: any) {
    console.error("Failed to seed plans:", error);
    res.status(500).json({ error: "Failed to seed plans", details: error.message });
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

    const users = snapshot.docs.map((doc) => {
      const raw = doc.data() || {};
      const planId = typeof (raw as any).planId === "string" && String((raw as any).planId).trim() ? (raw as any).planId : "free";
      const billingTruth = normalizeBillingTruthFromUser({ ...raw, planId }, now);
      const { view } = buildAdminPlanView(doc.id, raw, planCtx);
      return {
        uid: doc.id,
        ...toAdminSafeUser(raw),
        planId,
        // Stripe/base plan vs admin override vs EFFECTIVE plan.
        ...view,
        billingTruth,
        billingReady: true,
        stripeConnected: Boolean(billingTruth.stripeCustomerId),
      };
    });

    const filteredUsers = includeDeleted
      ? users.map((u: any) => {
          // Always include deletedAtMs and deleteAfterMs for deleted users
          if (typeof u?.deletedAtMs === "number" && u.deletedAtMs > 0) {
            return {
              ...u,
              deletedAt: new Date(u.deletedAtMs).toISOString(),
              deleteAfter: new Date(u.deleteAfterMs || 0).toISOString(),
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
//delete user
/**
 * DELETE /api/admin/users/:userId
 * Soft-deletes a user: marks the doc deleted (purged later by the maintenance
 * job via deleteAfterMs, same as a self-service close), revokes all sessions,
 * and disables the Firebase Auth user. The doc is kept so requireAuth, /me and
 * login all see "deleted" and refuse the account instead of recreating it.
 */
const ADMIN_DELETE_PURGE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
router.delete("/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const adminUid = req.adminUser!.uid;
    if (userId === adminUid) {
      return res.status(400).json({ error: "You cannot delete your own account here" });
    }
    const userRef = firestore.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const now = Date.now();
    await userRef.set(
      {
        accountStatus: "deleted",
        deletedAtMs: now,
        deleteAfterMs: now + ADMIN_DELETE_PURGE_AFTER_MS,
        authRevokedAtMs: now,
        deletionRequestedAtMs: now,
        deletionReason: "admin_deleted",
        deletedBy: adminUid,
        updatedAt: now,
      },
      { merge: true }
    );

    // Lock the Firebase identity too, so ID tokens and custom-token sign-in stop working.
    let firebaseAuthLocked = true;
    try {
      await firebaseAuth.updateUser(userId, { disabled: true });
      await firebaseAuth.revokeRefreshTokens(userId);
    } catch (err: any) {
      if (String(err?.code || "") !== "auth/user-not-found") {
        firebaseAuthLocked = false;
        console.warn("[admin] Failed to disable Firebase Auth user on delete:", err?.code || err?.message || err);
      }
    }

    await logAdminAction(adminUid, "delete_user", { userId, mode: "soft", firebaseAuthLocked });
    res.json({ success: true, userId, deletedAtMs: now, deleteAfterMs: now + ADMIN_DELETE_PURGE_AFTER_MS });
  } catch (error) {
    console.error("Failed to delete user:", error);
    res.status(500).json({ error: "Failed to delete user" });
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

    // Current month streaming minutes vs the effective plan (+ bonus),
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
 * POST /api/admin/users/:userId/grant-minutes
 * Grant bonus minutes to a user
 */
router.post("/users/:userId/grant-minutes", async (req, res) => {
  try {
    const { userId } = req.params;
    const { minutes, reason } = req.body;

    if (!minutes || minutes <= 0) {
      return res.status(400).json({ error: "Invalid minutes amount" });
    }

    const userRef = firestore.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const currentBonusMinutes = userDoc.data()?.bonusMinutes || 0;
    const newBonusMinutes = currentBonusMinutes + minutes;

    await userRef.update({
      bonusMinutes: newBonusMinutes,
      updatedAt: new Date(),
    });

    // Log the action
    await logAdminAction(req.adminUser!.uid, "grant_minutes", {
      userId,
      minutes,
      reason,
      previousBonus: currentBonusMinutes,
      newBonus: newBonusMinutes,
    });

    console.log(
      `Admin ${req.adminUser!.email} granted ${minutes} bonus minutes to user ${userId}`
    );

    res.json({
      success: true,
      userId,
      minutesGranted: minutes,
      totalBonusMinutes: newBonusMinutes,
      reason,
    });
  } catch (error: any) {
    console.error("Failed to grant minutes:", error);
    res.status(500).json({ error: "Failed to grant minutes" });
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
 * Get usage statistics across all users
 */
router.get("/usage", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const planFilter = req.query.plan as PlanId | undefined;
    const { startMs, endMs } = parsePeriodRange(req.query || {});
    const activeProgramId = resolveProgramContext(req);
    const includeDeleted = (() => {
      const raw = String(req.query.includeDeleted || "").trim().toLowerCase();
      return raw === "1" || raw === "true" || raw === "yes";
    })();
    const monthKey = getCurrentMonthKey();

    // Load platform billing flag once so the admin UI can accurately show
    // whether Stripe is globally enabled.
    let platformBillingEnabled = true;
    try {
      const featuresSnap = await firestore.collection("config").doc("features").get();
      const features = featuresSnap.exists ? (featuresSnap.data() as any) : {};
      if (typeof features?.billingSystemEnabled === "boolean") {
        platformBillingEnabled = features.billingSystemEnabled;
      }
    } catch {
      // default true
    }

    // Get all users
    let usersQuery = firestore.collection("users");
    if (planFilter) {
      usersQuery = usersQuery.where("planId", "==", planFilter) as any;
    }

    const usersSnapshot = await usersQuery.limit(limit).get();

    const userDocs = includeDeleted
      ? usersSnapshot.docs
      : usersSnapshot.docs.filter((doc) => !isDeletedUserRecord(doc.data()));

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
        const bonusMinutes = Math.max(0, Number(userData.bonusMinutes || 0));
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
          planLimit,
          effectiveLimit,
          percentUsed: effectiveLimit !== null && effectiveLimit > 0 ? (minutesUsed / effectiveLimit) * 100 : effectiveLimit === 0 && minutesUsed > 0 ? 100 : 0,
          // Same decision as the start gate (bonus, override plan, overage opt-in).
          isBlocked: !gate.allowed,
          lastActive: userData.lastActive,
        };
      })
    );

    // Sort by percent used (most blocked users first)
    usageData.sort((a, b) => b.percentUsed - a.percentUsed);

    const monthKeys = buildMonthKeys(startMs, endMs);

    console.log("[admin/usage] period", {
      startMs,
      endMs,
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
      activeProgramId,
      monthKeys: Array.from(monthKeys),
    });

    // Period-scoped roomsCreated for Support Hub Usage card.
    const roomsSnapshot = await firestore.collection("rooms").get();
    let roomsCreatedSkippedProgram = 0;
    let roomsCreatedSkippedTime = 0;
    const roomsCreated = roomsSnapshot.docs.reduce((count, doc) => {
      const data = doc.data();
      if (!matchesProgramContext(data, activeProgramId)) { roomsCreatedSkippedProgram++; return count; }
      const createdMs = getDocMillis(data, ["createdAt", "createdAtMs", "created", "created_at"]);
      if (!isInRange(createdMs, startMs, endMs)) { roomsCreatedSkippedTime++; return count; }
      return count + 1;
    }, 0);
    console.log("[admin/usage] rooms", {
      total: roomsSnapshot.size,
      skippedProgram: roomsCreatedSkippedProgram,
      skippedTime: roomsCreatedSkippedTime,
      roomsCreated,
    });

    const usersSnapshotAll = await firestore.collection("users").get();
    const activeUsers = usersSnapshotAll.docs.reduce((count, doc) => {
      const data = doc.data();
      if (!includeDeleted && isDeletedUserRecord(data)) return count;
      if (!matchesProgramContext(data, activeProgramId)) return count;
      // Include createdAt as last-resort fallback for accounts that haven't yet
      // received an explicit lastActive / lastActiveAt / updatedAt write.
      const lastActiveMs = getDocMillis(data, ["lastActive", "lastActiveAt", "updatedAt", "createdAt"]);
      return isInRange(lastActiveMs, startMs, endMs) ? count + 1 : count;
    }, 0);
    console.log("[admin/usage] activeUsers", { totalUsers: usersSnapshotAll.size, activeUsers });

    const recordingsSnapshot = await firestore.collection("recordings").get();
    let recordingsSkippedProgram = 0;
    let recordingsSkippedTime = 0;
    // Include "startedAt" because recordings started via /api/recordings/start
    // are written with startedAt but no createdAt field.
    const recordingsCreated = recordingsSnapshot.docs.reduce((count, doc) => {
      const data = doc.data();
      if (!matchesProgramContext(data, activeProgramId)) { recordingsSkippedProgram++; return count; }
      const createdMs = getDocMillis(data, ["createdAt", "createdAtMs", "created", "created_at", "startedAt"]);
      if (!isInRange(createdMs, startMs, endMs)) { recordingsSkippedTime++; return count; }
      return count + 1;
    }, 0);
    console.log("[admin/usage] recordings", {
      total: recordingsSnapshot.size,
      skippedProgram: recordingsSkippedProgram,
      skippedTime: recordingsSkippedTime,
      recordingsCreated,
    });

    const usageMonthlySnap = await firestore.collection("usageMonthly").get();
    let streamMinutes = 0;
    let hlsMinutes = 0;
    let apiRequests = 0;
    let usageMonthlyMatched = 0;
    usageMonthlySnap.docs.forEach((doc) => {
      const data = doc.data() as any;
      if (!matchesProgramContext(data, activeProgramId)) return;
      const monthKey = String(data.monthKey || doc.id.split("_").pop() || "");
      if (!monthKeys.has(monthKey)) return;
      usageMonthlyMatched++;
      const usage = data.usage || data.totals || {};
      streamMinutes += readStreamingMinutes(data);
      hlsMinutes += Number(usage.outputMinutes?.hls ?? 0) + Number(usage.hlsMinutes ?? 0);
      apiRequests += Number(usage.apiRequests ?? usage.api_requests ?? 0);
    });
    console.log("[admin/usage] usageMonthly", {
      total: usageMonthlySnap.size,
      matched: usageMonthlyMatched,
      streamMinutes,
      hlsMinutes,
      apiRequests,
    });

    let messagesSent = 0;
    try {
      const messageSnap = await firestore.collectionGroup("messages").get();
      let messagesSkippedTime = 0;
      let messagesSkippedProgram = 0;
      messagesSent = messageSnap.docs.reduce((count, doc) => {
        const data = doc.data() as any;
        const createdMs = getDocMillis(data, ["createdAt", "createdAtMs", "created", "created_at"]);
        if (!isInRange(createdMs, startMs, endMs)) { messagesSkippedTime++; return count; }
        if (!activeProgramId) return count + 1;

        const path = doc.ref.path.split("/");
        const roomId = path.length >= 2 && path[0] === "rooms" ? path[1] : "";
        if (!roomId) { messagesSkippedProgram++; return count; }
        // When messages don't carry program fields, allow matching via roomId path token.
        if (!roomId.includes(activeProgramId)) { messagesSkippedProgram++; return count; }
        return count + 1;
      }, 0);
      console.log("[admin/usage] messages", {
        total: messageSnap.size,
        skippedTime: messagesSkippedTime,
        skippedProgram: messagesSkippedProgram,
        messagesSent,
      });
    } catch (msgErr: any) {
      console.error("[admin/usage] collectionGroup('messages') failed:", msgErr?.message || msgErr);
      messagesSent = 0;
    }

    let ticketsToday = 0;
    try {
      const ticketsSnapshot = await firestore.collection("supportTickets").get();
      ticketsToday = ticketsSnapshot.docs.reduce((count, doc) => {
        const data = doc.data();
        if (!matchesProgramContext(data, activeProgramId)) return count;
        const createdMs = getDocMillis(data, ["createdAt", "createdAtMs", "created", "created_at"]);
        return isInRange(createdMs, startMs, endMs) ? count + 1 : count;
      }, 0);
    } catch (tickErr: any) {
      console.error("[admin/usage] supportTickets query failed:", tickErr?.message || tickErr);
      ticketsToday = 0;
    }

    console.log("[admin/usage] final counts", {
      ticketsToday,
      activeUsers,
      roomsCreated,
      messagesSent,
      streamMinutes,
      apiRequests,
      recordingsCreated,
      hlsMinutes,
    });

    res.json({
      ticketsToday: Number(ticketsToday || 0),
      activeUsers: Number(activeUsers || 0),
      roomsCreated: Number(roomsCreated || 0),
      messagesSent: Number(messagesSent || 0),
      streamMinutes: Number(streamMinutes || 0),
      apiRequests: Number(apiRequests || 0),
      recordingsCreated: Number(recordingsCreated || 0),
      hlsMinutes: Number(hlsMinutes || 0),
      usage: usageData,
      total: usageData.length,
      limit,
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
 * GET /api/admin/stats
 * Get overall platform statistics
 */
router.get("/stats", async (req, res) => {
  try {
    const usersSnapshot = await firestore.collection("users").get();
    const includeDeleted = (() => {
      const raw = String(req.query.includeDeleted || "").trim().toLowerCase();
      return raw === "1" || raw === "true" || raw === "yes";
    })();
    
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let totalUsers = 0;
    let usersByPlan: Record<string, number> = {};
    for (const plan of PLAN_IDS) {
      usersByPlan[plan] = 0;
    }
    let activeToday = 0;
    let activeThisWeek = 0;
    let activeThisMonth = 0;

    usersSnapshot.docs.forEach((doc) => {
      const data = doc.data();

      if (!includeDeleted && isDeletedUserRecord(data)) {
        return;
      }

      totalUsers++;
      
      const plan = (data.planId || "free");
      if (isPlanId(plan)) {
        usersByPlan[plan]++;
      } else {
        // Track unknown plans if needed
        usersByPlan[plan] = (usersByPlan[plan] || 0) + 1;
      }

      const lastActive = data.lastActive?.toDate();
      if (lastActive) {
        if (lastActive >= dayStart) activeToday++;
        if (lastActive >= weekStart) activeThisWeek++;
        if (lastActive >= monthStart) activeThisMonth++;
      }
    });

    // Get total minutes used
    const usageSnapshot = await firestore.collection("usage").get();
    const totalMinutesUsed = usageSnapshot.docs.reduce(
      (sum, doc) => sum + (doc.data().minutes || 0),
      0
    );

    const stats = {
      totalUsers,
      usersByPlan,
      activeToday,
      activeThisWeek,
      activeThisMonth,
      totalMinutesUsed,
      averageMinutesPerUser: totalUsers > 0 ? totalMinutesUsed / totalUsers : 0,
    };

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

// Mount admin monitoring & operational awareness sub-routes
// (monitoring/overview, monitoring/services, monitoring/webhooks, alerts, rooms/active, support/tickets)
router.use(adminMonitoringRoutes);



export default router;