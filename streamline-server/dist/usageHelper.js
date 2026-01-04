"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeNextResetDate = computeNextResetDate;
exports.addUsageForUser = addUsageForUser;
exports.getUserUsage = getUserUsage;
exports.checkStorageLimit = checkStorageLimit;
exports.updateStorageUsage = updateStorageUsage;
// server/usageHelper.ts
const firebaseAdmin_1 = require("./firebaseAdmin");
/**
 * Helper to compute the billing period reset date based on user.createdAt
 */
function computeNextResetDate(userCreatedAt, fromDate = new Date()) {
    const createdDate = typeof userCreatedAt === "string" ? new Date(userCreatedAt) : userCreatedAt;
    const createdDay = createdDate.getDate();
    const thisMonthReset = new Date(fromDate.getFullYear(), fromDate.getMonth(), createdDay);
    const nextMonthReset = new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, createdDay);
    // If today's date is past this month's reset day, next reset is next month
    const finalReset = fromDate.getDate() >= createdDay ? nextMonthReset : thisMonthReset;
    return finalReset;
}
/**
 * Central function to add usage for a user
 * Called when: stream ends, render completes, etc.
 */
async function addUsageForUser(userId, durationMinutes, options) {
    try {
        const userRef = firebaseAdmin_1.firestore.collection("users").doc(userId);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
            throw new Error(`User ${userId} not found`);
        }
        const userData = userSnap.data();
        const now = new Date();
        const durationHours = durationMinutes / 60;
        // Get the user's current usage and plan
        const usage = (userData.usage || {});
        const planId = userData.plan || "free";
        // Get plan limits
        const planSnap = await firebaseAdmin_1.firestore.collection("plans").doc(planId).get();
        const planData = planSnap.data() || {};
        const maxHoursPerMonth = planData.maxHoursPerMonth || 0;
        // Compute the current billing period
        const resetDate = computeNextResetDate(userData.createdAt, now);
        // Check if we need to reset this period
        let periodStart = usage.periodStart
            ? typeof usage.periodStart === "string"
                ? new Date(usage.periodStart)
                : usage.periodStart.toDate?.()
            : null;
        if (!periodStart || periodStart > now) {
            // First stream or new period
            periodStart = new Date();
            // Set period start to the beginning of this billing window
            periodStart.setDate(resetDate.getDate() - 30); // Rough start of current period
        }
        // Add to usage counters
        const hoursStreamedThisMonth = (usage.hoursStreamedThisMonth || 0) + durationHours;
        const hoursStreamedToday = (usage.hoursStreamedToday || 0) + durationHours;
        const ytdHours = (usage.ytdHours || 0) + durationHours;
        const guestCountToday = (usage.guestCountToday || 0) + (options?.guestCount || 0);
        // Check if over limit (optional warning)
        const isOverLimit = hoursStreamedThisMonth > maxHoursPerMonth;
        // Update Firestore
        await userRef.update({
            "usage.hoursStreamedThisMonth": hoursStreamedThisMonth,
            "usage.hoursStreamedToday": hoursStreamedToday,
            "usage.ytdHours": ytdHours,
            "usage.guestCountToday": guestCountToday,
            "usage.periodStart": periodStart,
            "usage.resetDate": resetDate,
            "usage.lastUsageUpdate": now,
        });
        return {
            ok: true,
            durationHours,
            hoursStreamedThisMonth,
            maxHoursPerMonth,
            isOverLimit,
            resetDate: resetDate.toISOString(),
        };
    }
    catch (err) {
        console.error("addUsageForUser error:", err);
        throw err;
    }
}
/**
 * Get current usage for a user
 */
async function getUserUsage(userId) {
    try {
        const userRef = firebaseAdmin_1.firestore.collection("users").doc(userId);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
            throw new Error(`User ${userId} not found`);
        }
        const userData = userSnap.data();
        const usage = (userData.usage || {});
        const planId = userData.plan || "free";
        // Get plan limits
        const planSnap = await firebaseAdmin_1.firestore.collection("plans").doc(planId).get();
        const planData = planSnap.data() || {};
        const maxHoursPerMonth = planData.maxHoursPerMonth || 0;
        const maxGuests = planData.maxGuests || 0;
        const multistreamEnabled = !!planData.multistreamEnabled;
        // Compute reset date
        const resetDate = computeNextResetDate(userData.createdAt);
        const hoursStreamedThisMonth = usage.hoursStreamedThisMonth || 0;
        const ytdHours = usage.ytdHours || 0;
        return {
            displayName: userData.displayName || "",
            planId,
            hoursStreamedThisMonth,
            maxHoursPerMonth,
            ytdHours,
            resetDate: resetDate.toISOString(),
            maxGuests,
            multistreamEnabled,
            priceWeekly: planData.priceWeekly || 0,
            priceMonthly: planData.priceMonthly || 0,
            priceYearly: planData.priceYearly || 0,
        };
    }
    catch (err) {
        console.error("getUserUsage error:", err);
        throw err;
    }
}
/**
 * ✅ PROMPT #3: Check storage limits before upload
 * Loads plan limits and current usage, enforces plan-based storage caps
 */
async function checkStorageLimit(userId, fileSizeBytes) {
    try {
        const userRef = firebaseAdmin_1.firestore.collection("users").doc(userId);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
            throw new Error(`User ${userId} not found`);
        }
        const userData = userSnap.data();
        const planId = userData.plan || "free";
        // Get plan limits
        const planSnap = await firebaseAdmin_1.firestore.collection("plans").doc(planId).get();
        const planData = planSnap.data() || {};
        const maxStorageGB = planData.maxStorageGB || 0;
        // Get current usage
        const usage = (userData.usage || {});
        const currentStorageBytes = usage.storageUsedBytes || 0;
        const currentStorageGB = currentStorageBytes / (1024 * 1024 * 1024);
        // Calculate new total
        const newStorageGB = currentStorageGB + fileSizeBytes / (1024 * 1024 * 1024);
        // Check against limit
        if (newStorageGB > maxStorageGB) {
            throw new Error(`Storage limit exceeded. Current: ${currentStorageGB.toFixed(2)} GB / ${maxStorageGB} GB. ` +
                `File size: ${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB would exceed limit.`);
        }
        console.log(`✅ Storage check passed for ${userId}: ${newStorageGB.toFixed(2)} GB / ${maxStorageGB} GB`);
    }
    catch (err) {
        console.error("checkStorageLimit error:", err);
        throw err;
    }
}
/**
 * Update storage usage after successful upload
 */
async function updateStorageUsage(userId, fileSizeBytes) {
    try {
        const userRef = firebaseAdmin_1.firestore.collection("users").doc(userId);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
            throw new Error(`User ${userId} not found`);
        }
        const userData = userSnap.data();
        const usage = (userData.usage || {});
        const currentStorageBytes = usage.storageUsedBytes || 0;
        await userRef.update({
            "usage.storageUsedBytes": currentStorageBytes + fileSizeBytes,
            "usage.lastStorageUpdate": new Date(),
        });
        console.log(`✅ Updated storage usage for ${userId}`);
    }
    catch (err) {
        console.error("updateStorageUsage error:", err);
        throw err;
    }
}
