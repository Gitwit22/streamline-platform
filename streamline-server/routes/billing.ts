import { Router } from "express";
import type Stripe from "stripe";
import type { DocumentReference } from "firebase-admin/firestore";
import { stripe } from "../lib/stripe";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { PLAN_IDS, PlanId, isPlanId } from "../types/plan";
import { getUserAccount } from "../lib/userAccount";

// Plan change guardrails
const PLAN_CHANGE_WINDOW_MS = 5 * 24 * 60 * 60 * 1000; // 5 days
const PLAN_CHANGE_MAX_IN_WINDOW = 2;
const PLAN_CHANGE_LOCK_TTL_MS = 60 * 1000; // 60 seconds

type PlanChangeHistoryEntry = {
  at: number; // epoch ms
  fromPlan: string;
  toPlan: string;
  source: string;
};

// Simple in-memory throttle for test-mode plan switching
const TEST_PLAN_CHANGE_THROTTLE_MS = 2000; // 1 req / 2s per uid
const testPlanChangeThrottle = new Map<string, number>();

function getUserRef(uid: string) {
  return db.collection("users").doc(uid);
}

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

async function acquirePlanChangeLock(params: {
  userRef: DocumentReference;
  requestId: string;
}) {
  const { userRef, requestId } = params;
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) {
      throw Object.assign(new Error("user_not_found"), { code: "USER_NOT_FOUND" });
    }

    const user = snap.data() as any;
    const history = sanitizeHistory(user?.planChangeHistory);

    // Cooldown check: block on 3rd change inside 5-day window
    const recent = history.filter((entry) => entry.at >= now - PLAN_CHANGE_WINDOW_MS);
    if (recent.length >= PLAN_CHANGE_MAX_IN_WINDOW) {
      const oldestRecent = recent[0];
      const cooldownUntil = oldestRecent.at + PLAN_CHANGE_WINDOW_MS;
      tx.set(
        userRef,
        {
          planChangeCooldownUntil: cooldownUntil,
          planChangeLock: null,
        },
        { merge: true }
      );
      throw Object.assign(new Error("plan_change_cooldown"), {
        code: "COOLDOWN",
        cooldownUntil,
      });
    }

    const lock = user?.planChangeLock;
    const lockActive =
      lock && typeof lock.expiresAt === "number" && lock.expiresAt > now;

    // Another request holds the lock
    if (lockActive && lock.token !== requestId) {
      throw Object.assign(new Error("plan_change_locked"), {
        code: "LOCKED",
        lockUntil: lock.expiresAt,
      });
    }

    const newLock = {
      token: requestId,
      acquiredAt: now,
      expiresAt: now + PLAN_CHANGE_LOCK_TTL_MS,
    };

    tx.set(
      userRef,
      {
        planChangeLock: newLock,
        planChangeRequestId: requestId,
      },
      { merge: true }
    );

    return { user, newLock };
  });
}

const router = Router();


// Canonical Stripe price lookup for any plan
function priceIdFor(plan: PlanId, planMeta?: any) {
  if (plan === "starter") {
    const id = process.env.STRIPE_PRICE_STARTER;
    if (!id) throw new Error("Missing STRIPE_PRICE_STARTER");
    return id;
  }
  if (plan === "pro") {
    const id = process.env.STRIPE_PRICE_PRO;
    if (!id) throw new Error("Missing STRIPE_PRICE_PRO");
    return id;
  }
  if (plan === "basic") {
    const id = process.env.STRIPE_PRICE_BASIC;
    if (!id) throw new Error("Missing STRIPE_PRICE_BASIC");
    return id;
  }
  // For new plans, expect a stripePriceId in Firestore plan doc
  if (planMeta && typeof planMeta.stripePriceId === "string" && planMeta.stripePriceId.trim().length > 0) {
    return planMeta.stripePriceId;
  }
  throw new Error(`No Stripe price configured for plan: ${plan}`);
}

// Accept any PlanId + variant for checkout
type CheckoutPlanVariant = `${PlanId}_paid` | `${PlanId}_trial` | PlanId;

