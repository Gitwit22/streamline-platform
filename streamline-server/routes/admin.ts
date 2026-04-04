/**
 * PUT /api/admin/plans/:planId
 * Update a plan document (any field except id)
 */

console.log("✅ admin.ts loaded");
import express from "express";

import { firestore } from "../firebaseAdmin";
import { requireAdmin, logAdminAction } from "../middleware/adminAuth";
import { computeUsageSummaryResult } from "./usageRoutes";
import { invalidatePlatformBillingCache } from "../lib/userAccount";

import type { UserUsageSummary } from "../types/admin.types";
import { getCurrentMonthKey } from "../lib/usageTracker";
import { PLAN_IDS, PlanId, isPlanId, getAllPlanIds } from "../types/plan";
import { resolveMaxDestinations } from "../lib/planLimits";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { normalizeBillingTruthFromUser } from "../lib/billingTruth";

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

    const planId = String(user.planId ?? user.plan ?? "free");
    const planSnap = await firestore.collection("plans").doc(planId).get();
    const planDoc = planSnap.exists ? (planSnap.data() as any) : null;

    const limits = (planDoc?.limits || {}) as any;
    const features = (planDoc?.features || {}) as any;

    const maxDestinations = resolveMaxDestinations(limits);

    const rtmp = Boolean(features.rtmp);
    const rtmpMultistream = Boolean(
      features.rtmpMultistream ?? features.multistream ?? planDoc?.multistreamEnabled
    );
    const dualRecording = Boolean(features.dualRecording ?? features.dual_recording);

    const gating = {
      canUseRtmp: rtmp,
      canUseMultistream: rtmp && rtmpMultistream,
      canUseDualRecording: dualRecording,
    };

    return res.json({
      user: {
        uid,
        email: adminUser.email,
        planId,
        planLegacy: user.plan ?? null,
        adminOverride: Boolean(user.adminOverride),
        adminOverrideHls: Boolean((user as any).adminOverrideHls),
        admin: user.admin ?? null,
        isAdminUserField: Boolean(user.admin?.isAdmin ?? user.isAdmin),
      },
      plan: {
        id: planId,
        exists: Boolean(planDoc),
        raw: planDoc,
        limits,
        features,
        resolved: {
          maxDestinations,
          rtmp,
          rtmpMultistream,
          dualRecording,
        },
        gating,
      },
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

    const plans = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as any),
    }));
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

    const updateData = { ...req.body };
    // Prevent changing the id field
    if ("id" in updateData) {
      delete updateData.id;
    }
    const planRef = firestore.collection("plans").doc(planId);
    const planSnap = await planRef.get();
    if (!planSnap.exists) {
      // Create the plan doc if it doesn't exist yet (e.g. first-time setup)
      await planRef.set({ id: planId, ...updateData, createdAt: new Date().toISOString() });
    } else {
      await planRef.set(updateData, { merge: true });
    }
    await logAdminAction(req.adminUser!.uid, "update_plan", { planId, updateData });
    res.json({ success: true, planId, updated: updateData });
  } catch (error: any) {
    console.error("Failed to update plan:", error);
    res.status(500).json({ error: "Failed to update plan" });
  }
});

