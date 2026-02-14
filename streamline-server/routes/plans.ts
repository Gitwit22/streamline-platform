import { Router } from "express";
import { PLANS } from "../usagePlans";
import { PLAN_IDS, PlanId, isPlanId } from "../types/plan";
import { firestore } from "../firebaseAdmin";
import { normalizePlan } from "../lib/normalizePlan";
import { getPlatformTranscodeEnabled } from "../lib/platformFlags";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const [
      hlsUiSnap,
      recordingUiSnap,
      contentLibrarySnap,
      projectsSnap,
      editorSnap,
      myContentSnap,
      myContentRecordingsSnap,
    ] = await Promise.all([
      firestore.collection("featureFlags").doc("hlsSettingsTab").get(),
      firestore.collection("featureFlags").doc("recording").get(),
      firestore.collection("featureFlags").doc("contentLibraryEnabled").get(),
      firestore.collection("featureFlags").doc("projectsEnabled").get(),
      firestore.collection("featureFlags").doc("editorEnabled").get(),
      firestore.collection("featureFlags").doc("myContentEnabled").get(),
      firestore.collection("featureFlags").doc("myContentRecordingsEnabled").get(),
    ]);

    const hlsUiData = hlsUiSnap.exists ? ((hlsUiSnap.data() as any) || {}) : {};
    const recordingUiData = recordingUiSnap.exists ? ((recordingUiSnap.data() as any) || {}) : {};
    const contentLibraryData = contentLibrarySnap.exists ? ((contentLibrarySnap.data() as any) || {}) : {};
    const projectsData = projectsSnap.exists ? ((projectsSnap.data() as any) || {}) : {};
    const editorData = editorSnap.exists ? ((editorSnap.data() as any) || {}) : {};
    const myContentData = myContentSnap.exists ? ((myContentSnap.data() as any) || {}) : {};
    const myContentRecordingsData = myContentRecordingsSnap.exists
      ? ((myContentRecordingsSnap.data() as any) || {})
      : {};

    const hlsEnabled = hlsUiData.enabled === undefined ? true : !!hlsUiData.enabled;
    const recordingEnabled = recordingUiData.enabled === undefined ? true : !!recordingUiData.enabled;
    const transcodeEnabled = getPlatformTranscodeEnabled();

    // New segmented flags default to DISABLED when missing.
    const contentLibraryEnabled = contentLibraryData.enabled === true;
    const projectsEnabled = projectsData.enabled === true;
    const editorEnabled = editorData.enabled === true;

    // My Content umbrella + sub-feature flags default to DISABLED when missing.
    const myContentEnabled = myContentData.enabled === true;
    const myContentRecordingsEnabled = myContentRecordingsData.enabled === true;

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
          transcodeMinutes: plan.limits.transcodeMinutes ?? data.limits?.transcodeMinutes ?? data.transcodeMinutes ?? data.minutes ?? 0,
          maxGuests: plan.limits.maxGuests,
          rtmpDestinationsMax: plan.limits.rtmpDestinationsMax,
          maxSessionMinutes: plan.limits.maxSessionMinutes,
          maxRecordingMinutesPerClip: plan.limits.maxRecordingMinutesPerClip,
          maxHoursPerMonth: plan.limits.maxHoursPerMonth,
        },
        features: {
          recording: !!plan.features.recording,
          dualRecording: !!(data.features?.dualRecording ?? data.dualRecordingEnabled),
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
        },
        caps: {
          hlsMaxMinutesPerSession: plan.caps?.hlsMaxMinutesPerSession ?? null,
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
    if (!mapped.length) {
      return res.json({
        plans: PLANS,
        platformFlags: {
          hlsEnabled,
          hlsSettingsTab: hlsEnabled,
          recordingEnabled,
          transcodeEnabled,
          contentLibraryEnabled,
          projectsEnabled,
          editorEnabled,
          myContentEnabled,
          myContentRecordingsEnabled,
        },
      });
    }

    // If filter removed everything, fall back to mapped to avoid empty payloads
    const plansToReturn = publicPlans.length ? publicPlans : mapped;
    return res.json({
      plans: plansToReturn,
      platformFlags: {
        hlsEnabled,
        hlsSettingsTab: hlsEnabled,
        recordingEnabled,
        transcodeEnabled,
        contentLibraryEnabled,
        projectsEnabled,
        editorEnabled,
        myContentEnabled,
        myContentRecordingsEnabled,
      },
    });
  } catch (err: any) {
    console.error("/api/plans failed, returning fallback IDs:", err?.message || err);
    return res.json({
      plans: PLANS,
      platformFlags: {
        hlsEnabled: true,
        hlsSettingsTab: true,
        recordingEnabled: true,
        transcodeEnabled: getPlatformTranscodeEnabled(),
        contentLibraryEnabled: false,
        projectsEnabled: false,
        editorEnabled: false,
        myContentEnabled: false,
        myContentRecordingsEnabled: false,
      },
    });
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