const PLAN_RANKS: Record<string, number> = {
  free: 0,
  starter: 1,
  basic: 1,
  pro: 2,
  enterprise: 3,
  internal_unlimited: 4,
};

function getPlanRank(planId?: string | null): number {
  if (!planId) return 0;
  return PLAN_RANKS[planId] ?? 0;
}

router.post("/checkout", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ success: false, error: "Unauthorized" });

    const { plan, requestId } = (req.body || {}) as { plan?: CheckoutPlanVariant; requestId?: string };
    if (!plan || typeof plan !== "string") {
      return res.status(400).json({ success: false, error: "Missing plan" });
    }

    if (!requestId || typeof requestId !== "string" || requestId.trim().length < 8) {
      return res.status(400).json({ success: false, error: "Missing requestId" });
    }

    // Parse canonical plan id from variant
    let canonicalPlan: PlanId | undefined;
    let variant: string = "";
    if (plan.endsWith("_trial")) {
      canonicalPlan = plan.slice(0, -6) as PlanId;
      variant = "trial";
    } else if (plan.endsWith("_paid")) {
      canonicalPlan = plan.slice(0, -5) as PlanId;
      variant = "paid";
    } else {
      canonicalPlan = plan as PlanId;
      variant = "paid";
    }
    if (!isPlanId(canonicalPlan)) {
      return res.status(400).json({ success: false, error: "Invalid plan" });
    }

    const CLIENT_URL = process.env.CLIENT_URL;
    if (!CLIENT_URL) throw new Error("Missing env var: CLIENT_URL");

    // Normalize account and hard-block Stripe when billing is effectively disabled
    const account = await getUserAccount(uid);
    if (account.effectiveBillingEnabled === false) {
      return res
        .status(403)
        .json({ success: false, error: "billing_disabled" });
    }

    const userRef = getUserRef(uid);
    const snap = await userRef.get();
    if (!snap.exists) return res.status(404).json({ success: false, error: "User not found" });

    const user = snap.data() as any;

    // Idempotent: return the prior result if this requestId already finished
    if (user?.planChangeRequestId === requestId && user?.planChangeRequestResult) {
      return res.json({ success: true, reused: true, ...user.planChangeRequestResult });
    }

    // Acquire lock + cooldown enforcement
    let lockedUser: any = null;
    try {
      lockedUser = await acquirePlanChangeLock({ userRef, requestId });
    } catch (err: any) {
      if (err?.code === "COOLDOWN") {
        return res.status(429).json({ success: false, error: "plan_change_cooldown", cooldownUntil: err.cooldownUntil });
      }
      if (err?.code === "LOCKED") {
        return res.status(409).json({ success: false, error: "plan_change_locked", lockUntil: err.lockUntil });
      }
      if (err?.code === "USER_NOT_FOUND") {
        return res.status(404).json({ success: false, error: "User not found" });
      }
      throw err;
    }

    const userAtLock = lockedUser?.user ?? user;

    // Trial eligibility
    const hasHadTrial = userAtLock?.billing?.hasHadTrial === true;
    const DEFAULT_TRIAL_DAYS = Number(process.env.STRIPE_STARTER_TRIAL_DAYS || "5");

    // Trial logic: only when explicitly chosen AND not already used
    const useTrial = variant === "trial" && !hasHadTrial;
    const trialDays = useTrial ? DEFAULT_TRIAL_DAYS : 0;

    // Ensure Stripe customer exists
    let customerId: string | undefined = userAtLock?.stripeCustomerId || userAtLock?.billing?.customerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userAtLock?.email,
        name: userAtLock?.displayName,
        metadata: { userId: uid },
      });

      customerId = customer.id;

      await userRef.set(
        {
          stripeCustomerId: customerId,
          billing: {
            provider: "stripe",
            customerId,
            updatedAt: Date.now(),
          },
        },
        { merge: true }
      );
    }

    // Fetch plan metadata from Firestore for custom plans
    let planMeta: any = {};
    try {
      const planSnap = await db.collection("plans").doc(canonicalPlan).get();
      if (planSnap.exists) planMeta = planSnap.data();
    } catch {}

    // Create Checkout Session
    const subscription_data: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
      metadata: {
        userId: uid,
        plan: canonicalPlan,
        planVariant: plan,
      },
      ...(useTrial ? { trial_period_days: trialDays } : {}),
      ...(useTrial
        ? { trial_settings: { end_behavior: { missing_payment_method: "cancel" } } }
        : {}),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceIdFor(canonicalPlan, planMeta), quantity: 1 }],

      success_url: `${CLIENT_URL}/billing/success`,
      cancel_url: `${CLIENT_URL}/billing/canceled`,

      metadata: {
        userId: uid,
        plan: canonicalPlan,
        planVariant: plan,
      },

      subscription_data,
    });

    const now = Date.now();
    const history = sanitizeHistory(userAtLock?.planChangeHistory);
    const nextHistory = [
      ...history,
      {
        at: now,
        fromPlan: userAtLock?.planId || "free",
        toPlan: canonicalPlan,
        source: "checkout",
      },
    ].slice(-10);

    await userRef.set(
      {
        pendingPlan: canonicalPlan,
        planChangeHistory: nextHistory,
        planChangeCooldownUntil: null,
        planChangeLock: null,
        planChangeRequestId: requestId,
        planChangeRequestResult: {
          requestId,
          status: "ok",
          url: session.url,
          plan: canonicalPlan,
          createdAt: now,
        },
      },
      { merge: true }
    );

    return res.json({ success: true, url: session.url, requestId });
  } catch (err: any) {
    console.error("POST /api/billing/checkout failed:", err?.message || err);
    if (req?.body?.requestId) {
      try {
        await getUserRef((req as any).user?.uid).set(
          {
            planChangeLock: null,
          },
          { merge: true }
        );
      } catch {}
    }
    return res.status(500).json({ success: false, error: err?.message || "Server error" });
  }
});

