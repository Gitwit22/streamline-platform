/**
 * StreamLine Plan Train Audit
 * Confirms: auth -> /me -> entitlements -> (manual upgrade) -> /me changes
 *
 * Usage:
 *   node audit-plan-train.mjs
 *
 * Env:
 *   API_BASE_URL=https://your-api-domain.com
 *   STREAMLINE_TOKEN=eyJ...
 *
 * Optional expectations:
 *   EXPECT_BEFORE_PLAN_ID=free
 *   EXPECT_AFTER_PLAN_ID=pro
 *   EXPECT_BEFORE_HLS=false
 *   EXPECT_AFTER_HLS=true
 *   EXPECT_BEFORE_RECORDING=false
 *   EXPECT_AFTER_RECORDING=true
 *
 * Optional (recommended):
 *   CHECK_GUARD=true        # also reads /api/billing/status and reports cooldown/lock state
 */

const API_BASE_URL_RAW = process.env.API_BASE_URL;
const TOKEN = process.env.STREAMLINE_TOKEN;

if (!API_BASE_URL_RAW || !TOKEN) {
  console.error("Missing env vars. Set API_BASE_URL and STREAMLINE_TOKEN.");
  process.exit(1);
}

const API_BASE_URL = String(API_BASE_URL_RAW).replace(/\/+$/, "");

const expectBool = (key) => {
  if (!(key in process.env)) return undefined;
  const v = String(process.env[key]).trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
};

const expectStr = (key) => {
  if (!(key in process.env)) return undefined;
  const v = String(process.env[key]).trim();
  return v.length ? v : undefined;
};

const EXPECT = {
  before: {
    planId: expectStr("EXPECT_BEFORE_PLAN_ID"),
    hls: expectBool("EXPECT_BEFORE_HLS"),
    recording: expectBool("EXPECT_BEFORE_RECORDING"),
  },
  after: {
    planId: expectStr("EXPECT_AFTER_PLAN_ID"),
    hls: expectBool("EXPECT_AFTER_HLS"),
    recording: expectBool("EXPECT_AFTER_RECORDING"),
  },
};

const CHECK_GUARD = String(process.env.CHECK_GUARD || "").toLowerCase() === "true";

async function apiGet(path) {
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return { ok: res.ok, status: res.status, json };
}

function pickEntitlements(meJson) {
  // Server shape (current): /api/account/me
  // - planId: string
  // - effectiveEntitlements: { planId, planName, features: { recording, canHls, hlsEnabled, ... } }
  const eff = meJson?.effectiveEntitlements || null;
  const features = eff?.features || null;

  const planId =
    String(
      meJson?.planId ??
        eff?.planId ??
        meJson?.account?.planId ??
        "unknown"
    ) || "unknown";

  const planName =
    String(
      eff?.planName ??
        meJson?.planName ??
        meJson?.plan?.name ??
        planId
    ) || planId;

  const hls =
    features?.canHls ??
    features?.hlsEnabled ??
    features?.hls ??
    meJson?.platformFlags?.hlsEnabled;

  const recording =
    features?.recording ??
    meJson?.platformFlags?.recordingEnabled;

  return {
    planId,
    planName,
    hls: typeof hls === "boolean" ? hls : undefined,
    recording: typeof recording === "boolean" ? recording : undefined,
  };
}

function assertExpected(label, actual, expected) {
  if (expected === undefined) return { pass: true, note: "no expectation set" };
  const pass = actual === expected;
  return {
    pass,
    note: pass ? "ok" : `expected ${expected} but got ${actual}`,
  };
}

function printSnapshot(tag, snap) {
  console.log(`\n=== ${tag} ===`);
  console.log(`PlanId:   ${snap.planId}`);
  console.log(`PlanName: ${snap.planName}`);
  console.log(`HLS:      ${snap.hls}`);
  console.log(`Recording:${snap.recording}`);
}

function printBilling(tag, billingJson) {
  if (!billingJson || typeof billingJson !== "object") return;

  const status = billingJson?.status ?? billingJson?.billingStatus ?? billingJson?.subscriptionStatus;
  const billingActive = billingJson?.billingActive;
  const scheduledChange = billingJson?.scheduledChange;
  const scheduledEffectiveDate = billingJson?.scheduledEffectiveDate ?? billingJson?.effectiveDate;

  const cooldownUntil = billingJson?.cooldownUntil;
  const cooldownActive = billingJson?.cooldownActive;
  const lockUntil = billingJson?.lockUntil;
  const lockActive = billingJson?.lockActive;

  console.log(`\n--- ${tag} (billing/status) ---`);
  console.log(`Status:            ${status}`);
  console.log(`Billing active:    ${billingActive}`);
  console.log(`Scheduled change:  ${scheduledChange}`);
  console.log(`Scheduled date:    ${scheduledEffectiveDate}`);
  if (CHECK_GUARD) {
    console.log(`Cooldown active:   ${cooldownActive}`);
    console.log(`Cooldown until:    ${cooldownUntil}`);
    console.log(`Lock active:       ${lockActive}`);
    console.log(`Lock until:        ${lockUntil}`);
  }
}

