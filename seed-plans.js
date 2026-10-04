/**
 * StreamLine Complete Plans Seed Script
 *
 * Seeds / updates the `plans` collection in Firestore in the v2 entitlement
 * format (limitsVersion: 2 — null = UNLIMITED, 0 = NONE):
 *   - features (multistream, recording, hls, editing, projects, overages…)
 *   - limits   (monthlyStreamingMinutes, destinations, guests, storageBytes…)
 *   - metadata (name, description, priceMonthly, visibility)
 *
 * Run from the project ROOT folder. It writes to whatever Firebase project the
 * credentials point at, so both flags are required:
 *   node seed-plans.js --project=<firebase-project-id> --confirm
 *
 * Without them it prints the target project and the plans it would write,
 * then exits without touching Firestore.
 *
 * Uses mergeFields so existing fields that are NOT in this script
 * (e.g. Stripe-related fields set by admin UI) are preserved.
 */

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

// Load .env from the server directory (same as the running server)
require("dotenv").config({ path: path.resolve(__dirname, "streamline-server", ".env") });

function parseJsonSecret(raw, source) {
  try {
    return JSON.parse(raw);
  } catch {
    // Don't echo the parse error: it can contain private key fragments.
    throw new Error(`${source} is not valid JSON`);
  }
}

function loadServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) return parseJsonSecret(rawJson, "FIREBASE_SERVICE_ACCOUNT_JSON");

  const rawB64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (rawB64) {
    const standard = rawB64.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    return parseJsonSecret(Buffer.from(standard, "base64").toString("utf8"), "FIREBASE_SERVICE_ACCOUNT_BASE64");
  }

  const filePath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.resolve(__dirname, "streamline-server", "firebaseServiceAccount.json");

  if (fs.existsSync(filePath)) return parseJsonSecret(fs.readFileSync(filePath, "utf8"), filePath);

  throw new Error("Firebase service account not found. Check .env or place firebaseServiceAccount.json in streamline-server/.");
}

// ─── Safety guard ────────────────────────────────────────────────────
// Require --confirm and a --project that matches the credentials, so this
// can't silently write to the wrong Firestore.

const args = process.argv.slice(2);
const confirmed = args.includes("--confirm");
const projectArg = (args.find((a) => a.startsWith("--project=")) || "").slice("--project=".length).trim();

const serviceAccount = loadServiceAccount();
if (typeof serviceAccount.private_key === "string") {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
}
const targetProjectId = serviceAccount.project_id || serviceAccount.projectId || "(unknown)";

let db = null;

// ─── Plan Definitions ────────────────────────────────────────────────
// Every plan that exists in PLAN_IDS must have a document here.
// v2 convention (limitsVersion: 2): null = UNLIMITED, 0 = NONE.
// Keep in sync with streamline-server/lib/entitlements/planCatalog.ts.

const GB = 1024 * 1024 * 1024;

function features(on) {
  return {
    multistream: false,
    recording: false,
    dualRecording: false,
    hls: false,
    hlsCustomization: false,
    editing: false,
    projects: false,
    contentLibrary: false,
    monetization: false,
    payPerView: false,
    invisibleHost: false,
    overages: false,
    watermark: false,
    ...on,
  };
}

const ALL_ON = features({
  multistream: true,
  recording: true,
  dualRecording: true,
  hls: true,
  hlsCustomization: true,
  editing: true,
  projects: true,
  contentLibrary: true,
  monetization: true,
  payPerView: true,
  invisibleHost: true,
  overages: true,
});