router.post("/portal", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ success: false, error: "Unauthorized" });
    const account = await getUserAccount(uid);
    if (account.effectiveBillingEnabled === false) {
      return res
        .status(403)
        .json({ success: false, error: "billing_disabled" });
    }

    const snap = await getUserRef(uid).get();
    if (!snap.exists) return res.status(404).json({ success: false, error: "User not found" });

    const user = snap.data() as any;

    const customerId = user?.stripeCustomerId || user?.billing?.customerId;
    if (!customerId) return res.status(400).json({ success: false, error: "No Stripe customer" });

    const CLIENT_URL = process.env.CLIENT_URL;
    if (!CLIENT_URL) throw new Error("Missing env var: CLIENT_URL");

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${CLIENT_URL}/settings/billing`,
    });

    return res.json({ success: true, url: portal.url });
  } catch (err: any) {
    console.error("POST /api/billing/portal failed:", err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || "Server error" });
  }
});

// Test-mode only: allow self-service plan switching without Stripe when billing is disabled.
router.post("/test/change-plan", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ success: false, error: "Unauthorized" });

    const { newPlanId } = (req.body || {}) as { newPlanId?: string };
    if (!newPlanId || typeof newPlanId !== "string") {
      return res.status(400).json({ success: false, error: "missing_plan" });
    }

    const account = await getUserAccount(uid);

    // Only allowed when billing is effectively disabled (platform-wide or per-user)
    if (account.effectiveBillingEnabled !== false) {
      return res
        .status(403)
        .json({ success: false, error: "billing_live" });
    }

    const platformDisabled = account.platformBillingEnabled === false;
    const userDisabled = account.billingEnabled === false;

    // Optional safety rail:
    // - If billing is disabled platform-wide, treat it as an intentional test/staging mode and allow.
    // - If only the user is in test mode while platform billing is enabled, require explicit tester flag in production.
    const isProd = process.env.NODE_ENV === "production";
    const raw = account.rawUser || {};
    const isTester = !!(raw.tester || raw.isTester);
    if (isProd && !platformDisabled && userDisabled && !isTester) {
      return res
        .status(403)
        .json({ success: false, error: "test_mode_disabled" });
    }

    const planIdCandidate = newPlanId as PlanId;
    if (!isPlanId(planIdCandidate)) {
      return res.status(400).json({ success: false, error: "invalid_plan" });
    }

    const now = Date.now();
    const last = testPlanChangeThrottle.get(uid) || 0;
    if (now - last < TEST_PLAN_CHANGE_THROTTLE_MS) {
      return res.status(429).json({ success: false, error: "too_many_requests" });
    }
    testPlanChangeThrottle.set(uid, now);

    const fromPlan = account.planId || "free";
    const userRef = getUserRef(uid);

    // In test mode, do not touch any Stripe or subscription fields; just update planId/pendingPlan.
    await userRef.set(
      {
        planId: planIdCandidate,
        pendingPlan: null,
        updatedAt: now,
      },
      { merge: true }
    );

    const ip = (req.headers["x-forwarded-for"] as string) || req.ip;
    const userAgent = (req.headers["user-agent"] as string) || "";
    const env = process.env.NODE_ENV || "development";
    const requestIdHeader = (req.headers["x-request-id"] as string) || "";
    const requestId = requestIdHeader || `${uid}-${now}`;

    await db.collection("billingAudit").add({
      type: "test_plan_change",
      uid,
      fromPlan,
      toPlan: planIdCandidate,
      at: now,
      ip,
      userAgent,
      env,
      requestId,
      source: "billing_test_mode",
    });

    return res.json({ success: true, planId: planIdCandidate });
  } catch (err: any) {
    console.error("POST /api/billing/test/change-plan failed:", err?.message || err);
    return res.status(500).json({ success: false, error: "Failed to change plan in test mode" });
  }
});

// Allow clients to clear a stale pendingPlan (e.g., user canceled checkout)
router.post("/clear-pending", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ success: false, error: "Unauthorized" });
    await getUserRef(uid).set({ pendingPlan: null }, { merge: true });
    return res.json({ success: true });
  } catch (err: any) {
    console.error("POST /api/billing/clear-pending failed:", err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || "Server error" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const account = await getUserAccount(uid);

    const snap = await getUserRef(uid).get();
    const raw = snap.exists ? snap.data() : account.rawUser;
    return res.json({
      id: uid,
      ...raw,
      planId: account.planId,
      billingEnabled: account.billingEnabled,
      platformBillingEnabled: account.platformBillingEnabled,
      effectiveBillingEnabled: account.effectiveBillingEnabled,
      isAdmin: account.isAdmin,
    });
  } catch (err: any) {
    console.error("GET /api/billing/me failed:", err?.message || err);
    return res.status(500).json({ error: "Failed to load user" });
  }
});

// Safely check if a subscription change is scheduled
// Returns: { scheduledChange, effectiveDate, hasSubscription, status, cancelAtPeriodEnd, billingActive }
router.get("/pending-change", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const account = await getUserAccount(uid);

    const snap = await getUserRef(uid).get();
    if (!snap.exists) return res.status(404).json({ error: "User not found" });
    const user = snap.data() as any;

    const subscriptionId: string | undefined =
      user?.billing?.subscriptionId || user?.stripeSubscriptionId;

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

    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const cancelAtPeriodEnd = !!(sub as any).cancel_at_period_end;
    const status = (sub as any).status as string | undefined;
    const currentPeriodEnd = (sub as any).current_period_end
      ? new Date((sub as any).current_period_end * 1000).toISOString()
      : null;

    let scheduledChange = false;
    let effectiveDate: string | null = null;

    // If set to cancel at period end, consider that a scheduled change
    if (cancelAtPeriodEnd) {
      scheduledChange = true;
      effectiveDate = currentPeriodEnd;
    }

    // If there is a schedule attached, treat it as scheduled
    if (!scheduledChange) {
      const scheduleId = (sub as any).schedule || (sub as any).subscription_schedule;
      if (scheduleId) {
        scheduledChange = true;
        // Best-effort: try to read schedule
        try {
          const schedule = await stripe.subscriptionSchedules.retrieve(String(scheduleId));
          const phases = (schedule.phases || []) as any[];
          const last = phases[phases.length - 1];
          if (last?.end_date) {
            effectiveDate = new Date(last.end_date * 1000).toISOString();
          }
        } catch {}
      }
    }

    // Some accounts expose pending_update
    if (!scheduledChange && (sub as any).pending_update) {
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
  } catch (err: any) {
    console.error("GET /api/billing/pending-change failed:", err?.message || err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Comprehensive billing/plan state for UI state machine
router.get("/status", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    const account = await getUserAccount(uid);

    const snap = await getUserRef(uid).get();
    if (!snap.exists) return res.status(404).json({ error: "User not found" });
    const user = snap.data() as any;

    const now = Date.now();
    const cooldownUntil = typeof user?.planChangeCooldownUntil === "number" ? user.planChangeCooldownUntil : null;
    const cooldownActive = !!(cooldownUntil && cooldownUntil > now);
    const lock = user?.planChangeLock || null;

    const subscriptionId: string | undefined =
      user?.billing?.subscriptionId || user?.stripeSubscriptionId;

    let cancelAtPeriodEnd = false;
    let status: string | undefined = user?.billingStatus;
    let billingActive = !!(user?.billingStatus === "active" || user?.billingStatus === "trialing");
    let scheduledChange = false;
    let scheduledEffectiveDate: string | null = null;

    if (subscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        cancelAtPeriodEnd = !!(sub as any).cancel_at_period_end;
        status = (sub as any).status as string | undefined;
        billingActive = status === "active" || status === "trialing";

        const currentPeriodEnd = (sub as any).current_period_end
          ? new Date((sub as any).current_period_end * 1000).toISOString()
          : null;

        if (cancelAtPeriodEnd) {
          scheduledChange = true;
          scheduledEffectiveDate = currentPeriodEnd;
        }

        const scheduleId = (sub as any).schedule || (sub as any).subscription_schedule;
        if (!scheduledChange && scheduleId) {
          scheduledChange = true;
          try {
            const schedule = await stripe.subscriptionSchedules.retrieve(String(scheduleId));
            const phases = (schedule.phases || []) as any[];
            const last = phases[phases.length - 1];
            if (last?.end_date) {
              scheduledEffectiveDate = new Date(last.end_date * 1000).toISOString();
            }
          } catch {}
        }

        if (!scheduledChange && (sub as any).pending_update) {
          scheduledChange = true;
          scheduledEffectiveDate = currentPeriodEnd;
        }
      } catch (err: any) {
        console.error("GET /api/billing/status subscription fetch failed:", err?.message || err);
      }
    }

    const planId = user?.planId || "free";
    const pendingPlan = user?.pendingPlan ?? null;

    let state: string = "ACTIVE";
    if (cooldownActive) {
      state = "COOLDOWN";
    } else if (cancelAtPeriodEnd) {
      state = "CANCEL_AT_PERIOD_END";
    } else if (scheduledChange) {
      if (pendingPlan && pendingPlan !== planId) {
        state = getPlanRank(pendingPlan) > getPlanRank(planId) ? "PENDING_UPGRADE" : "PENDING_DOWNGRADE";
      } else {
        state = "PENDING_CHANGE";
      }
    }

    const lockStale = lock?.expiresAt && lock.expiresAt < now - PLAN_CHANGE_LOCK_TTL_MS;
    if (!subscriptionId && billingActive) {
      state = "ERROR_NEEDS_SUPPORT";
    } else if (lockStale && state === "ACTIVE") {
      state = "ERROR_NEEDS_SUPPORT";
    }

    const history = sanitizeHistory(user?.planChangeHistory);

    return res.json({
      success: true,
      state,
      planId,
      pendingPlan,
      billingStatus: status || null,
      billingActive,
      subscriptionId: subscriptionId || null,
      scheduledChange,
      scheduledEffectiveDate,
      cancelAtPeriodEnd,
      cooldownUntil: cooldownUntil || null,
      lock: lock || null,
      request: {
        lastRequestId: user?.planChangeRequestId ?? null,
        lastResult: user?.planChangeRequestResult ?? null,
      },
      history,
    });
  } catch (err: any) {
    console.error("GET /api/billing/status failed:", err?.message || err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
