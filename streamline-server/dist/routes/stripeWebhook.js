"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const stripe_1 = __importDefault(require("stripe"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-12-15.clover",
});
console.log("⚡ Stripe webhook hit");
const router = express_1.default.Router();
router.get("/ping", (req, res) => res.status(200).json({ ok: true }));
// IMPORTANT: raw body only
router.post("/webhook", express_1.default.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    }
    catch (err) {
        console.error("Stripe signature failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const planId = session.metadata?.planId;
        if (!userId || !planId) {
            console.error("Missing metadata on checkout session");
            return res.status(400).json({ error: "Missing metadata" });
        }
        await firebaseAdmin_1.firestore.collection("users").doc(userId).set({
            planId,
            pendingPlan: null,
            billingActive: true,
            billingStatus: "active",
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            updatedAt: Date.now(),
        }, { merge: true });
    }
    res.json({ received: true });
});
exports.default = router;
