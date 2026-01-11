/**
 * PUT /api/admin/plans/:planId
 * Update a plan document (any field except id)
 */

console.log("✅ admin.ts loaded");
import express from "express";

import { firestore } from "../firebaseAdmin";
import { requireAdmin, logAdminAction } from "../middleware/adminAuth";
import { invalidatePlatformBillingCache } from "../lib/userAccount";

import type { UserUsageSummary } from "../types/admin.types";
import { getCurrentMonthKey } from "../lib/usageTracker";
import { PLAN_IDS, PlanId, isPlanId, getAllPlanIds } from "../types/plan";
import { resolveMaxDestinations } from "../lib/planLimits";

const router = express.Router();

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
      return res.status(401).json({ error: "unauthorized", message: "Missing admin uid" });
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
      message: err?.message || String(err),
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

    console.log("🎯 4. Mapped all plans:", JSON.stringify(plans));
    return res.json({ plans });
  } catch (err: any) {
    console.error("🎯 ERROR in plans route:", err);
    return res.status(500).json({ error: "Failed to load plans", details: err.message });
  }
});

router.put("/plans/:planId", async (req, res) => {
  try {
    const { planId } = req.params;
    const updateData = { ...req.body };
    // Prevent changing the id field
    if ("id" in updateData) {
      delete updateData.id;
    }
    const planRef = firestore.collection("plans").doc(planId);
    const planSnap = await planRef.get();
    if (!planSnap.exists) {
      return res.status(404).json({ error: "Plan not found" });
    }
    await planRef.update(updateData);
    await logAdminAction(req.adminUser!.uid, "update_plan", { planId, updateData });
    res.json({ success: true, planId, updated: updateData });
  } catch (error: any) {
    console.error("Failed to update plan:", error);
    res.status(500).json({ error: "Failed to update plan", details: error.message });
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

    let query = firestore.collection("users").orderBy("createdAt", "desc");

    if (planFilter) {
      query = query.where("planId", "==", planFilter) as any;
    }

    const snapshot = await query.limit(limit).offset(offset).get();

    const users = snapshot.docs.map((doc) => ({
      uid: doc.id,
      ...doc.data(),
    }));

    res.json({
      users,
      total: snapshot.size,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error("Failed to fetch users:", error);
    res.status(500).json({ error: "Failed to fetch users", details: error.message });
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
    res.status(500).json({ error: "Failed to delete user", details: error.message });
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
    res.status(500).json({ error: "Failed to fetch user details", details: error.message });
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
    res.status(500).json({ error: "Failed to grant minutes", details: error.message });
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
    res.status(500).json({ error: "Failed to change plan", details: error.message });
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
    res.status(500).json({ error: "Failed to toggle billing", details: error.message });
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
        "advancedPermissions",
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
    res.status(500).json({ error: "plans_migrate_schema_failed", details: error.message });
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

    await docRef.set(
      {
        billingSystemEnabled: enabled,
        updatedAt: now,
        updatedBy: req.adminUser!.uid,
        reason: typeof reason === "string" ? reason : undefined,
      },
      { merge: true }
    );

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
      details: error.message,
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
    const monthKey = getCurrentMonthKey();

    // Get all users
    let usersQuery = firestore.collection("users");
    if (planFilter) {
      usersQuery = usersQuery.where("planId", "==", planFilter) as any;
    }

    const usersSnapshot = await usersQuery.limit(limit).get();

    // Fetch all plans once for efficiency
    const plansSnap = await firestore.collection("plans").get();
    const plansMap = Object.fromEntries(plansSnap.docs.map(d => [d.id, d.data()]));

    const usageData = await Promise.all(
      usersSnapshot.docs.map(async (doc) => {
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

        return {
          userId,
          email: userData.email,
          displayName: userData.displayName,
          planId,
          minutesUsed,
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

    res.json({
      usage: usageData,
      total: usageData.length,
      limit,
    });
  } catch (error: any) {
    console.error("Failed to fetch usage stats:", error);
    res.status(500).json({ error: "Failed to fetch usage stats", details: error.message });
  }
});

/**
 * GET /api/admin/stats
 * Get overall platform statistics
 */
router.get("/stats", async (req, res) => {
  try {
    const usersSnapshot = await firestore.collection("users").get();
    
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
    res.status(500).json({ error: "Failed to fetch stats", details: error.message });
  }
});

/**
 * POST /api/admin/features/toggle
 * Toggle a global feature flag
 */
router.post("/features/toggle", async (req, res) => {
  try {
    const { featureName, enabled, reason } = req.body;

    if (!featureName) {
      return res.status(400).json({ error: "featureName is required" });
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
    res.status(500).json({ error: "Failed to toggle feature", details: error.message });
  }
});

/**
 * GET /api/admin/features
 * List all feature flags
 */
router.get("/features", async (req, res) => {
  try {
    const snapshot = await firestore.collection("featureFlags").get();

    const features = snapshot.docs.map((doc) => ({
      name: doc.id,
      ...doc.data(),
    }));

    res.json({ features });
  } catch (error: any) {
    console.error("Failed to fetch features:", error);
    res.status(500).json({ error: "Failed to fetch features", details: error.message });
  }
});



export default router;