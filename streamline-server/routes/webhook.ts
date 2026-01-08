
import express from "express";
import crypto from "crypto";
import Stripe from "stripe";
import { firestore as db } from "../firebaseAdmin";
import { stripe } from "../lib/stripe";

function getUserRef(uid: string) {
  return db.collection("users").doc(uid);
}

const router = express.Router();

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Try multiple shapes LiveKit might send
function extractObjectKey(egressInfo: any): string | null {
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

function planIdFromPrice(priceId?: string) {
  if (!priceId) return "free";
  if (priceId === process.env.STRIPE_PRICE_STARTER) return "starter";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  return "free";
}

function mapBillingStatus(status: string) {
  if (status === "active" || status === "trialing") return status;
  if (status === "past_due") return "past_due";
  if (status === "unpaid") return "unpaid";
  if (status === "canceled") return "canceled";
  return "past_due";
}

/**
 * STRIPE WEBHOOK
 * POST /api/webhooks/stripe
 * MUST use express.raw() and be mounted before express.json()
 */
router.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    if (!sig) return res.status(400).send("Missing stripe-signature");

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        String(sig),
        mustGetEnv("STRIPE_WEBHOOK_SECRET")
      );
    } catch (err: any) {
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
          const sub: any = event.data.object;
          const uid = sub?.metadata?.userId;
          if (!uid) break;
          // For invoice.paid, fetch the subscription object
          let subscription = sub;
          if (event.type === "invoice.paid" && sub.subscription) {
            subscription = await stripe.subscriptions.retrieve(sub.subscription);
          }
          const planVariant = subscription?.metadata?.planVariant;
          const canonicalPlan = planVariant === "pro" ? "pro" : "starter";
          const isActive = subscription.status === "active" || subscription.status === "trialing";
          // Fetch user for hasHadTrial logic
          const userSnap = await getUserRef(uid).get();
          const user = userSnap.exists ? userSnap.data() : {};
          await getUserRef(uid).set(
            {
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
                hasHadTrial:
                  (user.billing?.hasHadTrial === true) || planVariant === "starter_trial",
                updatedAt: Date.now(),
              },
              updatedAt: Date.now(),
            },
            { merge: true }
          );
          break;
        }

        case "checkout.session.completed": {
  const session = event.data.object as Stripe.Checkout.Session;

  const uid = session.metadata?.userId;
  if (!uid) {
    console.warn("checkout.session.completed missing userId");
    break;
  }

  const customerId =
    typeof session.customer === "string" ? session.customer : null;

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : null;

  if (!subscriptionId) {
    console.warn("Checkout completed without subscriptionId");
    break;
  }

  // Pull subscription to get price + status
  const sub = await stripe.subscriptions.retrieve(subscriptionId);

  // This usually types fine without any:
  const priceId = sub.items.data?.[0]?.price?.id;

  // Always read planVariant from metadata (not plan)
  let planId = planIdFromPrice(priceId);
  const planVariant = sub?.metadata?.planVariant;
  if (planVariant === "starter_trial" || planVariant === "starter_paid") {
    planId = "starter";
  } else if (planVariant === "pro") {
    planId = "pro";
  }
  const billingStatus = mapBillingStatus(sub.status);
  const billingActive = billingStatus === "active" || billingStatus === "trialing";

  // Stripe returns seconds; store ms
  const currentPeriodEndSec = (sub as any).current_period_end as number | undefined;
  const currentPeriodEnd =
    typeof currentPeriodEndSec === "number" ? currentPeriodEndSec * 1000 : null;

  // If planVariant is starter_trial, set hasHadTrial = true (robust against missed status)
  const setHasHadTrial = (planVariant === "starter_trial") ? { hasHadTrial: true } : {};
  await getUserRef(uid).set(
    {
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
    },
    { merge: true }
  );

  console.log("✅ Billing written from checkout.session.completed", {
    uid,
    planId,
    billingStatus,
  });

  break;
}


        case "invoice.payment_failed": {
          const invoice: any = event.data.object;
          const subId = invoice?.subscription as string | undefined;
          if (!subId) break;

          const sub = await stripe.subscriptions.retrieve(subId);
          const userId = (sub as any)?.metadata?.userId;
          if (!userId) break;

          // STRICT BLOCK immediately
          await db.collection("users").doc(userId).set(
            {
              planId: "free",
              billingActive: false,
              billingStatus: "past_due",
              billing: { updatedAt: Date.now() },
            },
            { merge: true }
          );
          break;
        }

        default:
          // Ignore unknown/unhandled event types but still acknowledge with 200
          return res.status(200).json({ received: true });
      }

      return res.json({ received: true });
    } catch (err: any) {
      console.error("Stripe webhook handler failed:", err?.message || err);
      return res.status(500).send(err?.message || "Webhook handler failed");
    }
  }
);

/**
 * LIVEKIT WEBHOOK
 * POST /api/webhooks/livekit
 * MUST receive raw body (Buffer)
 */
router.post("/livekit", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const authHeader = String(req.headers["authorization"] || "");
    const rawBody = req.body as Buffer;

    if (!Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ ok: false, error: "Expected raw body Buffer" });
    }

    const LIVEKIT_API_KEY = mustGetEnv("LIVEKIT_API_KEY");
    const LIVEKIT_API_SECRET = mustGetEnv("LIVEKIT_API_SECRET");

    const { WebhookReceiver } = await import("livekit-server-sdk");
    const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

    const event = await receiver.receive(rawBody.toString("utf8"), authHeader);

    const eventName = String((event as any)?.event || "");
    const egressInfo = (event as any)?.egressInfo;

    const isEgressEnded = eventName === "egress_ended" || eventName === "egress.ended";
    if (!isEgressEnded) {
      return res.status(200).json({ ok: true, ignored: true, event: eventName });
    }

    const recordingId = String(egressInfo?.egressId || "");
    if (!recordingId) {
      return res.status(400).json({ ok: false, error: "Missing egressId" });
    }

    let objectKey = extractObjectKey(egressInfo);

    const ref = db.collection("recordings").doc(recordingId);
    const snap = await ref.get();
    const existing = snap.exists ? (snap.data() as any) : null;

    if (!objectKey && existing?.filepath) {
      objectKey = existing.filepath;
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    const egressStatus = String(egressInfo?.status || "").toUpperCase();
    let finalStatus = "PROCESSING";
    if (egressStatus === "COMPLETE" && objectKey) finalStatus = "READY";
    else if (!objectKey) finalStatus = "FAILED";

    await ref.set(
      {
        objectKey: objectKey ?? null,
        oneTimeToken: hashedToken,
        status: finalStatus,
        updatedAt: new Date(),
        endedAt: new Date(),
        livekitStatus: egressStatus,
      },
      { merge: true }
    );

    return res.status(200).json({ ok: true, testDownloadUrl: `/api/recordings/${recordingId}/download?token=${rawToken}` });
  } catch (err: any) {
    console.error("LiveKit webhook error:", err?.message || err);
    return res.status(400).json({ ok: false, error: err?.message || "Webhook error" });
  }
});

export default router;
