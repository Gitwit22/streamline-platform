/**
 * StreamLine Complete Plans Seed Script
 *
 * Seeds / updates the `plans` collection in Firestore with ALL fields:
 *   - features (recording, rtmp, multistream, hls, overages…)
 *   - limits   (monthlyMinutes, maxGuests, transcodeMinutes, destinations…)
 *   - editing  (access, maxProjects, maxStorageGB…)
 *   - metadata (name, description, priceMonthly, visibility)
 *
 * Run from the project ROOT folder:
 *   node seed-plans.js
 *
 * Uses merge: true so existing fields that are NOT in this script
 * (e.g. Stripe-related fields set by admin UI) are preserved.
 */

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

// Load .env from the server directory (same as the running server)
require("dotenv").config({ path: path.resolve(__dirname, "streamline-server", ".env") });

function loadServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) return JSON.parse(rawJson);

  const rawB64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (rawB64) return JSON.parse(Buffer.from(rawB64, "base64").toString("utf8"));

  const filePath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.resolve(__dirname, "streamline-server", "firebaseServiceAccount.json");

  if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));

  throw new Error("Firebase service account not found. Check .env or place firebaseServiceAccount.json in streamline-server/.");
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount()),
  });
}

const db = admin.firestore();

// ─── Plan Definitions ────────────────────────────────────────────────
// Every plan that exists in PLAN_IDS must have a document here.
// Fields match what normalizePlan / featureAccess / effectiveEntitlements expect.

const PLANS = {
  free: {
    name: "Free",
    description: "Get started – basic in-room experience",
    priceMonthly: 0,
    visibility: "public",
    features: {
      recording: false,
      rtmp: false,
      multistream: false,
      dualRecording: false,
      advancedPermissions: false,
      allowsOverages: false,
      canHls: false,
      hls: false,
      hlsEnabled: false,
      hlsCustomizationEnabled: false,
      monetization: false,
      payPerView: false,
    },
    limits: {
      monthlyMinutesIncluded: 180,   // 3 hours
      transcodeMinutes: 0,
      maxGuests: 2,
      rtmpDestinationsMax: 0,
      maxSessionMinutes: 60,
      maxRecordingMinutesPerClip: 0,
      maxHoursPerMonth: 3,
    },
    caps: {
      hlsMaxMinutesPerSession: null,
    },
    editing: {
      access: false,
      maxProjects: 0,
      maxStorageGB: 0,
      maxStorageBytes: 0,
    },
  },

  basic: {
    name: "Basic",
    description: "For hobbyists – recording & basic editing",
    priceMonthly: 15,
    visibility: "public",
    features: {
      recording: true,
      rtmp: false,
      multistream: false,
      dualRecording: false,
      advancedPermissions: false,
      allowsOverages: false,
      canHls: false,
      hls: false,
      hlsEnabled: false,
      hlsCustomizationEnabled: false,
      monetization: false,
      payPerView: false,
    },
    limits: {
      monthlyMinutesIncluded: 360,   // 6 hours
      transcodeMinutes: 0,
      maxGuests: 4,
      rtmpDestinationsMax: 0,
      maxSessionMinutes: 120,
      maxRecordingMinutesPerClip: 30,
      maxHoursPerMonth: 6,
    },
    caps: {
      hlsMaxMinutesPerSession: null,
    },
    editing: {
      access: true,
      maxProjects: 2,
      maxStorageGB: 3,
      maxStorageBytes: 3 * 1024 * 1024 * 1024,
    },
  },

  starter: {
    name: "Starter",
    description: "For growing creators – streaming, recording & editing",
    priceMonthly: 29,
    visibility: "public",
    features: {
      recording: true,
      rtmp: true,
      multistream: true,
      dualRecording: false,
      advancedPermissions: false,
      allowsOverages: false,
      canHls: false,
      hls: false,
      hlsEnabled: false,
      hlsCustomizationEnabled: false,
      monetization: false,
      payPerView: false,
    },
    limits: {
      monthlyMinutesIncluded: 600,   // 10 hours
      transcodeMinutes: 60,
      maxGuests: 5,
      rtmpDestinationsMax: 3,
      maxSessionMinutes: 240,
      maxRecordingMinutesPerClip: 15,
      maxHoursPerMonth: 10,
    },
    caps: {
      hlsMaxMinutesPerSession: null,
    },
    editing: {
      access: true,
      maxProjects: 5,
      maxStorageGB: 15,
      maxStorageBytes: 15 * 1024 * 1024 * 1024,
    },
  },

  pro: {
    name: "Pro",
    description: "For professionals – full suite with HLS & overages",
    priceMonthly: 79,
    visibility: "public",
    features: {
      recording: true,
      rtmp: true,
      multistream: true,
      dualRecording: true,
      advancedPermissions: false,
      allowsOverages: true,
      canHls: true,
      hls: true,
      hlsEnabled: true,
      hlsCustomizationEnabled: true,
      monetization: true,
      payPerView: true,
    },
    limits: {
      monthlyMinutesIncluded: 2400,  // 40 hours
      transcodeMinutes: 300,
      maxGuests: 10,
      rtmpDestinationsMax: 3,
      maxSessionMinutes: 480,
      maxRecordingMinutesPerClip: 60,
      maxHoursPerMonth: 40,
    },
    caps: {
      hlsMaxMinutesPerSession: null,
    },
    editing: {
      access: true,
      maxProjects: 10,
      maxStorageGB: 25,
      maxStorageBytes: 25 * 1024 * 1024 * 1024,
    },
  },

  enterprise: {
    name: "Enterprise",
    description: "Custom enterprise solution – configured per account",
    priceMonthly: 0,
    visibility: "admin",
    features: {
      recording: true,
      rtmp: true,
      multistream: true,
      dualRecording: true,
      advancedPermissions: false,
      allowsOverages: true,
      canHls: true,
      hls: true,
      hlsEnabled: true,
      hlsCustomizationEnabled: true,
      monetization: true,
      payPerView: true,
    },
    limits: {
      monthlyMinutesIncluded: 6000,
      transcodeMinutes: 1000,
      maxGuests: 50,
      rtmpDestinationsMax: 10,
      maxSessionMinutes: 720,
      maxRecordingMinutesPerClip: 120,
      maxHoursPerMonth: 100,
    },
    caps: {
      hlsMaxMinutesPerSession: null,
    },
    editing: {
      access: true,
      maxProjects: 0,
      maxStorageGB: 0,
      maxStorageBytes: 0,
    },
    customizable: true,
    contactSales: true,
  },

  internal_unlimited: {
    name: "Internal Unlimited",
    description: "Internal testing – all features unlocked",
    priceMonthly: 0,
    visibility: "admin",
    features: {
      recording: true,
      rtmp: true,
      multistream: true,
      dualRecording: true,
      advancedPermissions: false,
      allowsOverages: true,
      canHls: true,
      hls: true,
      hlsEnabled: true,
      hlsCustomizationEnabled: true,
      monetization: true,
      payPerView: true,
    },
    limits: {
      monthlyMinutesIncluded: 99999,
      transcodeMinutes: 99999,
      maxGuests: 100,
      rtmpDestinationsMax: 10,
      maxSessionMinutes: 1440,
      maxRecordingMinutesPerClip: 999,
      maxHoursPerMonth: 9999,
    },
    caps: {
      hlsMaxMinutesPerSession: null,
    },
    editing: {
      access: true,
      maxProjects: 999,
      maxStorageGB: 100,
      maxStorageBytes: 100 * 1024 * 1024 * 1024,
    },
  },
};

