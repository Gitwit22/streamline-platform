"use strict";
/**
 * StreamLine Webhooks
 *
 * Handles:
 * - Stripe billing webhooks
 * - LiveKit egress webhooks (egress_ended → mark recording ready)
 *
 * Routes:
 * - POST /api/webhooks/stripe
 * - POST /api/webhooks/livekit
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const stripe_1 = require("../lib/stripe");
const client_s3_1 = require("@aws-sdk/client-s3");
const router = express_1.default.Router();
// =============================================================================
// ENVIRONMENT & CONFIG
// =============================================================================
function mustGetEnv(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing env var: ${name}`);
    return v;
}
function getUserRef(uid) {
    return firebaseAdmin_1.firestore.collection("users").doc(uid);
}
function getR2Config() {
    const bucket = mustGetEnv("R2_BUCKET");
    const accessKeyId = mustGetEnv("R2_ACCESS_KEY_ID");
    const secretAccessKey = mustGetEnv("R2_SECRET_ACCESS_KEY");
    const accountId = process.env.R2_ACCOUNT_ID;
    const endpoint = accountId
        ? `https://${accountId}.r2.cloudflarestorage.com`
        : mustGetEnv("R2_ENDPOINT");
    return { bucket, accessKeyId, secretAccessKey, endpoint };
}
// Lazy S3 client for R2
let _s3Client = null;
function getS3Client() {
    if (_s3Client)
        return _s3Client;
    const cfg = getR2Config();
    _s3Client = new client_s3_1.S3Client({
        region: "auto",
        endpoint: cfg.endpoint,
        credentials: {
            accessKeyId: cfg.accessKeyId,
            secretAccessKey: cfg.secretAccessKey,
        },
        forcePathStyle: true,
    });
    return _s3Client;
}
/**
 * HEAD check on R2 to verify object exists and get size
 */