const PLANS = {
  free: {
    limitsVersion: 2,
    name: "Free",
    description: "Get started – basic in-room experience",
    priceMonthly: 0,
    visibility: "public",
    features: features({}),
    limits: {
      monthlyStreamingMinutes: 180,
      destinations: 0,
      guests: 2,
      storageBytes: 0,
      recordingMinutesPerClip: 0,
      maxSessionMinutes: 60,
      projects: 0,
      hlsMaxMinutesPerSession: null,
      maxPresetId: null,
    },
  },

  basic: {
    limitsVersion: 2,
    name: "Basic",
    description: "For hobbyists – recording & basic editing",
    priceMonthly: 15,
    visibility: "public",
    features: features({ recording: true, editing: true, projects: true, contentLibrary: true }),
    limits: {
      monthlyStreamingMinutes: 360,
      destinations: 0,
      guests: 4,
      storageBytes: 3 * GB,
      recordingMinutesPerClip: 30,
      maxSessionMinutes: 120,
      projects: 2,
      hlsMaxMinutesPerSession: null,
      maxPresetId: null,
    },
  },

  starter: {
    limitsVersion: 2,
    name: "Starter",
    description: "For growing creators – streaming, recording & editing",
    priceMonthly: 29,
    visibility: "public",
    features: features({ multistream: true, recording: true, editing: true, projects: true, contentLibrary: true }),
    limits: {
      monthlyStreamingMinutes: 600,
      destinations: 3,
      guests: 5,
      storageBytes: 15 * GB,
      recordingMinutesPerClip: 15,
      maxSessionMinutes: 240,
      projects: 5,
      hlsMaxMinutesPerSession: null,
      maxPresetId: null,
    },
  },

  pro: {
    limitsVersion: 2,
    name: "Pro",
    description: "For professionals – full suite with HLS & overages",
    priceMonthly: 79,
    visibility: "public",
    features: { ...ALL_ON },
    limits: {
      monthlyStreamingMinutes: 2400,
      destinations: 3,
      guests: 10,
      storageBytes: 25 * GB,
      recordingMinutesPerClip: 60,
      maxSessionMinutes: 480,
      projects: 10,
      hlsMaxMinutesPerSession: null,
      maxPresetId: null,
    },
  },

  enterprise: {
    limitsVersion: 2,
    name: "Enterprise",
    description: "Custom enterprise solution – configured per account",
    priceMonthly: 0,
    visibility: "admin",
    features: { ...ALL_ON },
    limits: {
      monthlyStreamingMinutes: 6000,
      destinations: 10,
      guests: 50,
      storageBytes: null,
      recordingMinutesPerClip: 120,
      maxSessionMinutes: 720,
      projects: null,
      hlsMaxMinutesPerSession: null,
      maxPresetId: null,
    },
    customizable: true,
    contactSales: true,
  },

  internal_unlimited: {
    limitsVersion: 2,
    name: "Internal Unlimited",
    description: "Internal testing – all features unlocked",
    priceMonthly: 0,
    visibility: "admin",
    features: { ...ALL_ON },
    limits: {
      monthlyStreamingMinutes: null,
      destinations: null,
      guests: null,
      storageBytes: null,
      recordingMinutesPerClip: null,
      maxSessionMinutes: null,
      projects: null,
      hlsMaxMinutesPerSession: null,
      maxPresetId: null,
    },
  },
};

// ─── Execution ───────────────────────────────────────────────────────

async function seedPlans() {
  console.log("\n=== StreamLine Plan Seeder ===\n");
  console.log(`  Target Firebase project: ${targetProjectId}`);
  console.log(`  Plans: ${Object.keys(PLANS).join(", ")}\n`);

  if (!confirmed || !projectArg) {
    console.log("  Dry run: nothing was written.");
    console.log(`  To write these plans, run: node seed-plans.js --project=${targetProjectId} --confirm\n`);
    process.exit(confirmed ? 1 : 0);
  }
  if (projectArg !== targetProjectId) {
    console.error(`  Refusing to run: --project=${projectArg} does not match the credentials (${targetProjectId}).\n`);
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  db = admin.firestore();

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

      // mergeFields replaces features/limits wholesale (no stale legacy keys)
      // while preserving fields like stripePriceId set by the admin UI.
      await docRef.set(payload, { mergeFields: Object.keys(payload) });

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