function didMeaningfullyChange(before, after) {
  if (!before || !after) return false;
  return (
    before.planId !== after.planId ||
    before.hls !== after.hls ||
    before.recording !== after.recording
  );
}

async function main() {
  console.log("Running StreamLine Plan Train Audit...");
  console.log(`API: ${API_BASE_URL}`);

  // 0) Auth sanity: /api/auth/me should work with your JWT
  const authMe = await apiGet("/api/auth/me");
  if (!authMe.ok) {
    console.error("FAILED: /api/auth/me", authMe.status, authMe.json);
    process.exit(2);
  }
  console.log("\n✓ Auth OK (/api/auth/me)");
  console.log({
    id: authMe.json?.id,
    email: authMe.json?.email,
    planId: authMe.json?.planId,
    billingEnabled: authMe.json?.billingEnabled,
    platformBillingEnabled: authMe.json?.platformBillingEnabled,
    effectiveBillingEnabled: authMe.json?.effectiveBillingEnabled,
    billingMode: authMe.json?.billingMode,
    isAdmin: authMe.json?.isAdmin,
  });

  // 1) Baseline read: /api/account/me (plan + entitlements)
  const me1 = await apiGet("/api/account/me");
  if (!me1.ok) {
    console.error("FAILED: /api/account/me", me1.status, me1.json);
    process.exit(2);
  }

  const before = pickEntitlements(me1.json);
  printSnapshot("BEFORE", before);

  const bPlan = assertExpected("BEFORE planId", before.planId, EXPECT.before.planId);
  const bHls = assertExpected("BEFORE HLS", before.hls, EXPECT.before.hls);
  const bRec = assertExpected("BEFORE Recording", before.recording, EXPECT.before.recording);
  if (!bPlan.pass || !bHls.pass || !bRec.pass) {
    console.warn("\nBaseline expectation mismatch:");
    if (!bPlan.pass) console.warn(" -", bPlan.note);
    if (!bHls.pass) console.warn(" -", bHls.note);
    if (!bRec.pass) console.warn(" -", bRec.note);
  }

  if (CHECK_GUARD) {
    const billing1 = await apiGet("/api/billing/status");
    if (billing1.ok) {
      printBilling("BEFORE", billing1.json);
    } else {
      console.warn("\nWARN: /api/billing/status failed", billing1.status, billing1.json);
    }
  }

  // 2) Manual upgrade step
  console.log("\n--- ACTION REQUIRED ---");
  console.log("Now perform a plan change in Stripe (upgrade or downgrade). ");
  console.log("Then come back here and press ENTER to re-check /me.");
  await waitForEnter();

  // 3) Recheck loop (gives webhooks time to apply)
  const maxAttempts = 10;
  const delayMs = 2500;

  let after = null;
  for (let i = 1; i <= maxAttempts; i++) {
    const meN = await apiGet("/api/account/me");
    if (meN.ok) {
      after = pickEntitlements(meN.json);

      const aPlan = assertExpected("AFTER planId", after.planId, EXPECT.after.planId);
      const aHls = assertExpected("AFTER HLS", after.hls, EXPECT.after.hls);
      const aRec = assertExpected("AFTER Recording", after.recording, EXPECT.after.recording);

      const expectationsMatched =
        (EXPECT.after.planId === undefined || aPlan.pass) &&
        (EXPECT.after.hls === undefined || aHls.pass) &&
        (EXPECT.after.recording === undefined || aRec.pass);

      console.log(`\nCheck ${i}/${maxAttempts}`);
      printSnapshot("AFTER (current)", after);

      if (CHECK_GUARD) {
        const billingN = await apiGet("/api/billing/status");
        if (billingN.ok) {
          printBilling("AFTER (current)", billingN.json);
        }
      }

      // Stop early when expectations match, or at least something changed.
      if (expectationsMatched) {
        console.log("\nPASS: Entitlements match expected AFTER state.");
        process.exit(0);
      }

      if (didMeaningfullyChange(before, after) &&
          EXPECT.after.planId === undefined &&
          EXPECT.after.hls === undefined &&
          EXPECT.after.recording === undefined) {
        console.log("\nPASS: Detected plan/entitlement change after manual Stripe action.");
        process.exit(0);
      }
    } else {
      console.warn(`Attempt ${i}: /api/account/me failed`, meN.status, meN.json);
    }

    await sleep(delayMs);
  }

  console.warn("\nDONE: Recheck attempts finished.");
  console.warn("If AFTER did not change, your train is broken at one of these points:");
  console.warn("1) Stripe event not firing (wrong mode, wrong price, wrong product)");
  console.warn("2) Webhook not reaching server (endpoint, secret, signature verify)");
  console.warn("3) Webhook handler not updating users/{uid} plan/subscription fields");
  console.warn("4) /api/account/me not reading the updated source of truth");
  console.warn("5) UI reading flags from somewhere else (client store merge/caching)");
  process.exit(3);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForEnter() {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", () => resolve());
  });
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(99);
});
