"use strict";
/**
 * PUT /api/admin/plans/:planId
 * Update a plan document (any field except id)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
console.log("✅ admin.ts loaded");
const express_1 = __importDefault(require("express"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const adminAuth_1 = require("../middleware/adminAuth");
const router = express_1.default.Router();
// All routes require admin authentication
router.use(adminAuth_1.requireAdmin);
// In routes/admin.ts
router.use((req, res, next) => {
    console.log("🚀 Admin router received:", req.method, req.path);
    next();
});
router.get('/me', (req, res) => {
    res.json({ isAdmin: true, user: req.adminUser });
});
router.get("/plans", async (req, res) => {
    console.log("🎯 1. Plans route handler started");
    try {
        console.log("🎯 2. About to query Firestore");
        const snap = await firebaseAdmin_1.firestore.collection("plans").get();
        console.log("🎯 3. Firestore returned, docs count:", snap.size);
        const plans = snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
        }));
        console.log("🎯 4. Mapped plans:", JSON.stringify(plans));
        return res.json({ plans });
    }
    catch (err) {
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
        const planRef = firebaseAdmin_1.firestore.collection("plans").doc(planId);
        const planSnap = await planRef.get();
        if (!planSnap.exists) {
            return res.status(404).json({ error: "Plan not found" });
        }
        await planRef.update(updateData);
        await (0, adminAuth_1.logAdminAction)(req.adminUser.uid, "update_plan", { planId, updateData });
        res.json({ success: true, planId, updated: updateData });
    }
    catch (error) {
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
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const planFilter = req.query.plan;
        let query = firebaseAdmin_1.firestore.collection("users").orderBy("createdAt", "desc");
        if (planFilter) {
            query = query.where("planId", "==", planFilter);
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
    }
    catch (error) {
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
        const userRef = firebaseAdmin_1.firestore.collection("users").doc(userId);
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
        await (0, adminAuth_1.logAdminAction)(req.adminUser.uid, "delete_user", { userId });
        res.json({ success: true, userId });
    }
    catch (error) {
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
        const userDoc = await firebaseAdmin_1.firestore.collection("users").doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ error: "User not found" });
        }
        const userData = userDoc.data();
        // Get usage for current month
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const usageSnapshot = await firebaseAdmin_1.firestore
            .collection("usage")
            .where("userId", "==", userId)
            .where("timestamp", ">=", monthStart)
            .orderBy("timestamp", "desc")
            .get();
        const currentMonthUsage = usageSnapshot.docs.reduce((sum, doc) => sum + (doc.data().minutes || 0), 0);
        // Get all-time usage
        const allUsageSnapshot = await firebaseAdmin_1.firestore
            .collection("usage")
            .where("userId", "==", userId)
            .get();
        const allTimeUsage = allUsageSnapshot.docs.reduce((sum, doc) => sum + (doc.data().minutes || 0), 0);
        const recentActivity = usageSnapshot.docs.slice(0, 10).map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));
        // ---- Fetch plan limits live from Firestore ----
        const planId = (userData?.planId || userData?.plan || "free").toLowerCase();
        const planSnap = await firebaseAdmin_1.firestore.collection("plans").doc(planId).get();
        const planData = planSnap.exists ? planSnap.data() : null;
        // Safe fallback if plan doc missing
        const includedMinutes = planData?.limits?.monthlyMinutesIncluded ?? 60;
        const userSummary = {
            user: {
                uid: userId,
                ...userData,
            },
            currentMonthUsage,
            allTimeUsage,
            planLimit: includedMinutes,
            percentUsed: Math.round((currentMonthUsage / includedMinutes) * 100),
            isBlocked: currentMonthUsage >= includedMinutes,
            recentActivity: recentActivity,
        };
        res.json(userSummary);
    }
    catch (error) {
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
        const userRef = firebaseAdmin_1.firestore.collection("users").doc(userId);
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
        await (0, adminAuth_1.logAdminAction)(req.adminUser.uid, "grant_minutes", {
            userId,
            minutes,
            reason,
            previousBonus: currentBonusMinutes,
            newBonus: newBonusMinutes,
        });
        console.log(`Admin ${req.adminUser.email} granted ${minutes} bonus minutes to user ${userId}`);
        res.json({
            success: true,
            userId,
            minutesGranted: minutes,
            totalBonusMinutes: newBonusMinutes,
            reason,
        });
    }
    catch (error) {
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
        const plansSnap = await firebaseAdmin_1.firestore.collection("plans").get();
        const validPlans = plansSnap.docs.map((d) => d.id);
        if (!validPlans.includes(newPlan)) {
            return res.status(400).json({ error: "Invalid plan", validPlans });
        }
        const userRef = firebaseAdmin_1.firestore.collection("users").doc(userId);
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
        await (0, adminAuth_1.logAdminAction)(req.adminUser.uid, "change_plan", {
            userId,
            oldPlan,
            newPlan,
            reason,
        });
        console.log(`Admin ${req.adminUser.email} changed user ${userId} plan from ${oldPlan} to ${newPlan}`);
        res.json({
            success: true,
            userId,
            oldPlan,
            newPlan,
            reason,
        });
    }
    catch (error) {
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
        const userRef = firebaseAdmin_1.firestore.collection("users").doc(userId);
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
        await (0, adminAuth_1.logAdminAction)(req.adminUser.uid, "toggle_billing", {
            userId,
            previousState,
            newState: enabled,
            reason,
        });
        console.log(`Admin ${req.adminUser.email} ${enabled ? "enabled" : "disabled"} billing for user ${userId}`);
        res.json({
            success: true,
            userId,
            billingEnabled: enabled,
            previousState,
            reason,
        });
    }
    catch (error) {
        console.error("Failed to toggle billing:", error);
        res.status(500).json({ error: "Failed to toggle billing", details: error.message });
    }
});
/**
 * GET /api/admin/usage
 * Get usage statistics across all users
 */
