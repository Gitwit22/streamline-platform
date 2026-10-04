import { Router } from "express";
import { PLANS } from "../usagePlans";
import { PLAN_IDS, PlanId, isPlanId } from "../types/plan";
import { firestore } from "../firebaseAdmin";
import { normalizePlan } from "../lib/normalizePlan";
import { defaultPlatformFlags, getPlatformFlags, toPlatformFlagsPayload } from "../lib/entitlements";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    // Single platform-flag source (same values /api/account/me returns).
    const platformFlags = toPlatformFlagsPayload(await getPlatformFlags());

    const snap = await firestore.collection("plans").get();
    const mapped = snap.docs.map((d) => {
      const data = (d.data() as any) || {};
      const id = d.id;
      const plan = normalizePlan(id, data);
      const v2 = plan.v2; // null = unlimited, 0 = none

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
          transcodeMinutes: plan.limits.transcodeMinutes ?? data.limits?.transcodeMinutes ?? data.transcodeMinutes ?? data.minutes ?? 0,
          maxGuests: plan.limits.maxGuests,
          rtmpDestinationsMax: plan.limits.rtmpDestinationsMax,
          maxSessionMinutes: plan.limits.maxSessionMinutes,
          maxRecordingMinutesPerClip: plan.limits.maxRecordingMinutesPerClip,
          maxHoursPerMonth: plan.limits.maxHoursPerMonth,
        },
        features: {
          recording: !!plan.features.recording,
          dualRecording: !!v2.features.dualRecording,
          rtmp: !!plan.features.rtmp,
          multistream: !!plan.features.multistream,
          // Advanced permissions have been removed; all accounts use
          // the simple Participant/Co-host model.
          advancedPermissions: false,

          // Pro-only capability: allow actions past included minutes.
          // Billing is not handled here; this flag only indicates that
          // server-side overage totals may be recorded.
          allowsOverages: !!plan.features.allowsOverages,

          // HLS flags are used by pricing/marketing UI and should reflect
          // admin-edited plan settings.
          canHls: !!plan.features.canHls,
          hls: !!plan.features.hls,
          hlsEnabled: !!plan.features.hlsEnabled,
          hlsCustomizationEnabled: !!plan.features.hlsCustomizationEnabled,

          // Monetization / PPV plan-level entitlements
          monetization: !!plan.features.monetization,
          payPerView: !!plan.features.payPerView,
        },
        caps: {
          hlsMaxMinutesPerSession: plan.caps?.hlsMaxMinutesPerSession ?? null,
        },
        // LEGACY ENCODING above/below (0 = no cap) for older pricing UIs.
        editing: {
          access: !!v2.features.editing,
          maxProjects: v2.limits.projects ?? 0,
          maxStorageGB: v2.limits.storageBytes === null ? 0 : Math.round(v2.limits.storageBytes / (1024 * 1024 * 1024)),
        },
        // Canonical entitlements of this plan (null = unlimited, 0 = none).
        entitlements: {
          limitsVersion: v2.limitsVersion,
          features: v2.features,
          limits: v2.limits,
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
    if (!mapped.length) {
      return res.json({ plans: PLANS, platformFlags });
    }

    // If filter removed everything, fall back to mapped to avoid empty payloads
    const plansToReturn = publicPlans.length ? publicPlans : mapped;
    return res.json({ plans: plansToReturn, platformFlags });
  } catch (err: any) {
    console.error("/api/plans failed, returning fallback IDs:", err?.message || err);
    // Same defaults table as every other surface.
    return res.json({ plans: PLANS, platformFlags: toPlatformFlagsPayload(defaultPlatformFlags()) });
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
    const { v2, ...legacy } = plan;
    return res.json({
      plan: legacy,
      entitlements: { limitsVersion: v2.limitsVersion, features: v2.features, limits: v2.limits },
    });
  } catch (err: any) {
    console.error("/api/plans/:id failed", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