// ─── Execution ───────────────────────────────────────────────────────

async function seedPlans() {
  console.log("\n=== StreamLine Plan Seeder ===\n");

  const results = { created: [], updated: [], errors: [] };

  for (const [planId, planData] of Object.entries(PLANS)) {
    try {
      const docRef = db.collection("plans").doc(planId);
      const existingDoc = await docRef.get();

      const payload = {
        ...planData,
        id: planId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (!existingDoc.exists) {
        payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
      }

      // merge: true preserves fields like stripePriceId set by admin UI
      await docRef.set(payload, { merge: true });

      if (existingDoc.exists) {
        console.log(`  [update]  ${planId} (${planData.name})`);
        results.updated.push(planId);
      } else {
        console.log(`  [create]  ${planId} (${planData.name})`);
        results.created.push(planId);
      }
    } catch (err) {
      console.error(`  [ERROR]   ${planId}: ${err.message}`);
      results.errors.push({ planId, error: err.message });
    }
  }

  console.log("\n--- Summary ---");
  console.log(`  Created : ${results.created.length} (${results.created.join(", ") || "none"})`);
  console.log(`  Updated : ${results.updated.length} (${results.updated.join(", ") || "none"})`);
  console.log(`  Errors  : ${results.errors.length}`);

  if (results.errors.length > 0) {
    console.log("\n  Errors:");
    results.errors.forEach((e) => console.log(`    - ${e.planId}: ${e.error}`));
  }

  console.log("\nDone.\n");
  process.exit(results.errors.length > 0 ? 1 : 0);
}

seedPlans();
