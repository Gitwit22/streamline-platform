"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canAccessFeature = canAccessFeature;
const firebaseAdmin_1 = require("../firebaseAdmin");
const BAD_BILLING_STATUSES = new Set([
    "past_due",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "canceled",
]);
// List of paid plans (update as needed, or drive from plan config)
const PAID_PLANS = [
    "starter",
    "pro",
    "basic",
    "enterprise",
    // Add any other paid plans here
];
function isPaidPlan(planId) {
    if (!planId)
        return false;
    // Accept legacy or variant ids (e.g., "starter_paid")
    let canonical = String(planId).toLowerCase();
    if (canonical.endsWith("_paid") || canonical.endsWith("_trial")) {
        canonical = canonical.replace(/_(paid|trial)$/i, "");
    }
    return PAID_PLANS.includes(canonical) || canonical === "internal_unlimited";
}
function billingBlocks(user) {
    const planId = user?.planId;
    const billingStatus = user?.billingStatus;
    const billingActive = user?.billingActive;
    // Admin override bypasses all billing blocks
    if (user?.adminOverride) {
        return null;
    }
    if (!isPaidPlan(planId)) {
        return null; // free users don’t need billing
    }
    // Missing subscription is a hard block
    const subscriptionId = user?.stripeSubscriptionId || user?.billing?.subscriptionId;
    if (!subscriptionId) {
        return "Missing subscription";
    }
    if (billingActive === false) {
        return "Billing inactive";
    }
    if (billingStatus && BAD_BILLING_STATUSES.has(String(billingStatus))) {
        return `Billing ${billingStatus}`;
    }
    // Paid plan but no billing status is suspicious → block
    if (!billingStatus) {
        return "Missing billing status";
    }
    return null; // billing OK
}
async function canAccessFeature(uid, featureKey) {
    // 1) Load user
    const userSnap = await firebaseAdmin_1.firestore.collection("users").doc(uid).get();
    if (!userSnap.exists) {
        return { allowed: false, reason: "User not found" };
    }
    const user = userSnap.data();
    const planId = user?.planId || "free";
    if (process.env.DEBUG_FEATURE_ACCESS === "1") {
        console.log(`[featureAccess] uid=${uid} feature=${featureKey} planId=${planId} adminOverride=${!!user?.adminOverride}`);
    }
    // Admin override grants access to all features
    // Source 1: flag on user doc
    if (user?.adminOverride) {
        return { allowed: true };
    }
    // Source 2: membership in /admins collection
    try {
        const adminSnap = await firebaseAdmin_1.firestore.collection("admins").doc(uid).get();
        const isAdmin = adminSnap.exists && adminSnap.data()?.isAdmin === true;
        if (process.env.DEBUG_FEATURE_ACCESS === "1") {
            console.log(`[featureAccess] admin collection isAdmin=${isAdmin}`);
        }
        if (isAdmin) {
            return { allowed: true };
        }
    }
    catch { }
    // Internal unlimited plan unlocks all features
    if (String(planId).toLowerCase() === "internal_unlimited") {
        return { allowed: true };
    }
    // 2) STRICT BILLING BLOCK (NEW)
    const billingBlockReason = billingBlocks(user);
    if (billingBlockReason) {
        return {
            allowed: false,
            reason: `Billing issue: ${billingBlockReason}`,
        };
    }
    // 3) Load plan
    const planSnap = await firebaseAdmin_1.firestore.collection("plans").doc(planId).get();
    if (!planSnap.exists) {
        return { allowed: false, reason: "Plan not found" };
    }
    const plan = planSnap.data();
    // 4) Feature flag check (with aliases for multistream)
    let enabled = Boolean(plan?.features?.[featureKey]);
    if (process.env.DEBUG_FEATURE_ACCESS === "1") {
        console.log(`[featureAccess] initial flag check features.${featureKey}=${plan?.features?.[featureKey]} multistreamEnabled=${plan?.multistreamEnabled}`);
    }
    if (!enabled) {
        if (featureKey === "multistream") {
            enabled = Boolean(plan?.features?.multistream ||
                plan?.features?.rtmp ||
                plan?.features?.rtmpMultistream ||
                plan?.multistreamEnabled);
            if (process.env.DEBUG_FEATURE_ACCESS === "1") {
                console.log(`[featureAccess] alias check result enabled=${enabled} via multistream|rtmp|rtmpMultistream|multistreamEnabled`);
            }
        }
    }
    if (!enabled) {
        return {
            allowed: false,
            reason: "Feature not available on your plan",
        };
    }
    return { allowed: true };
}
