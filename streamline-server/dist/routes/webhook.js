"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const stripe_1 = require("../lib/stripe");
function getUserRef(uid) {
    return firebaseAdmin_1.firestore.collection("users").doc(uid);
}
const router = express_1.default.Router();
function mustGetEnv(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing env var: ${name}`);
    return v;
}
// Try multiple shapes LiveKit might send
function extractObjectKey(egressInfo) {
    const candidates = [
        egressInfo?.file?.filepath,
        egressInfo?.file?.results?.[0]?.filename,
        egressInfo?.file?.results?.[0]?.location,
        egressInfo?.fileResults?.[0]?.filepath,
        egressInfo?.fileResults?.[0]?.filename,
        egressInfo?.fileResults?.[0]?.location,
        egressInfo?.result?.filename,
        egressInfo?.result?.location,
        egressInfo?.outputs?.[0]?.filename,
        egressInfo?.outputs?.[0]?.location,
    ];
    const hit = candidates.find((x) => typeof x === "string" && x.length > 0);
    return hit ?? null;
}
function planIdFromPrice(priceId) {
    if (!priceId)
        return "free";
    if (priceId === process.env.STRIPE_PRICE_STARTER)
        return "starter";
    if (priceId === process.env.STRIPE_PRICE_PRO)
        return "pro";
    return "free";
}
function mapBillingStatus(status) {
    if (status === "active" || status === "trialing")
        return status;
    if (status === "past_due")
        return "past_due";
    if (status === "unpaid")
        return "unpaid";
    if (status === "canceled")
        return "canceled";
    return "past_due";
}
/**
 * STRIPE WEBHOOK
 * POST /api/webhooks/stripe
 * MUST use express.raw() and be mounted before express.json()
 */
router.post("/stripe", express_1.default.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    if (!sig)
        return res.status(400).send("Missing stripe-signature");
    let event;
    try {
        event = stripe_1.stripe.webhooks.constructEvent(req.body, String(sig), mustGetEnv("STRIPE_WEBHOOK_SECRET"));
    }
    catch (err) {
        console.error("Stripe webhook signature error:", err?.message || err);
        return res.status(400).send(`Webhook Error: ${err?.message || "Bad signature"}`);
    }
    try {
        switch (event.type) {
            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "invoice.paid":
            case "customer.subscription.deleted": {
                // Cast to any to avoid Stripe type mismatch issues
                // Canonical reconciliation block for all subscription-valid events
                const sub = event.data.object;
                const uid = sub?.metadata?.userId;
                if (!uid)
                    break;
                // For invoice.paid, fetch the subscription object
                let subscription = sub;
                if (event.type === "invoice.paid" && sub.subscription) {
                    subscription = await stripe_1.stripe.subscriptions.retrieve(sub.subscription);
                }
                const planVariant = subscription?.metadata?.planVariant;
                const canonicalPlan = planVariant === "pro" ? "pro" : "starter";
                const isActive = subscription.status === "active" || subscription.status === "trialing";
                // Fetch user for hasHadTrial logic
                const userSnap = await getUserRef(uid).get();
                const user = userSnap.exists ? userSnap.data() : {};
                await getUserRef(uid).set({
                    planId: canonicalPlan,
                    pendingPlan: null, // CRITICAL
                    billingActive: isActive,
                    billingStatus: subscription.status,
                    billing: {
                        ...(user.billing || {}),
                        provider: "stripe",
                        customerId: subscription.customer ?? null,
                        subscriptionId: subscription.id ?? null,
                        priceId: subscription.items?.data?.[0]?.price?.id ?? null,
                        cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
                        currentPeriodEnd: typeof subscription.current_period_end === "number" ? subscription.current_period_end * 1000 : null,
                        hasHadTrial: (user.billing?.hasHadTrial === true) || planVariant === "starter_trial",
                        updatedAt: Date.now(),
                    },
                    updatedAt: Date.now(),
                }, { merge: true });
                break;
            }
            case "checkout.session.completed": {
                const session = event.data.object;
                const uid = session.metadata?.userId;
                if (!uid) {
                    console.warn("checkout.session.completed missing userId");
                    break;
                }
                const customerId = typeof session.customer === "string" ? session.customer : null;
                const subscriptionId = typeof session.subscription === "string"
                    ? session.subscription
                    : null;
                if (!subscriptionId) {
                    console.warn("Checkout completed without subscriptionId");
                    break;
                }
                // Pull subscription to get price + status
                const sub = await stripe_1.stripe.subscriptions.retrieve(subscriptionId);
                // This usually types fine without any:
                const priceId = sub.items.data?.[0]?.price?.id;
                // Always read planVariant from metadata (not plan)
                let planId = planIdFromPrice(priceId);
                const planVariant = sub?.metadata?.planVariant;
                if (planVariant === "starter_trial" || planVariant === "starter_paid") {
                    planId = "starter";
                }
                else if (planVariant === "pro") {
                    planId = "pro";
                }
                const billingStatus = mapBillingStatus(sub.status);
                const billingActive = billingStatus === "active" || billingStatus === "trialing";
                // Stripe returns seconds; store ms
                const currentPeriodEndSec = sub.current_period_end;
                const currentPeriodEnd = typeof currentPeriodEndSec === "number" ? currentPeriodEndSec * 1000 : null;
                // If planVariant is starter_trial, set hasHadTrial = true (robust against missed status)
                const setHasHadTrial = (planVariant === "starter_trial") ? { hasHadTrial: true } : {};
                await getUserRef(uid).set({
                    planId: billingActive ? planId : "free",
                    billingActive,
                    billingStatus,
                    billing: {
                        provider: "stripe",
                        customerId: customerId ?? sub.customer,
                        subscriptionId: sub.id,
                        priceId,
                        cancelAtPeriodEnd: sub.cancel_at_period_end,
                        currentPeriodEnd,
                        updatedAt: Date.now(),
                        ...setHasHadTrial,
                    },
                    ...(planVariant === "starter_trial" ? { hasHadTrial: true } : {}),
                }, { merge: true });
                console.log("✅ Billing written from checkout.session.completed", {
                    uid,
                    planId,
                    billingStatus,
                });
                break;
            }
            case "invoice.payment_failed": {
                const invoice = event.data.object;
                const subId = invoice?.subscription;
                if (!subId)
                    break;
                const sub = await stripe_1.stripe.subscriptions.retrieve(subId);
                const userId = sub?.metadata?.userId;
                if (!userId)
                    break;
                // STRICT BLOCK immediately
                await firebaseAdmin_1.firestore.collection("users").doc(userId).set({
                    planId: "free",
                    billingActive: false,
                    billingStatus: "past_due",
                    billing: { updatedAt: Date.now() },
                }, { merge: true });
                break;
            }
            default:
                // Ignore unknown/unhandled event types but still acknowledge with 200
                return res.status(200).json({ received: true });
        }
        return res.json({ received: true });
    }
    catch (err) {
        console.error("Stripe webhook handler failed:", err?.message || err);
        return res.status(500).send(err?.message || "Webhook handler failed");
    }
});
/**
 * LIVEKIT WEBHOOK
 * POST /api/webhooks/livekit
 * MUST receive raw body (Buffer)
 */
router.post("/livekit", express_1.default.raw({ type: "*/*" }), async (req, res) => {
    try {
        const authHeader = String(req.headers["authorization"] || "");
        const rawBody = req.body;
        if (!Buffer.isBuffer(rawBody)) {
            return res.status(400).json({ ok: false, error: "Expected raw body Buffer" });
        }
        const LIVEKIT_API_KEY = mustGetEnv("LIVEKIT_API_KEY");
        const LIVEKIT_API_SECRET = mustGetEnv("LIVEKIT_API_SECRET");
        const { WebhookReceiver } = await import("livekit-server-sdk");
        const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
        const event = await receiver.receive(rawBody.toString("utf8"), authHeader);
        const eventName = String(event?.event || "");
        const egressInfo = event?.egressInfo;
        const isEgressEnded = eventName === "egress_ended" || eventName === "egress.ended";
        if (!isEgressEnded) {
            return res.status(200).json({ ok: true, ignored: true, event: eventName });
        }
        const recordingId = String(egressInfo?.egressId || "");
        if (!recordingId) {
            return res.status(400).json({ ok: false, error: "Missing egressId" });
        }
        let objectKey = extractObjectKey(egressInfo);
        const ref = firebaseAdmin_1.firestore.collection("recordings").doc(recordingId);
        const snap = await ref.get();
        const existing = snap.exists ? snap.data() : null;
        if (!objectKey && existing?.filepath) {
            objectKey = existing.filepath;
        }
        const rawToken = crypto_1.default.randomBytes(32).toString("hex");
        const hashedToken = crypto_1.default.createHash("sha256").update(rawToken).digest("hex");
        const egressStatus = String(egressInfo?.status || "").toUpperCase();
        let finalStatus = "PROCESSING";
        if (egressStatus === "COMPLETE" && objectKey)
            finalStatus = "READY";
        else if (!objectKey)
            finalStatus = "FAILED";
        await ref.set({
            objectKey: objectKey ?? null,
            oneTimeToken: hashedToken,
            status: finalStatus,
            updatedAt: new Date(),
            endedAt: new Date(),
            livekitStatus: egressStatus,
        }, { merge: true });
        return res.status(200).json({ ok: true, testDownloadUrl: `/api/recordings/${recordingId}/download?token=${rawToken}` });
    }
    catch (err) {
        console.error("LiveKit webhook error:", err?.message || err);
        return res.status(400).json({ ok: false, error: err?.message || "Webhook error" });
    }
});
exports.default = router;
