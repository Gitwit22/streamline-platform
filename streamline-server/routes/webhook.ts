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

import express from "express";
import crypto from "crypto";
import { deletePrefix } from "../lib/storageClient";
import { setHlsIdle } from "../services/rooms";
import Stripe from "stripe";
import { firestore as db } from "../firebaseAdmin";
import { stripe } from "../lib/stripe";
import { getCurrentMonthKey } from "../lib/usageTracker";
import { FieldValue } from "firebase-admin/firestore";
import {
  S3Client,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

const router = express.Router();

// =============================================================================
// ENVIRONMENT & CONFIG
// =============================================================================

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getUserRef(uid: string) {
  return db.collection("users").doc(uid);
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

function toNumber(value: any): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function coerceDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") {
    try {
      const d = value.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function computeBilledMinutes(start: Date | null, end: Date): number {
  if (!start) return 0;
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  if (!durationMs) return 0;
  return Math.max(1, Math.ceil(durationMs / 60_000));
}

async function incrementTranscodeMinutes(params: {
  uid: string;
  billedMinutes: number;
  now: Date;
}): Promise<void> {
  const safeMinutes = Math.max(0, Math.round(params.billedMinutes));
  if (!params.uid || safeMinutes <= 0) return;

  const monthKey = getCurrentMonthKey();
  const usageDocId = `${params.uid}_${monthKey}`;
  const usageRef = db.collection("usageMonthly").doc(usageDocId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(usageRef);
    const existing = snap.exists ? (snap.data() as any) : {};
    const usage = existing.usage || {};
    const ytd = existing.ytd || {};
    const minutes = usage.minutes || {};
    const ytdMinutes = ytd.minutes || {};

    const prevCurrent = toNumber(minutes.transcode?.currentPeriod ?? usage.transcodeMinutes);
    const prevLifetime = toNumber(minutes.transcode?.lifetime ?? ytdMinutes.transcode?.lifetime ?? ytd.transcodeMinutes);

    const nextCurrent = prevCurrent + safeMinutes;
    const nextLifetime = prevLifetime + safeMinutes;

    tx.set(
      usageRef,
      {
        uid: params.uid,
        monthKey,
        usage: {
          ...usage,
          transcodeMinutes: toNumber(usage.transcodeMinutes) + safeMinutes,
          minutes: {
            ...minutes,
            transcode: {
              currentPeriod: nextCurrent,
              lifetime: nextLifetime,
            },
          },
        },
        ytd: {
          ...ytd,
          transcodeMinutes: toNumber(ytd.transcodeMinutes) + safeMinutes,
          minutes: {
            ...ytdMinutes,
            transcode: {
              lifetime: nextLifetime,
            },
          },
        },
        createdAt: existing.createdAt || params.now,
        updatedAt: params.now,
      },
      { merge: true }
    );
  });
}

async function incrementHlsMinutes(params: {
  uid: string;
  billedMinutes: number;
  now: Date;
}): Promise<void> {
  const safeMinutes = Math.max(0, Math.round(params.billedMinutes));
  if (!params.uid || safeMinutes <= 0) return;

  const monthKey = getCurrentMonthKey();
  const usageDocId = `${params.uid}_${monthKey}`;
  const usageRef = db.collection("usageMonthly").doc(usageDocId);
  const snap = await usageRef.get();
  const existing = snap.exists ? (snap.data() as any) : {};
  const prevUsage = existing.usage || {};
  const prevYtd = existing.ytd || {};

  await usageRef.set(
    {
      uid: params.uid,
      monthKey,
      usage: {
        ...prevUsage,
        hlsMinutes: toNumber(prevUsage.hlsMinutes) + safeMinutes,
        // HLS is billed as transcode/egress time.
        transcodeMinutes: toNumber(prevUsage.transcodeMinutes) + safeMinutes,
      },
      ytd: {
        ...prevYtd,
        hlsMinutes: toNumber(prevYtd.hlsMinutes) + safeMinutes,
        transcodeMinutes: toNumber(prevYtd.transcodeMinutes) + safeMinutes,
      },
      createdAt: existing.createdAt || params.now,
      updatedAt: params.now,
    },
    { merge: true }
  );
}

async function maybeCountRecordingUsage(params: {
  recordingRef: FirebaseFirestore.DocumentReference;
  recordingData: any;
  now: Date;
}): Promise<{ counted: boolean; billedMinutes: number }>{
  const uid = String(params.recordingData?.uid || "").trim();
  if (!uid) return { counted: false, billedMinutes: 0 };

  const startedAt = coerceDate(params.recordingData?.startedAt);
  const billedMinutes = computeBilledMinutes(startedAt, params.now);
  if (billedMinutes <= 0) return { counted: false, billedMinutes: 0 };

  const usageType = typeof params.recordingData?.usageType === "string" ? params.recordingData.usageType : "recording_only";

  const monthKey = getCurrentMonthKey();
  const usageRef = db.collection("usageMonthly").doc(`${uid}_${monthKey}`);

  let didCount = false;

  await db.runTransaction(async (tx) => {
    const recSnap = await tx.get(params.recordingRef);
    if (!recSnap.exists) return;
    const recData = recSnap.data() || {};
    if (recData.usageCounted === true) return;

    const usageSnap = await tx.get(usageRef);
    const existing = usageSnap.exists ? (usageSnap.data() as any) : {};
    const usage = existing.usage || {};
    const ytd = existing.ytd || {};
    const minutes = usage.minutes || {};
    const ytdMinutes = ytd.minutes || {};

    const liveCurrent = toNumber(minutes.live?.currentPeriod);
    const liveLifetime = toNumber(minutes.live?.lifetime ?? ytdMinutes.live?.lifetime);
    const recCurrentPrev = toNumber(minutes.recording?.currentPeriod);
    const recLifetimePrev = toNumber(minutes.recording?.lifetime ?? ytdMinutes.recording?.lifetime);
    const totalCurrentPrev = toNumber(minutes.total?.currentPeriod);
    const totalLifetimePrev = toNumber(minutes.total?.lifetime ?? ytdMinutes.total?.lifetime);

    const byUsageTypePrev = minutes.byUsageType || {};
    const byUsageTypeYtd = ytdMinutes.byUsageType || {};
    const typePrev = byUsageTypePrev[usageType] || {};
    const typeLifetimePrev = toNumber(typePrev.lifetime ?? byUsageTypeYtd[usageType]?.lifetime);

    const nextMinutes = {
      ...minutes,
      live: {
        currentPeriod: liveCurrent,
        lifetime: liveLifetime,
      },
      recording: {
        currentPeriod: recCurrentPrev + billedMinutes,
        lifetime: recLifetimePrev + billedMinutes,
      },
      total: {
        currentPeriod: totalCurrentPrev + billedMinutes,
        lifetime: totalLifetimePrev + billedMinutes,
      },
      byUsageType: {
        ...byUsageTypePrev,
        [usageType]: {
          currentPeriod: toNumber(typePrev.currentPeriod) + billedMinutes,
          lifetime: typeLifetimePrev + billedMinutes,
        },
      },
    };

    const nextYtdMinutes = {
      ...ytdMinutes,
      live: { lifetime: liveLifetime },
      recording: { lifetime: recLifetimePrev + billedMinutes },
      total: { lifetime: totalLifetimePrev + billedMinutes },
      byUsageType: {
        ...byUsageTypeYtd,
        [usageType]: { lifetime: typeLifetimePrev + billedMinutes },
      },
    };

    tx.update(params.recordingRef, {
      usageCounted: true,
      usageCountedAt: params.now,
      billedMinutes: recData.billedMinutes ?? billedMinutes,
      durationMs: recData.durationMs ?? (startedAt ? Math.max(0, params.now.getTime() - startedAt.getTime()) : 0),
      updatedAt: params.now,
    });

    tx.set(
      usageRef,
      {
        uid,
        monthKey,
        usage: {
          ...usage,
          minutes: nextMinutes,
        },
        ytd: {
          ...ytd,
          minutes: nextYtdMinutes,
        },
        createdAt: existing.createdAt || params.now,
        updatedAt: params.now,
      },
      { merge: true }
    );

    didCount = true;
  });

  return { counted: didCount, billedMinutes };
}

// Lazy S3 client for R2
let _s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (_s3Client) return _s3Client;
  const cfg = getR2Config();
  _s3Client = new S3Client({
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
async function r2HeadObjectSize(key: string): Promise<number> {
  try {
    const cfg = getR2Config();
    const client = getS3Client();
    const resp = await client.send(
      new HeadObjectCommand({ Bucket: cfg.bucket, Key: key })
    );
    return typeof resp.ContentLength === "number" ? resp.ContentLength : 0;
  } catch (err: any) {
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

function planIdFromPrice(priceId?: string) {
  if (!priceId) return "free";
  if (priceId === process.env.STRIPE_PRICE_STARTER) return "starter";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_BASIC) return "basic";
  return "free";
}

function canonicalPlanFromSubscription(subscription: any): "free" | "starter" | "basic" | "pro" {
  const metaPlan = String(subscription?.metadata?.plan || "").trim();
  if (metaPlan === "free" || metaPlan === "starter" || metaPlan === "basic" || metaPlan === "pro") {
    return metaPlan;
  }

  const planVariant = String(subscription?.metadata?.planVariant || "").trim();
  if (planVariant === "pro") return "pro";
  if (planVariant === "basic") return "basic";
  if (planVariant.startsWith("starter")) return "starter";

  const priceId = subscription?.items?.data?.[0]?.price?.id;
  const fromPrice = planIdFromPrice(priceId);
  if (fromPrice === "starter" || fromPrice === "basic" || fromPrice === "pro") return fromPrice;
  return "free";
}

type PlanChangeHistoryEntry = {
  at: number;
  fromPlan: string;
  toPlan: string;
  source: string;
};

function sanitizeHistory(history: any): PlanChangeHistoryEntry[] {
  if (!Array.isArray(history)) return [];
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

function mapBillingStatus(status: string) {
  if (status === "active" || status === "trialing") return status;
  if (status === "past_due") return "past_due";
  if (status === "unpaid") return "unpaid";
  if (status === "canceled") return "canceled";
  return "past_due";
}

// =============================================================================
// LIVEKIT HELPERS
// =============================================================================

/**
 * Extract object key from various LiveKit egress response shapes
 */
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

function normalizeStorageKey(key: unknown): string | null {
  const raw = String(key ?? "").trim();
  if (!raw) return null;
  return raw.startsWith("/") ? raw.slice(1) : raw;
}

function keyToPrefix(key: string): string | null {
  const normalized = normalizeStorageKey(key);
  const k = normalized || String(key || "").trim();
  const idx = k.lastIndexOf("/");
  if (idx <= 0) return null;
  return `${k.slice(0, idx + 1)}`;
}

// =============================================================================
// STRIPE WEBHOOK
// POST /api/webhooks/stripe
// =============================================================================

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
      console.error("[stripe-webhook] Signature verification failed:", err?.message);
      return res.status(400).send(`Webhook Error: ${err?.message || "Bad signature"}`);
    }

    // Log received event before processing
    console.log("[stripe-webhook] Received:", {
      eventType: event.type,
      eventId: event.id,
      timestamp: new Date().toISOString(),
    });

    try {
      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "invoice.paid":
        case "customer.subscription.deleted": {
          const sub: any = event.data.object;
          const uid = sub?.metadata?.userId;
          if (!uid) break;

          let subscription = sub;
          if (event.type === "invoice.paid" && sub.subscription) {
            subscription = await stripe.subscriptions.retrieve(sub.subscription);
          }

          const planVariant = subscription?.metadata?.planVariant;
          const canonicalPlan = canonicalPlanFromSubscription(subscription);
          const isActive =
            subscription.status === "active" || subscription.status === "trialing";

          const userSnap = await getUserRef(uid).get();
          const user = userSnap.exists ? userSnap.data() : {};

          const scheduledPlanChange = (user as any)?.scheduledPlanChange || null;
          const now = Date.now();
          const preservePendingPlan =
            scheduledPlanChange &&
            scheduledPlanChange.type === "downgrade" &&
            typeof scheduledPlanChange.effectiveAtMs === "number" &&
            scheduledPlanChange.effectiveAtMs > now;

          const shouldClearScheduledPlanChange =
            scheduledPlanChange &&
            scheduledPlanChange.type === "downgrade" &&
            typeof scheduledPlanChange.effectiveAtMs === "number" &&
            scheduledPlanChange.effectiveAtMs <= now &&
            typeof scheduledPlanChange.targetPlanId === "string" &&
            scheduledPlanChange.targetPlanId === canonicalPlan;

          const currentPlan = user?.planId || "free";
          const history = sanitizeHistory((user as any)?.planChangeHistory);
          const nextHistory =
            currentPlan === canonicalPlan
              ? history
              : [...history, { at: now, fromPlan: currentPlan, toPlan: canonicalPlan, source: "stripe_webhook" }].slice(-10);

          console.log("[stripe-webhook] Processing subscription update:", {
            uid,
            eventType: event.type,
            subscriptionId: subscription.id,
            fromPlan: currentPlan,
            toPlan: canonicalPlan,
            status: subscription.status,
            isActive,
          });

          await getUserRef(uid).set(
            {
              planId: isActive ? canonicalPlan : "free",
              pendingPlan: preservePendingPlan ? ((user as any)?.pendingPlan ?? null) : null,
              ...(shouldClearScheduledPlanChange ? { scheduledPlanChange: null } : {}),
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
                currentPeriodEnd:
                  typeof subscription.current_period_end === "number"
                    ? subscription.current_period_end * 1000
                    : null,
                hasHadTrial:
                  user.billing?.hasHadTrial === true ||
                  planVariant === "starter_trial",
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
            console.warn("[stripe] checkout.session.completed missing userId");
            break;
          }

          const customerId =
            typeof session.customer === "string" ? session.customer : null;
          const subscriptionId =
            typeof session.subscription === "string" ? session.subscription : null;

          if (!subscriptionId) {
            console.warn("[stripe] Checkout completed without subscriptionId");
            break;
          }

          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = sub.items.data?.[0]?.price?.id;

          let planId = planIdFromPrice(priceId);
          const planVariant = sub?.metadata?.planVariant;
          if (planVariant === "starter_trial" || planVariant === "starter_paid") {
            planId = "starter";
          } else if (planVariant === "basic") {
            planId = "basic";
          } else if (planVariant === "pro") {
            planId = "pro";
          }

          const billingStatus = mapBillingStatus(sub.status);
          const billingActive =
            billingStatus === "active" || billingStatus === "trialing";

          const currentPeriodEndSec = (sub as any).current_period_end as
            | number
            | undefined;
          const currentPeriodEnd =
            typeof currentPeriodEndSec === "number"
              ? currentPeriodEndSec * 1000
              : null;

          const setHasHadTrial =
            planVariant === "starter_trial" ? { hasHadTrial: true } : {};

          const userSnap = await getUserRef(uid).get();
          const user = userSnap.exists ? userSnap.data() : {};
          const currentPlan = (user as any)?.planId || "free";
          const now = Date.now();
          const history = sanitizeHistory((user as any)?.planChangeHistory);
          const nextHistory =
            currentPlan === planId
              ? history
              : [...history, { at: now, fromPlan: currentPlan, toPlan: planId, source: "stripe_webhook" }].slice(-10);

          await getUserRef(uid).set(
            {
              planId: billingActive ? planId : "free",
              pendingPlan: null,
              planChangeHistory: nextHistory,
              planChangeCooldownUntil: null,
              planChangeLock: null,
              planChangeRequestId: null,
              planChangeRequestResult: null,
              billingActive,
              billingStatus,
              billing: {
                ...(((user as any)?.billing) || {}),
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
              updatedAt: Date.now(),
            },
            { merge: true }
          );

          console.log("[stripe] Billing written from checkout.session.completed", {
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

          const userSnap = await getUserRef(userId).get();
          const user = userSnap.exists ? userSnap.data() : {};
          const now = Date.now();
          const history = sanitizeHistory((user as any)?.planChangeHistory);
          const currentPlan = user?.planId || "free";
          const nextHistory =
            currentPlan === "free"
              ? history
              : [...history, { at: now, fromPlan: currentPlan, toPlan: "free", source: "stripe_webhook" }].slice(-10);

          console.log("[stripe-webhook] Payment failed - downgrading to free:", {
            userId,
            subscriptionId: subId,
            fromPlan: currentPlan,
          });

          await db.collection("users").doc(userId).set(
            {
              planId: "free",
              billingActive: false,
              billingStatus: "past_due",
              planChangeHistory: nextHistory,
              planChangeCooldownUntil: null,
              planChangeLock: null,
              planChangeRequestId: null,
              planChangeRequestResult: null,
              billing: { updatedAt: Date.now() },
            },
            { merge: true }
          );
          break;
        }

        case "customer.subscription.trial_will_end": {
          const sub: any = event.data.object;
          const uid = sub?.metadata?.userId;
          if (!uid) break;

          console.log("[stripe-webhook] Trial ending soon:", { 
            uid, 
            subscriptionId: sub.id,
            trialEnd: sub.trial_end 
          });
          break;
        }

        case "subscription_schedule.completed": {
          // Fired when a scheduled plan change executes
          const schedule: any = event.data.object;
          const subscription = schedule.subscription;
          
          if (typeof subscription !== "string") break;

          const sub = await stripe.subscriptions.retrieve(subscription);
          const uid = sub?.metadata?.userId;
          if (!uid) break;

          const canonicalPlan = canonicalPlanFromSubscription(sub);
          const userSnap = await getUserRef(uid).get();
          const user = userSnap.exists ? userSnap.data() : {};
          const currentPlan = user?.planId || "free";
          const now = Date.now();
          const history = sanitizeHistory((user as any)?.planChangeHistory);

          console.log("[stripe-webhook] Schedule completed:", {
            uid,
            scheduleId: schedule.id,
            subscriptionId: subscription,
            fromPlan: currentPlan,
            toPlan: canonicalPlan,
          });

          const nextHistory =
            currentPlan === canonicalPlan
              ? history
              : [...history, { at: now, fromPlan: currentPlan, toPlan: canonicalPlan, source: "schedule_completed" }].slice(-10);

          await getUserRef(uid).set(
            {
              planId: canonicalPlan,
              pendingPlan: null,
              scheduledPlanChange: null,  // Clear scheduled change
              planChangeHistory: nextHistory,
              updatedAt: now,
            },
            { merge: true }
          );
          break;
        }

        case "subscription_schedule.released": {
          // Fired when a schedule is released (canceled)
          const schedule: any = event.data.object;
          const subscription = schedule.subscription;
          
          if (typeof subscription !== "string") break;

          const sub = await stripe.subscriptions.retrieve(subscription);
          const uid = sub?.metadata?.userId;
          if (!uid) break;

          console.log("[stripe-webhook] Schedule released (canceled):", {
            uid,
            scheduleId: schedule.id,
            subscriptionId: subscription,
          });

          const userSnap = await getUserRef(uid).get();
          const user = userSnap.exists ? userSnap.data() : {};
          const scheduledChange = (user as any)?.scheduledPlanChange;

          // Only clear if this is the matching schedule
          if (scheduledChange?.scheduleId === schedule.id) {
            await getUserRef(uid).set(
              {
                pendingPlan: null,
                scheduledPlanChange: null,
                updatedAt: Date.now(),
              },
              { merge: true }
            );
          }
          break;
        }

        default:
          return res.status(200).json({ received: true });
      }

      return res.json({ received: true });
    } catch (err: any) {
      console.error("[stripe] Webhook handler failed:", err?.message);
      return res.status(500).send(err?.message || "Webhook handler failed");
    }
  }
);

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

router.post("/livekit", express.raw({ type: "*/*" }), async (req, res) => {
  console.log("[livekit-webhook] Received request");

  try {
    const authHeader = String(req.headers["authorization"] || "");
    const rawBody = req.body as Buffer;

    if (!Buffer.isBuffer(rawBody)) {
      console.error("[livekit-webhook] Expected raw body Buffer");
      return res.status(400).json({ ok: false, error: "Expected raw body Buffer" });
    }

    const LIVEKIT_API_KEY = mustGetEnv("LIVEKIT_API_KEY");
    const LIVEKIT_API_SECRET = mustGetEnv("LIVEKIT_API_SECRET");

    const { WebhookReceiver } = await import("livekit-server-sdk");
    const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

    let event: any;
    try {
      event = await receiver.receive(rawBody.toString("utf8"), authHeader);
    } catch (verifyErr: any) {
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

    const now = new Date();
    const endedAt = coerceDate(egressInfo?.endedAt) || now;

    // If this egressId belongs to an HLS session (rooms.hls.egressId), do an
    // immediate best-effort cleanup so segments don't linger after the stream ends.
    try {
      const roomSnap = await db
        .collection("rooms")
        .where("hls.egressId", "==", egressId)
        .limit(1)
        .get();

      if (!roomSnap.empty) {
        const roomDoc = roomSnap.docs[0];
        const roomData = (roomDoc.data() || {}) as any;
        const prefix = String(roomData?.hls?.prefix || `hls/${roomDoc.id}/`).trim();

        // Count HLS usage for cases where the app did not call /api/hls/stop.
        try {
          const startedAt = coerceDate(roomData?.hls?.startedAt);
          const billedMinutes = computeBilledMinutes(startedAt, endedAt);
          const usageUid = String(roomData?.ownerId || "").trim();
          if (usageUid && billedMinutes > 0) {
            await incrementHlsMinutes({ uid: usageUid, billedMinutes, now });
          }
        } catch (e: any) {
          console.warn("[livekit-webhook] HLS usage increment failed", { roomId: roomDoc.id, error: e?.message || e });
        }

        try {
          await deletePrefix(prefix);
        } catch (e: any) {
          console.warn("[livekit-webhook] HLS deletePrefix failed", { roomId: roomDoc.id, prefix, error: e?.message || e });
        }

        try {
          await setHlsIdle(roomDoc.ref);
        } catch (e: any) {
          console.warn("[livekit-webhook] setHlsIdle failed", { roomId: roomDoc.id, error: e?.message || e });
        }

        return res.status(200).json({ ok: true, handled: "hls_cleanup", roomId: roomDoc.id, prefix });
      }
    } catch (e: any) {
      // Continue into recording flow if HLS lookup fails.
      console.warn("[livekit-webhook] HLS lookup failed", e?.message || e);
    }

    // =========================================================================
    // DETERMINISTIC LOOKUP: recordings.where("egressId", "==", egressId).limit(1)
    // With retry on not found (doc might not be written yet)
    // =========================================================================
    async function findRecordingByEgressId(egressId: string, retryCount: number = 0): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
      const querySnap = await db
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

    const looksLikeRecording =
      !!extractObjectKey(egressInfo) ||
      !!egressInfo?.file ||
      Array.isArray(egressInfo?.fileResults) ||
      Array.isArray(egressInfo?.outputs);

    const recordingDoc = looksLikeRecording ? await findRecordingByEgressId(egressId) : null;

    if (!recordingDoc && looksLikeRecording) {
      console.error(`[livekit-webhook] CRITICAL: No recording found for egressId: ${egressId} after retry`);
      return res.status(404).json({ ok: false, error: "Recording not found for egressId" });
    }

    if (!recordingDoc) {
      // Not HLS, and not a recording: treat as other egress types (e.g., RTMP multistream).
      try {
        const sessionRef = db.collection("egressSessions").doc(egressId);
        const sessionSnap = await sessionRef.get();
        if (sessionSnap.exists) {
          const session = sessionSnap.data() as any;
          const kind = String(session?.kind || "").toLowerCase();
          const usageUid = String(session?.uid || "").trim();
          const startedAt = coerceDate(session?.startedAt);
          const billedMinutes = computeBilledMinutes(startedAt, endedAt);

          if (usageUid && billedMinutes > 0) {
            await db.runTransaction(async (tx) => {
              const s = await tx.get(sessionRef);
              const sData = s.exists ? (s.data() as any) : null;
              if (!sData) return;
              if (sData.countedAt) return;

              const monthKey = getCurrentMonthKey();
              const usageRef = db.collection("usageMonthly").doc(`${usageUid}_${monthKey}`);
              const usageSnap = await tx.get(usageRef);
              const existing = usageSnap.exists ? (usageSnap.data() as any) : {};
              const usage = existing.usage || {};
              const ytd = existing.ytd || {};
              const minutes = usage.minutes || {};
              const ytdMinutes = ytd.minutes || {};

              const prevCurrent = toNumber(minutes.transcode?.currentPeriod ?? usage.transcodeMinutes);
              const prevLifetime = toNumber(
                minutes.transcode?.lifetime ?? ytdMinutes.transcode?.lifetime ?? ytd.transcodeMinutes
              );

              const nextCurrent = prevCurrent + billedMinutes;
              const nextLifetime = prevLifetime + billedMinutes;

              tx.set(
                usageRef,
                {
                  uid: usageUid,
                  monthKey,
                  usage: {
                    ...usage,
                    transcodeMinutes: toNumber(usage.transcodeMinutes) + billedMinutes,
                    minutes: {
                      ...minutes,
                      transcode: {
                        currentPeriod: nextCurrent,
                        lifetime: nextLifetime,
                      },
                    },
                  },
                  ytd: {
                    ...ytd,
                    transcodeMinutes: toNumber(ytd.transcodeMinutes) + billedMinutes,
                    minutes: {
                      ...ytdMinutes,
                      transcode: {
                        lifetime: nextLifetime,
                      },
                    },
                  },
                  createdAt: existing.createdAt || now,
                  updatedAt: now,
                },
                { merge: true }
              );

              tx.set(
                sessionRef,
                {
                  endedAt: endedAt,
                  billedMinutes,
                  kind: kind || "multistream",
                  countedAt: now,
                  updatedAt: now,
                },
                { merge: true }
              );
            });
          }

          return res.status(200).json({ ok: true, handled: "egress_session", egressId, kind: kind || "multistream" });
        }
      } catch (e: any) {
        console.warn("[livekit-webhook] egressSessions lookup failed", e?.message || e);
      }

      console.log(`[livekit-webhook] No handler found for egressId: ${egressId}; ignoring`);
      return res.status(200).json({ ok: true, ignored: true, egressId });
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
      // Still ensure minutes are counted (webhook may arrive when stop endpoint wasn't called).
      if (recordingData.usageCounted !== true) {
        await maybeCountRecordingUsage({ recordingRef, recordingData, now });
      }
      return res.status(200).json({ ok: true, alreadyReady: true, recordingId });
    }
    if (currentStatus === "failed") {
      console.log(`[livekit-webhook] Recording ${recordingId} already failed, skipping`);
      // Do not count failed recordings twice; only count if not already counted.
      if (recordingData.usageCounted !== true) {
        await maybeCountRecordingUsage({ recordingRef, recordingData, now });
      }
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
    let finalStatus: string;
    let downloadReady = false;
    let fileSize: number | null = null;
    let errorMessage: string | null = null;

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
      } else {
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
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    const normalizedObjectKey = normalizeStorageKey(objectKey) || objectKey;
    const derivedPrefix = keyToPrefix(normalizedObjectKey);

    const updates: Record<string, any> = {
      status: finalStatus,
      downloadReady,
      objectKey: normalizedObjectKey,  // Update with actual egress path if different
      downloadPath: normalizedObjectKey,
      fileSize,
      livekitStatus: egressStatus,
      oneTimeToken: hashedToken,
      updatedAt: now,
      endedAt: now,
    };

    // Always retain storage targets for later deletion (idempotent).
    updates.r2Keys = FieldValue.arrayUnion(normalizedObjectKey);
    if (derivedPrefix) {
      updates.r2Prefix = derivedPrefix;
      updates.r2Prefixes = FieldValue.arrayUnion(derivedPrefix);
    }

    if (finalStatus === "ready") {
      updates.readyAt = now;
    }
    if (errorMessage) {
      updates.errorMessage = errorMessage;
    }

    await recordingRef.update(updates);

    // Best-effort: keep room latest recording pointer in sync.
    try {
      const roomId = typeof recordingData.roomId === "string" ? String(recordingData.roomId).trim() : "";
      if (roomId) {
        const roomRef = db.collection("rooms").doc(roomId);
        const roomSnap = await roomRef.get();
        const roomData = roomSnap.exists ? ((roomSnap.data() as any) || {}) : {};
        const currentLatest = String(roomData.latestRecordingId || "").trim();
        if (!currentLatest || currentLatest === recordingId) {
          await roomRef.set(
            {
              latestRecordingId: recordingId,
              latestRecordingStatus: finalStatus,
              latestRecordingUpdatedAt: now,
            },
            { merge: true }
          );
        }
      }
    } catch (e: any) {
      console.warn("[livekit-webhook] failed to update room latestRecording status", e?.message || e);
    }

    // Ensure recording minutes are counted even if /recordings/stop wasn't called.
    if (recordingData.usageCounted !== true) {
      try {
        await maybeCountRecordingUsage({ recordingRef, recordingData, now });
      } catch (e: any) {
        console.warn("[livekit-webhook] failed to count recording usage", { recordingId, error: e?.message || e });
      }
    }

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

  } catch (err: any) {
    console.error("[livekit-webhook] Error:", err?.message, err?.stack?.slice(0, 500));
    return res.status(500).json({ ok: false, error: err?.message || "Webhook error" });
  }
});

export default router;
