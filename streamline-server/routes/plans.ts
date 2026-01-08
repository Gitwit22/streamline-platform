import { Router } from "express";
import { PLANS } from "../usagePlans";
import { firestore } from "../firebaseAdmin";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const snap = await firestore.collection("plans").get();
    const mapped = snap.docs.map((d) => {
      const data = (d.data() as any) || {};
      const features = (data.features || {}) as any;
      const limits = (data.limits || {}) as any;
      const id = d.id;

      // Determine visibility for public exposure
      // Defaults: 'public' unless explicitly hidden or admin-only; enterprise/internal default to admin
      const visibility: "public" | "hidden" | "admin" = (data.visibility as any) ||
        ((id === "enterprise" || id === "internal") ? "admin" : "public");
      const hidden = data.hidden === true;

      const monthlyMinutesIncluded = Number(
        limits.participantMinutes ?? limits.monthlyMinutes ?? 0
      );

      const priceNumber = Number(data.priceMonthly ?? data.price ?? 0);

      // Determine if there is a valid Stripe price configured for paid plans
      let hasStripePrice = false;
      if (id === "starter") hasStripePrice = !!process.env.STRIPE_PRICE_STARTER;
      else if (id === "pro") hasStripePrice = !!process.env.STRIPE_PRICE_PRO;
      else if (typeof data.stripePriceId === "string" && data.stripePriceId.trim().length > 0) hasStripePrice = true;

      const planObj = {
        id,
        name: data.name || id,
        price: priceNumber,
        description: data.description || "",
        visibility,
        // Expose a hint for admin clients (not used by public filtering; kept here for clarity)
        billable: id === "free" ? true : (priceNumber > 0 && hasStripePrice),
        limits: {
          monthlyMinutesIncluded,
          maxGuests: Number(
            limits.maxGuests ?? (id === "pro" ? 10 : id === "starter" ? 2 : 1)
          ),
          rtmpDestinationsMax: Number(
            limits.maxDestinations ?? limits.rtmpDestinations ?? (id === "pro" ? 5 : id === "starter" ? 2 : 1)
          ),
          maxSessionMinutes: Number(
            limits.maxSessionMinutes ?? (id === "pro" ? 180 : id === "starter" ? 60 : 30)
          ),
          maxHoursPerMonth: Number(
            limits.maxHoursPerMonth ?? (monthlyMinutesIncluded > 0 ? Math.floor(monthlyMinutesIncluded / 60) : 0)
          ),
        },
        features: {
          recording: !!(features.recording ?? (id !== "free")),
          rtmp: !!(features.rtmp ?? features.rtmpMultistream ?? false),
          multistream: !!(features.multistream ?? features.rtmpMultistream ?? false),
        },
        editing: {
          access: !!(data.editing?.access ?? (id !== "free")),
          maxProjects: Number(data.editing?.maxProjects ?? (id === "pro" ? 50 : id === "starter" ? 5 : 0)),
          maxStorageGB: Number(data.editing?.maxStorageGB ?? (id === "pro" ? 100 : id === "starter" ? 10 : 0)),
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
    return res.json({ plans: publicPlans });
  } catch (err: any) {
    console.error("/api/plans failed, returning fallback IDs:", err?.message || err);
    return res.json({ plans: PLANS });
  }
});

export default router;
