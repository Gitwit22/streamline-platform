import { Router } from "express";
import { PLANS } from "../usagePlans";
import { PLAN_IDS, PlanId, isPlanId } from "../types/plan";
import { firestore } from "../firebaseAdmin";
import { normalizePlan } from "../lib/normalizePlan";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const snap = await firestore.collection("plans").get();
    const mapped = snap.docs.map((d) => {
      const data = (d.data() as any) || {};
      const id = d.id;
      const plan = normalizePlan(id, data);

      const visibility = plan.visibility;

      const priceNumber = Number(plan.priceMonthly ?? 0);

      // Determine if there is a valid Stripe price configured for paid plans
      let hasStripePrice = false;
      if (isPlanId(id)) {
        if (id === "starter") {
          hasStripePrice = !!process.env.STRIPE_PRICE_STARTER;
        } else if (id === "pro") {
          hasStripePrice = !!process.env.STRIPE_PRICE_PRO;
        } else if (id === "basic") {
          // Support canonical env var for 'basic' just like starter/pro
          hasStripePrice = !!process.env.STRIPE_PRICE_BASIC;
        } else if (typeof data.stripePriceId === "string" && data.stripePriceId.trim().length > 0) {
          hasStripePrice = true;
        }
      } else if (typeof data.stripePriceId === "string" && data.stripePriceId.trim().length > 0) {
        hasStripePrice = true;
      }

      const planObj = {
        id: plan.id,
        name: plan.name,
        price: priceNumber,
        description: plan.description,
        visibility,
        // Expose a hint for admin clients (not used by public filtering; kept here for clarity)
        billable: id === "free" ? true : (priceNumber > 0 && hasStripePrice),
        limits: {
          monthlyMinutesIncluded: plan.limits.monthlyMinutes,
          maxGuests: plan.limits.maxGuests,
          rtmpDestinationsMax: plan.limits.rtmpDestinationsMax,
          maxSessionMinutes: plan.limits.maxSessionMinutes,
          maxRecordingMinutesPerClip: plan.limits.maxRecordingMinutesPerClip,
          maxHoursPerMonth: plan.limits.maxHoursPerMonth,
        },
        features: {
          recording: !!plan.features.recording,
          rtmp: !!plan.features.rtmp,
          multistream: !!plan.features.multistream,
          // Advanced permissions have been removed; all accounts use
          // the simple Participant/Co-host model.
          advancedPermissions: false,
        },
        editing: {
          access: !!data.editing?.access,
          maxProjects: Number(data.editing?.maxProjects ?? 0),
          maxStorageGB: (() => {
            const fromGb = data.editing?.maxStorageGB;
            const fromBytes = data.editing?.maxStorageBytes;
            if (fromGb !== undefined && fromGb !== null) return Number(fromGb);
            if (fromBytes !== undefined && fromBytes !== null) return Math.round(Number(fromBytes) / (1024 * 1024 * 1024));
            return 0;
          })(),
        },
      };

      return planObj;
    });

    // Filter to only publicly available and billable plans for this public endpoint
    const publicPlans = mapped.filter((p: any) => {
      if (p.visibility !== "public") return false;
      if (p.id === "free") return true;
      return p.price > 0 && p.billable === true;
    });

    // If no plan docs, fall back to ids
    if (!mapped.length) return res.json({ plans: PLANS });

    // If filter removed everything, fall back to mapped to avoid empty payloads
    const plansToReturn = publicPlans.length ? publicPlans : mapped;
    return res.json({ plans: plansToReturn });
  } catch (err: any) {
    console.error("/api/plans failed, returning fallback IDs:", err?.message || err);
    return res.json({ plans: PLANS });
  }
});

// Editor/diagnostic endpoint for a single plan in canonical shape
router.get("/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!id) return res.status(400).json({ error: "missing_plan_id" });

    const snap = await firestore.collection("plans").doc(id).get();
    if (!snap.exists) return res.status(404).json({ error: "plan_not_found" });

    const plan = normalizePlan(id, snap.data() || {});
    return res.json({ plan });
  } catch (err: any) {
    console.error("/api/plans/:id failed", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