router.get("/usage", async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const planFilter = req.query.plan;
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        // Get all users
        let usersQuery = firebaseAdmin_1.firestore.collection("users");
        if (planFilter) {
            usersQuery = usersQuery.where("planId", "==", planFilter);
        }
        const usersSnapshot = await usersQuery.limit(limit).get();
        // Get usage for this month for all users
        const usageSnapshot = await firebaseAdmin_1.firestore
            .collection("usage")
            .where("timestamp", ">=", monthStart)
            .get();
        // Build usage summary
        const usageByUser = {};
        usageSnapshot.docs.forEach((doc) => {
            const data = doc.data();
            const userId = data.userId;
            usageByUser[userId] = (usageByUser[userId] || 0) + (data.minutes || 0);
        });
        // Fetch all plans once for efficiency
        const plansSnap = await firebaseAdmin_1.firestore.collection("plans").get();
        const plansMap = Object.fromEntries(plansSnap.docs.map(d => [d.id, d.data()]));
        const usageData = usersSnapshot.docs.map((doc) => {
            const userData = doc.data();
            const userId = doc.id;
            const minutesUsed = usageByUser[userId] || 0;
            const planId = userData.planId || "free";
            const planData = plansMap[planId] || {};
            const planLimit = planData.limits?.monthlyMinutesIncluded ?? 60;
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
                percentUsed: (minutesUsed / effectiveLimit) * 100,
                isBlocked: minutesUsed >= effectiveLimit,
                lastActive: userData.lastActive,
            };
        });
        // Sort by percent used (most blocked users first)
        usageData.sort((a, b) => b.percentUsed - a.percentUsed);
        res.json({
            usage: usageData,
            total: usageData.length,
            limit,
        });
    }
    catch (error) {
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
        const usersSnapshot = await firebaseAdmin_1.firestore.collection("users").get();
        const now = new Date();
        const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        let totalUsers = 0;
        let usersByPlan = {
            free: 0,
            starter: 0,
            pro: 0,
            enterprise: 0,
        };
        let activeToday = 0;
        let activeThisWeek = 0;
        let activeThisMonth = 0;
        usersSnapshot.docs.forEach((doc) => {
            const data = doc.data();
            totalUsers++;
            const plan = (data.planId || "free");
            usersByPlan[plan]++;
            const lastActive = data.lastActive?.toDate();
            if (lastActive) {
                if (lastActive >= dayStart)
                    activeToday++;
                if (lastActive >= weekStart)
                    activeThisWeek++;
                if (lastActive >= monthStart)
                    activeThisMonth++;
            }
        });
        // Get total minutes used
        const usageSnapshot = await firebaseAdmin_1.firestore.collection("usage").get();
        const totalMinutesUsed = usageSnapshot.docs.reduce((sum, doc) => sum + (doc.data().minutes || 0), 0);
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
    }
    catch (error) {
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
        const featureRef = firebaseAdmin_1.firestore.collection("featureFlags").doc(featureName);
        await featureRef.set({
            enabled,
            updatedAt: new Date(),
            updatedBy: req.adminUser.uid,
        }, { merge: true });
        // Log the action
        await (0, adminAuth_1.logAdminAction)(req.adminUser.uid, "toggle_feature", {
            featureName,
            enabled,
            reason,
        });
        console.log(`Admin ${req.adminUser.email} ${enabled ? "enabled" : "disabled"} feature: ${featureName}`);
        res.json({
            success: true,
            featureName,
            enabled,
            reason,
        });
    }
    catch (error) {
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
        const snapshot = await firebaseAdmin_1.firestore.collection("featureFlags").get();
        const features = snapshot.docs.map((doc) => ({
            name: doc.id,
            ...doc.data(),
        }));
        res.json({ features });
    }
    catch (error) {
        console.error("Failed to fetch features:", error);
        res.status(500).json({ error: "Failed to fetch features", details: error.message });
    }
});
exports.default = router;