// ── Seed / ensure all canonical plan documents exist with full features+limits ──
router.post("/plans/seed", async (req, res) => {
  try {
    const PLANS: Record<string, any> = {
      free: {
        name: "Free",
        description: "Get started – basic in-room experience",
        priceMonthly: 0,
        visibility: "public",
        features: {
          recording: false, rtmp: false, multistream: false, dualRecording: false,
          advancedPermissions: false, allowsOverages: false,
          canHls: false, hls: false, hlsEnabled: false, hlsCustomizationEnabled: false,
          invisibleHost: false,
        },
        limits: {
          monthlyMinutesIncluded: 180, transcodeMinutes: 0, maxGuests: 2,
          rtmpDestinationsMax: 0, maxSessionMinutes: 60, maxRecordingMinutesPerClip: 0, maxHoursPerMonth: 3,
        },
        caps: { hlsMaxMinutesPerSession: null },
        editing: { access: false, maxProjects: 0, maxStorageGB: 0, maxStorageBytes: 0 },
      },
      basic: {
        name: "Basic",
        description: "For hobbyists – recording & basic editing",
        priceMonthly: 15,
        visibility: "public",
        features: {
          recording: true, rtmp: false, multistream: false, dualRecording: false,
          advancedPermissions: false, allowsOverages: false,
          canHls: false, hls: false, hlsEnabled: false, hlsCustomizationEnabled: false,
          invisibleHost: false,
        },
        limits: {
          monthlyMinutesIncluded: 360, transcodeMinutes: 0, maxGuests: 4,
          rtmpDestinationsMax: 0, maxSessionMinutes: 120, maxRecordingMinutesPerClip: 30, maxHoursPerMonth: 6,
        },
        caps: { hlsMaxMinutesPerSession: null },
        editing: { access: true, maxProjects: 2, maxStorageGB: 3, maxStorageBytes: 3 * 1024 * 1024 * 1024 },
      },
      starter: {
        name: "Starter",
        description: "For growing creators – streaming, recording & editing",
        priceMonthly: 29,
        visibility: "public",
        features: {
          recording: true, rtmp: true, multistream: true, dualRecording: false,
          advancedPermissions: false, allowsOverages: false,
          canHls: false, hls: false, hlsEnabled: false, hlsCustomizationEnabled: false,
          invisibleHost: false,
        },
        limits: {
          monthlyMinutesIncluded: 600, transcodeMinutes: 60, maxGuests: 5,
          rtmpDestinationsMax: 3, maxSessionMinutes: 240, maxRecordingMinutesPerClip: 15, maxHoursPerMonth: 10,
        },
        caps: { hlsMaxMinutesPerSession: null },
        editing: { access: true, maxProjects: 5, maxStorageGB: 15, maxStorageBytes: 15 * 1024 * 1024 * 1024 },
      },
      pro: {
        name: "Pro",
        description: "For professionals – full suite with HLS & overages",
        priceMonthly: 79,
        visibility: "public",
        features: {
          recording: true, rtmp: true, multistream: true, dualRecording: true,
          advancedPermissions: false, allowsOverages: true,
          canHls: true, hls: true, hlsEnabled: true, hlsCustomizationEnabled: true,
          invisibleHost: true,
        },
        limits: {
          monthlyMinutesIncluded: 2400, transcodeMinutes: 300, maxGuests: 10,
          rtmpDestinationsMax: 3, maxSessionMinutes: 480, maxRecordingMinutesPerClip: 60, maxHoursPerMonth: 40,
        },
        caps: { hlsMaxMinutesPerSession: null },
        editing: { access: true, maxProjects: 10, maxStorageGB: 25, maxStorageBytes: 25 * 1024 * 1024 * 1024 },
      },
      enterprise: {
        name: "Enterprise",
        description: "Custom enterprise solution – configured per account",
        priceMonthly: 0,
        visibility: "admin",
        features: {
          recording: true, rtmp: true, multistream: true, dualRecording: true,
          advancedPermissions: false, allowsOverages: true,
          canHls: true, hls: true, hlsEnabled: true, hlsCustomizationEnabled: true,
          invisibleHost: true,
        },
        limits: {
          monthlyMinutesIncluded: 6000, transcodeMinutes: 1000, maxGuests: 50,
          rtmpDestinationsMax: 10, maxSessionMinutes: 720, maxRecordingMinutesPerClip: 120, maxHoursPerMonth: 100,
        },
        caps: { hlsMaxMinutesPerSession: null },
        editing: { access: true, maxProjects: 0, maxStorageGB: 0, maxStorageBytes: 0 },
        customizable: true, contactSales: true,
      },
      internal_unlimited: {
        name: "Internal Unlimited",
        description: "Internal testing – all features unlocked",
        priceMonthly: 0,
        visibility: "admin",
        features: {
          recording: true, rtmp: true, multistream: true, dualRecording: true,
          advancedPermissions: false, allowsOverages: true,
          canHls: true, hls: true, hlsEnabled: true, hlsCustomizationEnabled: true,
          invisibleHost: true,
        },
        limits: {
          monthlyMinutesIncluded: 99999, transcodeMinutes: 99999, maxGuests: 100,
          rtmpDestinationsMax: 10, maxSessionMinutes: 1440, maxRecordingMinutesPerClip: 999, maxHoursPerMonth: 9999,
        },
        caps: { hlsMaxMinutesPerSession: null },
        editing: { access: true, maxProjects: 999, maxStorageGB: 100, maxStorageBytes: 100 * 1024 * 1024 * 1024 },
      },
    };

    const results: { created: string[]; updated: string[]; errors: Array<{ planId: string; error: string }> } = {
      created: [], updated: [], errors: [],
    };

    for (const [planId, planData] of Object.entries(PLANS)) {
      try {
        const docRef = firestore.collection("plans").doc(planId);
        const existingDoc = await docRef.get();
        const payload: any = { ...planData, id: planId, updatedAt: new Date().toISOString() };
        if (!existingDoc.exists) payload.createdAt = new Date().toISOString();
        await docRef.set(payload, { merge: true });
        (existingDoc.exists ? results.updated : results.created).push(planId);
      } catch (err: any) {
        results.errors.push({ planId, error: err?.message || String(err) });
      }
    }

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

    const users = snapshot.docs.map((doc) => {
      const raw = doc.data() || {};
      const planId = typeof (raw as any).planId === "string" && String((raw as any).planId).trim() ? (raw as any).planId : "free";
      const billingTruth = normalizeBillingTruthFromUser({ ...raw, planId }, now);
      return {
        uid: doc.id,
        ...raw,
        planId,
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
 * Delete a user by userId
 */
router.delete("/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userRef = firestore.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }
    await userRef.delete();
    // Optionally, delete related usage records
    // const usageSnap = await firestore.collection("usage").where("userId", "==", userId).get();
    // const batch = firestore.batch();
    // usageSnap.forEach(doc => batch.delete(doc.ref));
    // await batch.commit();
    await logAdminAction(req.adminUser!.uid, "delete_user", { userId });
    res.json({ success: true, userId });
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

    // Get usage for current month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const usageSnapshot = await firestore
      .collection("usage")
      .where("userId", "==", userId)
      .where("timestamp", ">=", monthStart)
      .orderBy("timestamp", "desc")
      .get();

    const currentMonthUsage = usageSnapshot.docs.reduce(
      (sum, doc) => sum + (doc.data().minutes || 0),
      0
    );

    // Get all-time usage
    const allUsageSnapshot = await firestore
      .collection("usage")
      .where("userId", "==", userId)
      .get();

    const allTimeUsage = allUsageSnapshot.docs.reduce(
      (sum, doc) => sum + (doc.data().minutes || 0),
      0
    );

    const recentActivity = usageSnapshot.docs.slice(0, 10).map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // ---- Fetch plan limits live from Firestore ----
    const planId = (userData?.planId || userData?.plan || "free").toLowerCase();
    const planSnap = await firestore.collection("plans").doc(planId).get();
    const planData = planSnap.exists ? (planSnap.data() as any) : null;
    // Safe fallback if plan doc missing. Prefer canonical participant/monthly minutes fields.
    const includedMinutes =
      Number(planData?.limits?.participantMinutes ?? 0) ||
      Number(planData?.limits?.monthlyMinutes ?? 0) ||
      Number(planData?.limits?.monthlyMinutesIncluded ?? 60);

    const userSummary: UserUsageSummary = {
      user: {
        uid: userId,
        ...userData,
      } as any,
      currentMonthUsage,
      allTimeUsage,
      planLimit: includedMinutes,
      percentUsed: Math.round((currentMonthUsage / includedMinutes) * 100),
      isBlocked: currentMonthUsage >= includedMinutes,
      recentActivity: recentActivity as any,
    };

    res.json(userSummary);
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
 * Change a user's plan
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

    // Log the action
    await logAdminAction(req.adminUser!.uid, "change_plan", {
      userId,
      oldPlan,
      newPlan,
      reason,
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

/**
 * POST /api/admin/plans/migrate-schema
 * One-time migration to normalize plan documents in Firestore to the canonical schema.
 *
 * - Renames legacy fields:
 *   - limits.monthlyMinutesIncluded -> limits.monthlyMinutes
 *   - limits.rtmpDestinationsMax / limits.maxDestinations -> limits.rtmpDestinations
 * - Moves any top-level limit fields into limits and removes the legacy copies:
 *   - maxGuests, maxHoursPerMonth, maxDestinations
 * - Ensures feature flags are booleans (default false).
 * - Ensures known numeric limits are numbers (default 0).
 */
router.post("/plans/migrate-schema", async (req, res) => {
  try {
    const snap = await firestore.collection("plans").get();
    const report: Array<{
      id: string;
      updated: boolean;
      renamed: Record<string, string>;
      removed: string[];
      defaultsApplied: string[];
    }> = [];

    for (const doc of snap.docs) {
      const id = doc.id;
      const before = (doc.data() as any) || {};
      const after = { ...before } as any;
      const renamed: Record<string, string> = {};
      const removed: string[] = [];
      const defaultsApplied: string[] = [];

      const features = { ...(after.features || {}) } as any;
      const limits = { ...(after.limits || {}) } as any;

      // ---- Rename legacy minute fields ----
      if (typeof limits.monthlyMinutes === "undefined" && typeof limits.monthlyMinutesIncluded === "number") {
        limits.monthlyMinutes = limits.monthlyMinutesIncluded;
        renamed["limits.monthlyMinutesIncluded"] = "limits.monthlyMinutes";
      }
      if (Object.prototype.hasOwnProperty.call(limits, "monthlyMinutesIncluded")) {
        delete limits.monthlyMinutesIncluded;
        removed.push("limits.monthlyMinutesIncluded");
      }

      // ---- RTMP destinations: collapse to limits.rtmpDestinations ----
      if (typeof limits.rtmpDestinations === "undefined") {
        if (typeof limits.rtmpDestinationsMax === "number") {
          limits.rtmpDestinations = limits.rtmpDestinationsMax;
          renamed["limits.rtmpDestinationsMax"] = "limits.rtmpDestinations";
        } else if (typeof limits.maxDestinations === "number") {
          limits.rtmpDestinations = limits.maxDestinations;
          renamed["limits.maxDestinations"] = "limits.rtmpDestinations";
        }
      }
      if (Object.prototype.hasOwnProperty.call(limits, "rtmpDestinationsMax")) {
        delete limits.rtmpDestinationsMax;
        removed.push("limits.rtmpDestinationsMax");
      }
      if (Object.prototype.hasOwnProperty.call(limits, "maxDestinations")) {
        delete limits.maxDestinations;
        removed.push("limits.maxDestinations");
      }

      // ---- Move any top-level limit fields into limits ----
      if (typeof after.maxGuests === "number") {
        if (typeof limits.maxGuests === "undefined") {
          limits.maxGuests = after.maxGuests;
          renamed["maxGuests"] = "limits.maxGuests";
        }
        delete after.maxGuests;
        removed.push("maxGuests");
      }

      if (typeof after.maxHoursPerMonth === "number") {
        if (typeof limits.maxHoursPerMonth === "undefined") {
          limits.maxHoursPerMonth = after.maxHoursPerMonth;
          renamed["maxHoursPerMonth"] = "limits.maxHoursPerMonth";
        }
        delete after.maxHoursPerMonth;
        removed.push("maxHoursPerMonth");
      }

      // ---- Ensure feature flags are booleans ----
      const featureKeys = [
        "recording",
        "rtmp",
        "multistream",
        // "advancedPermissions" is no longer admin-editable; keep any stored
        // value as-is and treat advanced permissions as removed from plans.
        "rtmpMultistream",
        "overagesAllowed",
      ];
      for (const key of featureKeys) {
        if (typeof features[key] !== "boolean") {
          if (features[key] !== undefined) {
            defaultsApplied.push(`features.${key}`);
          }
          features[key] = !!features[key];
        }
      }

      // ---- Ensure known numeric limits are numbers (default 0) ----
      const limitKeys = [
        "monthlyMinutes",
        "participantMinutes",
        "transcodeMinutes",
        "maxGuests",
        "rtmpDestinations",
        "maxSessionMinutes",
        "maxRecordingMinutesPerClip",
        "maxHoursPerMonth",
      ];
      for (const key of limitKeys) {
        const raw = limits[key];
        if (typeof raw === "undefined") {
          limits[key] = 0;
          defaultsApplied.push(`limits.${key}`);
        } else if (typeof raw !== "number" || Number.isNaN(raw)) {
          limits[key] = Number(raw) || 0;
          defaultsApplied.push(`limits.${key}`);
        }
      }

      after.features = features;
      after.limits = limits;

      const updated = JSON.stringify(before) !== JSON.stringify(after);
      if (updated) {
        await doc.ref.set(after, { merge: false });
      }

      report.push({ id, updated, renamed, removed, defaultsApplied });
    }

    res.json({
      ok: true,
      total: snap.size,
      updated: report.filter((r) => r.updated).length,
      report,
    });
  } catch (error: any) {
    console.error("plans/migrate-schema failed", error);
    res.status(500).json({ error: "plans_migrate_schema_failed" });
  }
});

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

    // Fetch all plans once for efficiency
    const plansSnap = await firestore.collection("plans").get();
    const plansMap = Object.fromEntries(plansSnap.docs.map(d => [d.id, d.data()]));

    const usageData = await Promise.all(
      userDocs.map(async (doc) => {
        const userData = doc.data();
        const userId = doc.id;
        // usageMonthly doc id shape: `${uid}_${YYYY-MM}`
        const usageDocId = `${userId}_${monthKey}`;
        const usageSnap = await firestore.collection("usageMonthly").doc(usageDocId).get();
        const usageData = usageSnap.exists ? (usageSnap.data() as any) : {};
        const usage = usageData.usage || usageData.totals || {};
        const minutesUsed = Number(
          usage.participantMinutes ?? usage.streamMinutes ?? usage.minutes ?? 0
        );

        const overages = (usageData.overages || {}) as any;
        const overageParticipantMinutes = Number(overages.participantMinutes ?? 0);
        const overageTranscodeMinutes = Number(overages.transcodeMinutes ?? 0);
        const overageMinutesTotal = overageParticipantMinutes + overageTranscodeMinutes;

        const planIdRaw = userData.planId || "free";
        // Canonicalize planId using isPlanId
        const planId: PlanId | string = isPlanId(planIdRaw) ? planIdRaw : planIdRaw;
        const planData = plansMap[planId] || {};
        const planLimit = Number(
          planData.limits?.participantMinutes ??
          planData.limits?.monthlyMinutesIncluded ??
          0
        );
        const bonusMinutes = userData.bonusMinutes || 0;
        const effectiveLimit = planLimit + bonusMinutes;

        // billingEnabled is tri-state in Firestore; missing => true.
        const billingEnabled = userData.billingEnabled === false ? false : true;
        const effectiveBillingEnabled = platformBillingEnabled && billingEnabled;

        const billingTruth = normalizeBillingTruthFromUser(userData, Date.now());

        return {
          userId,
          email: userData.email,
          displayName: userData.displayName,
          planId,
          billingTruthStatus: billingTruth.status,
          stripeConnected: Boolean(billingTruth.stripeCustomerId),
          stripeCustomerId: billingTruth.stripeCustomerId,
          billingEnabled,
          platformBillingEnabled,
          effectiveBillingEnabled,
          minutesUsed,
          overageParticipantMinutes,
          overageTranscodeMinutes,
          overageMinutesTotal,
          bonusMinutes,
          planLimit,
          effectiveLimit,
          percentUsed: effectiveLimit > 0 ? (minutesUsed / effectiveLimit) * 100 : 0,
          isBlocked: effectiveLimit > 0 ? minutesUsed >= effectiveLimit : false,
          lastActive: userData.lastActive,
        };
      })
    );

    // Sort by percent used (most blocked users first)
    usageData.sort((a, b) => b.percentUsed - a.percentUsed);

    const monthKeys = buildMonthKeys(startMs, endMs);

    // Period-scoped roomsCreated for Support Hub Usage card.
    const roomsSnapshot = await firestore.collection("rooms").get();
    const roomsCreated = roomsSnapshot.docs.reduce((count, doc) => {
      const data = doc.data();
      if (!matchesProgramContext(data, activeProgramId)) return count;
      const createdMs = getDocMillis(data, ["createdAt", "createdAtMs", "created", "created_at"]);
      return isInRange(createdMs, startMs, endMs) ? count + 1 : count;
    }, 0);

    const usersSnapshotAll = await firestore.collection("users").get();
    const activeUsers = usersSnapshotAll.docs.reduce((count, doc) => {
      const data = doc.data();
      if (!includeDeleted && isDeletedUserRecord(data)) return count;
      if (!matchesProgramContext(data, activeProgramId)) return count;
      const lastActiveMs = getDocMillis(data, ["lastActive", "lastActiveAt", "updatedAt"]);
      return isInRange(lastActiveMs, startMs, endMs) ? count + 1 : count;
    }, 0);

    const recordingsSnapshot = await firestore.collection("recordings").get();
    const recordingsCreated = recordingsSnapshot.docs.reduce((count, doc) => {
      const data = doc.data();
      if (!matchesProgramContext(data, activeProgramId)) return count;
      const createdMs = getDocMillis(data, ["createdAt", "createdAtMs", "created", "created_at"]);
      return isInRange(createdMs, startMs, endMs) ? count + 1 : count;
    }, 0);

    const usageMonthlySnap = await firestore.collection("usageMonthly").get();
    let streamMinutes = 0;
    let hlsMinutes = 0;
    let apiRequests = 0;
    usageMonthlySnap.docs.forEach((doc) => {
      const data = doc.data() as any;
      if (!matchesProgramContext(data, activeProgramId)) return;
      const monthKey = String(data.monthKey || doc.id.split("_").pop() || "");
      if (!monthKeys.has(monthKey)) return;
      const usage = data.usage || data.totals || {};
      streamMinutes += Number(usage.participantMinutes ?? usage.streamMinutes ?? usage.minutes ?? 0);
      hlsMinutes += Number(usage.hlsMinutes ?? 0);
      apiRequests += Number(usage.apiRequests ?? usage.api_requests ?? 0);
    });

    let messagesSent = 0;
    try {
      const messageSnap = await firestore.collectionGroup("messages").get();
      messagesSent = messageSnap.docs.reduce((count, doc) => {
        const data = doc.data() as any;
        const createdMs = getDocMillis(data, ["createdAt", "createdAtMs", "created", "created_at"]);
        if (!isInRange(createdMs, startMs, endMs)) return count;
        if (!activeProgramId) return count + 1;

        const path = doc.ref.path.split("/");
        const roomId = path.length >= 2 && path[0] === "rooms" ? path[1] : "";
        if (!roomId) return count;
        // When messages don't carry program fields, allow matching via roomId path token.
        return roomId.includes(activeProgramId) ? count + 1 : count;
      }, 0);
    } catch {
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
    } catch {
      ticketsToday = 0;
    }

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
    const seededDefaults: Array<{ name: string; enabled: boolean }> = [
      { name: "hlsSettingsTab", enabled: true },
      { name: "editorEnabled", enabled: true },
      { name: "contentLibraryEnabled", enabled: true },
      { name: "projectsEnabled", enabled: true },
      { name: "myContentEnabled", enabled: true },
      { name: "myContentRecordingsEnabled", enabled: true },
      { name: "audioMixerEnabled", enabled: false },
      { name: "advancedScreenShareEnabled", enabled: false },
      { name: "mixedAudioPublishEnabled", enabled: false },
      { name: "invisibleHostEnabled", enabled: false },
    ];

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



export default router;