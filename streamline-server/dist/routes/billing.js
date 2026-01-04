"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const stripe_1 = require("../lib/stripe");
const firebaseAdmin_1 = require("../firebaseAdmin");
const requireAuth_1 = require("../middleware/requireAuth");
function getUserRef(uid) {
    return firebaseAdmin_1.firestore.collection("users").doc(uid);
}
const router = (0, express_1.Router)();
/**
 * Canonical Stripe price lookup:
 * - We keep ONE Starter price and ONE Pro price
 * - Trial is applied conditionally via subscription_data.trial_period_days
 */
function priceIdFor(plan) {
    if (plan === "starter") {
        const id = process.env.STRIPE_PRICE_STARTER;
        if (!id)
            throw new Error("Missing STRIPE_PRICE_STARTER");
        return id;
    }
    const id = process.env.STRIPE_PRICE_PRO;
    if (!id)
        throw new Error("Missing STRIPE_PRICE_PRO");
    return id;
}
router.post("/checkout", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid)
            return res.status(401).json({ success: false, error: "Unauthorized" });
        const { plan } = (req.body || {});
        if (plan !== "starter_trial" && plan !== "starter_paid" && plan !== "pro") {
            return res.status(400).json({ success: false, error: "Invalid plan" });
        }
        const CLIENT_URL = process.env.CLIENT_URL;
        if (!CLIENT_URL)
            throw new Error("Missing env var: CLIENT_URL");
        const userRef = getUserRef(uid);
        const snap = await userRef.get();
        if (!snap.exists)
            return res.status(404).json({ success: false, error: "User not found" });
        const user = snap.data();
        // Trial eligibility
        const hasHadTrial = user?.billing?.hasHadTrial === true;
        const DEFAULT_TRIAL_DAYS = Number(process.env.STRIPE_STARTER_TRIAL_DAYS || "5");
        // Canonical plan (what your app stores as planId/pendingPlan)
        const canonicalPlan = plan === "pro" ? "pro" : "starter";
        // Trial logic: only when explicitly chosen AND not already used
        const useTrial = plan === "starter_trial" && !hasHadTrial;
        const trialDays = useTrial ? DEFAULT_TRIAL_DAYS : 0;
        // Ensure Stripe customer exists
        let customerId = user?.stripeCustomerId || user?.billing?.customerId;
        if (!customerId) {
            const customer = await stripe_1.stripe.customers.create({
                email: user?.email,
                name: user?.displayName,
                metadata: { userId: uid },
            });
            customerId = customer.id;
            await userRef.set({
                stripeCustomerId: customerId,
                billing: {
                    provider: "stripe",
                    customerId,
                    updatedAt: Date.now(),
                },
            }, { merge: true });
        }
        // Set pendingPlan to canonical plan only
        await userRef.set({ pendingPlan: canonicalPlan }, { merge: true });
        // Create Checkout Session
        const subscription_data = {
            metadata: {
                userId: uid,
                plan: canonicalPlan, // canonical
                planVariant: plan, // "starter_paid" | "starter_trial" | "pro"
            },
            ...(useTrial ? { trial_period_days: trialDays } : {}),
            // Optional safety: cancel if no payment method by trial end
            ...(useTrial
                ? { trial_settings: { end_behavior: { missing_payment_method: "cancel" } } }
                : {}),
        };
        const session = await stripe_1.stripe.checkout.sessions.create({
            mode: "subscription",
            customer: customerId,
            line_items: [{ price: priceIdFor(canonicalPlan), quantity: 1 }],
            success_url: `${CLIENT_URL}/billing/success`,
            cancel_url: `${CLIENT_URL}/billing/canceled`,
            metadata: {
                userId: uid,
                plan: canonicalPlan,
                planVariant: plan,
            },
            subscription_data,
        });
        return res.json({ success: true, url: session.url });
    }
    catch (err) {
        console.error("POST /api/billing/checkout failed:", err?.message || err);
        return res.status(500).json({ success: false, error: err?.message || "Server error" });
    }
});
router.post("/portal", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid)
            return res.status(401).json({ success: false, error: "Unauthorized" });
        const snap = await getUserRef(uid).get();
        if (!snap.exists)
            return res.status(404).json({ success: false, error: "User not found" });
        const user = snap.data();
        const customerId = user?.stripeCustomerId || user?.billing?.customerId;
        if (!customerId)
            return res.status(400).json({ success: false, error: "No Stripe customer" });
        const CLIENT_URL = process.env.CLIENT_URL;
        if (!CLIENT_URL)
            throw new Error("Missing env var: CLIENT_URL");
        const portal = await stripe_1.stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${CLIENT_URL}/settings/billing`,
        });
        return res.json({ success: true, url: portal.url });
    }
    catch (err) {
        console.error("POST /api/billing/portal failed:", err?.message || err);
        return res.status(500).json({ success: false, error: err?.message || "Server error" });
    }
});
// Allow clients to clear a stale pendingPlan (e.g., user canceled checkout)
router.post("/clear-pending", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid)
            return res.status(401).json({ success: false, error: "Unauthorized" });
        await getUserRef(uid).set({ pendingPlan: null }, { merge: true });
        return res.json({ success: true });
    }
    catch (err) {
        console.error("POST /api/billing/clear-pending failed:", err?.message || err);
        return res.status(500).json({ success: false, error: err?.message || "Server error" });
    }
});
router.get("/me", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid)
            return res.status(401).json({ error: "Unauthorized" });
        const snap = await getUserRef(uid).get();
        if (!snap.exists)
            return res.status(404).json({ error: "User not found" });
        return res.json({ id: uid, ...snap.data() });
    }
    catch (err) {
        console.error("GET /api/billing/me failed:", err?.message || err);
        return res.status(500).json({ error: "Failed to load user" });
    }
});
// Safely check if a subscription change is scheduled
// Returns: { scheduledChange, effectiveDate, hasSubscription, status, cancelAtPeriodEnd, billingActive }
router.get("/pending-change", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid)
            return res.status(401).json({ error: "Unauthorized" });
        const snap = await getUserRef(uid).get();
        if (!snap.exists)
            return res.status(404).json({ error: "User not found" });
        const user = snap.data();
        const subscriptionId = user?.billing?.subscriptionId || user?.stripeSubscriptionId;
        const hasSubscription = !!subscriptionId;
        const billingActive = !!(user?.billingStatus === "active" || user?.billingStatus === "trialing");
        if (!subscriptionId) {
            return res.json({
                scheduledChange: false,
                effectiveDate: null,
                hasSubscription,
                status: user?.billingStatus || "none",
                cancelAtPeriodEnd: false,
                billingActive,
            });
        }
        const sub = await stripe_1.stripe.subscriptions.retrieve(subscriptionId);
        const cancelAtPeriodEnd = !!sub.cancel_at_period_end;
        const status = sub.status;
        const currentPeriodEnd = sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null;
        let scheduledChange = false;
        let effectiveDate = null;
        // If set to cancel at period end, consider that a scheduled change
        if (cancelAtPeriodEnd) {
            scheduledChange = true;
            effectiveDate = currentPeriodEnd;
        }
        // If there is a schedule attached, treat it as scheduled
        if (!scheduledChange) {
            const scheduleId = sub.schedule || sub.subscription_schedule;
            if (scheduleId) {
                scheduledChange = true;
                // Best-effort: try to read schedule
                try {
                    const schedule = await stripe_1.stripe.subscriptionSchedules.retrieve(String(scheduleId));
                    const phases = (schedule.phases || []);
                    const last = phases[phases.length - 1];
                    if (last?.end_date) {
                        effectiveDate = new Date(last.end_date * 1000).toISOString();
                    }
                }
                catch { }
            }
        }
        // Some accounts expose pending_update
        if (!scheduledChange && sub.pending_update) {
            scheduledChange = true;
            effectiveDate = currentPeriodEnd;
        }
        return res.json({
            scheduledChange,
            effectiveDate,
            hasSubscription,
            status,
            cancelAtPeriodEnd,
            billingActive,
        });
    }
    catch (err) {
        console.error("GET /api/billing/pending-change failed:", err?.message || err);
        return res.status(500).json({ error: "Server error" });
    }
});
exports.default = router;