async function r2HeadObjectSize(key) {
    try {
        const cfg = getR2Config();
        const client = getS3Client();
        const resp = await client.send(new client_s3_1.HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
        return typeof resp.ContentLength === "number" ? resp.ContentLength : 0;
    }
    catch (err) {
        if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
            return 0;
        }
        console.error(`[r2] HEAD error for ${key}:`, err?.message);
        return 0;
    }
}
// =============================================================================
// STRIPE HELPERS
// =============================================================================
function planIdFromPrice(priceId) {
    if (!priceId)
        return "free";
    if (priceId === process.env.STRIPE_PRICE_STARTER)
        return "starter";
    if (priceId === process.env.STRIPE_PRICE_PRO)
        return "pro";
    return "free";
}
function sanitizeHistory(history) {
    if (!Array.isArray(history))
        return [];
    return history
        .map((entry) => ({
        at: Number(entry?.at || 0),
        fromPlan: String(entry?.fromPlan || "unknown"),
        toPlan: String(entry?.toPlan || "unknown"),
        source: String(entry?.source || "unknown"),
    }))
        .filter((entry) => Number.isFinite(entry.at) && entry.at > 0)
        .sort((a, b) => a.at - b.at)
        .slice(-10);
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
// =============================================================================
// LIVEKIT HELPERS
// =============================================================================
/**
 * Extract object key from various LiveKit egress response shapes
 */
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
// =============================================================================
// STRIPE WEBHOOK
// POST /api/webhooks/stripe
// =============================================================================
router.post("/stripe", express_1.default.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    if (!sig)
        return res.status(400).send("Missing stripe-signature");
    let event;
    try {
        event = stripe_1.stripe.webhooks.constructEvent(req.body, String(sig), mustGetEnv("STRIPE_WEBHOOK_SECRET"));
    }
    catch (err) {
        console.error("[stripe] Webhook signature error:", err?.message);
        return res.status(400).send(`Webhook Error: ${err?.message || "Bad signature"}`);
    }
    try {
        switch (event.type) {
            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "invoice.paid":
            case "customer.subscription.deleted": {
                const sub = event.data.object;
                const uid = sub?.metadata?.userId;
                if (!uid)
                    break;
                let subscription = sub;
                if (event.type === "invoice.paid" && sub.subscription) {
                    subscription = await stripe_1.stripe.subscriptions.retrieve(sub.subscription);
                }
                const planVariant = subscription?.metadata?.planVariant;
                const canonicalPlan = planVariant === "pro" ? "pro" : "starter";
                const isActive = subscription.status === "active" || subscription.status === "trialing";
                const userSnap = await getUserRef(uid).get();
                const user = userSnap.exists ? userSnap.data() : {};
                const currentPlan = user?.planId || "free";
                const now = Date.now();
                const history = sanitizeHistory(user?.planChangeHistory);
                const nextHistory = currentPlan === canonicalPlan
                    ? history
                    : [...history, { at: now, fromPlan: currentPlan, toPlan: canonicalPlan, source: "stripe_webhook" }].slice(-10);
                await getUserRef(uid).set({
                    planId: canonicalPlan,
                    pendingPlan: null,
                    planChangeHistory: nextHistory,
                    planChangeCooldownUntil: null,
                    planChangeLock: null,
                    planChangeRequestId: null,
                    planChangeRequestResult: null,
                    billingActive: isActive,
                    billingStatus: subscription.status,
                    billing: {
                        ...(user.billing || {}),
                        provider: "stripe",
                        customerId: subscription.customer ?? null,
                        subscriptionId: subscription.id ?? null,
                        priceId: subscription.items?.data?.[0]?.price?.id ?? null,
                        cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
                        currentPeriodEnd: typeof subscription.current_period_end === "number"
                            ? subscription.current_period_end * 1000
                            : null,
                        hasHadTrial: user.billing?.hasHadTrial === true ||
                            planVariant === "starter_trial",
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
                    console.warn("[stripe] checkout.session.completed missing userId");
                    break;
                }
                const customerId = typeof session.customer === "string" ? session.customer : null;
                const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
                if (!subscriptionId) {
                    console.warn("[stripe] Checkout completed without subscriptionId");
                    break;
                }
                const sub = await stripe_1.stripe.subscriptions.retrieve(subscriptionId);
                const priceId = sub.items.data?.[0]?.price?.id;
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
                const currentPeriodEndSec = sub.current_period_end;
                const currentPeriodEnd = typeof currentPeriodEndSec === "number"
                    ? currentPeriodEndSec * 1000
                    : null;
                const setHasHadTrial = planVariant === "starter_trial" ? { hasHadTrial: true } : {};
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
                console.log("[stripe] Billing written from checkout.session.completed", {
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
                const userSnap = await getUserRef(userId).get();
                const user = userSnap.exists ? userSnap.data() : {};
                const now = Date.now();
                const history = sanitizeHistory(user?.planChangeHistory);
                const currentPlan = user?.planId || "free";
                const nextHistory = currentPlan === "free"
                    ? history
                    : [...history, { at: now, fromPlan: currentPlan, toPlan: "free", source: "stripe_webhook" }].slice(-10);
                await firebaseAdmin_1.firestore.collection("users").doc(userId).set({
                    planId: "free",
                    billingActive: false,
                    billingStatus: "past_due",
                    planChangeHistory: nextHistory,
                    planChangeCooldownUntil: null,
                    planChangeLock: null,
                    planChangeRequestId: null,
                    planChangeRequestResult: null,
                    billing: { updatedAt: Date.now() },
                }, { merge: true });
                break;
            }
            default:
                return res.status(200).json({ received: true });
        }
        return res.json({ received: true });
    }
    catch (err) {
        console.error("[stripe] Webhook handler failed:", err?.message);
        return res.status(500).send(err?.message || "Webhook handler failed");
    }
});
// =============================================================================
// LIVEKIT WEBHOOK
// POST /api/webhooks/livekit
//
// Deterministic Rules:
// 1. Only process "egress_ended" events (case-insensitive)
// 2. Lookup by egressId with retry on not found
// 3. Idempotent: if doc already "ready", exit early
// 4. Can transition from recording → ready (if stop wasn't called)
// 5. Mark ready ONLY if no error AND R2 HEAD returns ContentLength > 0
// =============================================================================
router.post("/livekit", express_1.default.raw({ type: "*/*" }), async (req, res) => {
    console.log("[livekit-webhook] Received request");
    try {
        const authHeader = String(req.headers["authorization"] || "");
        const rawBody = req.body;
        if (!Buffer.isBuffer(rawBody)) {
            console.error("[livekit-webhook] Expected raw body Buffer");
            return res.status(400).json({ ok: false, error: "Expected raw body Buffer" });
        }
        const LIVEKIT_API_KEY = mustGetEnv("LIVEKIT_API_KEY");
        const LIVEKIT_API_SECRET = mustGetEnv("LIVEKIT_API_SECRET");
        const { WebhookReceiver } = await import("livekit-server-sdk");
        const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
        let event;
        try {
            event = await receiver.receive(rawBody.toString("utf8"), authHeader);
        }
        catch (verifyErr) {
            console.error("[livekit-webhook] Signature verification failed:", verifyErr?.message);
            return res.status(401).json({ ok: false, error: "Invalid webhook signature" });
        }
        const eventName = String(event?.event || "").toLowerCase();
        const egressInfo = event?.egressInfo;
        console.log("[livekit-webhook] Event:", {
            event: eventName,
            egressId: egressInfo?.egressId,
            status: egressInfo?.status,
        });
        // =========================================================================
        // RULE: Only process "egress_ended" (case-insensitive)
        // =========================================================================
        if (eventName !== "egress_ended" && eventName !== "egress.ended") {
            console.log(`[livekit-webhook] Ignoring event: ${eventName}`);
            return res.status(200).json({ ok: true, ignored: true, event: eventName });
        }
        const egressId = String(egressInfo?.egressId || "");
        if (!egressId) {
            console.error("[livekit-webhook] CRITICAL: Missing egressId in egress_ended event");
            return res.status(400).json({ ok: false, error: "Missing egressId" });
        }
        // =========================================================================
        // DETERMINISTIC LOOKUP: recordings.where("egressId", "==", egressId).limit(1)
        // With retry on not found (doc might not be written yet)
        // =========================================================================
        async function findRecordingByEgressId(egressId, retryCount = 0) {
            const querySnap = await firebaseAdmin_1.firestore
                .collection("recordings")
                .where("egressId", "==", egressId)
                .limit(1)
                .get();
            if (!querySnap.empty) {
                return querySnap.docs[0];
            }
            // Retry once after 2 seconds if not found
            if (retryCount === 0) {
                console.warn(`[livekit-webhook] Recording not found for egressId: ${egressId}, retrying in 2s...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return findRecordingByEgressId(egressId, 1);
            }
            return null;
        }
        const recordingDoc = await findRecordingByEgressId(egressId);
        if (!recordingDoc) {
            console.error(`[livekit-webhook] CRITICAL: No recording found for egressId: ${egressId} after retry`);
            return res.status(404).json({ ok: false, error: "Recording not found for egressId" });
        }
        const recordingRef = recordingDoc.ref;
        const recordingData = recordingDoc.data() || {};
        const recordingId = recordingDoc.id;
        const currentStatus = recordingData.status;
        console.log(`[livekit-webhook] Found recording: ${recordingId}, current status: ${currentStatus}`);
        // =========================================================================
        // IDEMPOTENCY: If doc already "ready" or "failed", exit early
        // =========================================================================
        if (currentStatus === "ready") {
            console.log(`[livekit-webhook] Recording ${recordingId} already ready, skipping`);
            return res.status(200).json({ ok: true, alreadyReady: true, recordingId });
        }
        if (currentStatus === "failed") {
            console.log(`[livekit-webhook] Recording ${recordingId} already failed, skipping`);
            return res.status(200).json({ ok: true, alreadyFailed: true, recordingId });
        }
        // =========================================================================
        // EXTRACT OBJECT KEY - Compare egress response vs stored
        // =========================================================================
        const objectKeyFromEgress = extractObjectKey(egressInfo);
        const objectKeyFromDb = recordingData.objectKey;
        console.log(`[livekit-webhook] ObjectKey comparison:`, {
            fromEgress: objectKeyFromEgress || "(not in response)",
            fromDb: objectKeyFromDb || "(not in db)",
            match: objectKeyFromEgress === objectKeyFromDb ? "✓" : "⚠️ MISMATCH",
        });
        // Prefer egress response (actual upload path), fallback to db
        const objectKey = objectKeyFromEgress || objectKeyFromDb;
        if (!objectKey) {
            console.error(`[livekit-webhook] No objectKey for recording ${recordingId}`);
            await recordingRef.update({
                status: "failed",
                errorMessage: "No file path in egress response or database",
                livekitStatus: String(egressInfo?.status || "UNKNOWN"),
                updatedAt: new Date(),
                endedAt: new Date(),
            });
            return res.status(400).json({ ok: false, error: "No objectKey" });
        }
        // =========================================================================
        // READY GATING: Check for errors AND verify file exists in R2
        // =========================================================================
        const egressStatus = String(egressInfo?.status || "").toUpperCase();
        const egressError = egressInfo?.error || egressInfo?.errorMessage;
        const now = new Date();
        let finalStatus;
        let downloadReady = false;
        let fileSize = null;
        let errorMessage = null;
        // Check for egress error first
        if (egressError) {
            finalStatus = "failed";
            errorMessage = `Egress error: ${egressError}`;
            console.error(`[livekit-webhook] Egress error for ${recordingId}:`, egressError);
        }
        // Check egress status indicates completion
        else if (egressStatus === "EGRESS_COMPLETE" || egressStatus === "COMPLETE") {
            // READY GATING: R2 HEAD check - ContentLength > 0
            console.log(`[livekit-webhook] Verifying file in R2: ${objectKey}`);
            fileSize = await r2HeadObjectSize(objectKey);
            if (fileSize > 0) {
                finalStatus = "ready";
                downloadReady = true;
                console.log(`[livekit-webhook] ✅ File confirmed: ${objectKey} (${fileSize} bytes)`);
            }
            else {
                finalStatus = "failed";
                errorMessage = "File not found in R2 storage after egress completed";
                console.error(`[livekit-webhook] ❌ File NOT found in R2: ${objectKey}`);
            }
        }
        // Egress failed
        else if (egressStatus === "EGRESS_FAILED" || egressStatus === "FAILED") {
            finalStatus = "failed";
            errorMessage = `Egress failed with status: ${egressStatus}`;
            console.error(`[livekit-webhook] Egress failed for ${recordingId}: ${egressStatus}`);
        }
        // Unknown status - keep processing (don't mark failed yet)
        else {
            finalStatus = "processing";
            console.warn(`[livekit-webhook] Unknown egress status: ${egressStatus}, keeping as processing`);
        }
        // =========================================================================
        // UPDATE RECORDING DOC
        // Can transition from: starting, recording, or processing → ready/failed
        // =========================================================================
        const rawToken = crypto_1.default.randomBytes(32).toString("hex");
        const hashedToken = crypto_1.default.createHash("sha256").update(rawToken).digest("hex");
        const updates = {
            status: finalStatus,
            downloadReady,
            objectKey, // Update with actual egress path if different
            downloadPath: objectKey,
            fileSize,
            livekitStatus: egressStatus,
            oneTimeToken: hashedToken,
            updatedAt: now,
            endedAt: now,
        };
        if (finalStatus === "ready") {
            updates.readyAt = now;
        }
        if (errorMessage) {
            updates.errorMessage = errorMessage;
        }
        await recordingRef.update(updates);
        console.log(`[livekit-webhook] Recording ${recordingId} updated: ${currentStatus} → ${finalStatus}`, {
            downloadReady,
            fileSize,
        });
        return res.status(200).json({
            ok: true,
            recordingId,
            status: finalStatus,
            previousStatus: currentStatus,
            downloadReady,
            fileSize,
        });
    }
    catch (err) {
        console.error("[livekit-webhook] Error:", err?.message, err?.stack?.slice(0, 500));
        return res.status(500).json({ ok: false, error: err?.message || "Webhook error" });
    }
});
exports.default = router;
