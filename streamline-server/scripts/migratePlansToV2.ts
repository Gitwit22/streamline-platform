/**
 * Internal CLI: migrate stored plan documents to limitsVersion 2
 * (null = unlimited, 0 = none). NOT reachable over HTTP (replaces the removed
 * POST /api/admin/plans/migrate-schema endpoint).
 *
 * Dry run by default; nothing is written unless --apply is passed.
 *
 *   npx tsx scripts/migratePlansToV2.ts                 # dry run, plans only
 *   npx tsx scripts/migratePlansToV2.ts --users         # also report legacy user overrides
 *   npx tsx scripts/migratePlansToV2.ts --apply         # write plans
 *   npx tsx scripts/migratePlansToV2.ts --apply --users # write plans + user overrides
 *
 * Each migrated plan keeps a `legacyEntitlementsBackup` copy of its previous
 * features/limits/editing/caps. Runtime behavior does not change: the engine
 * already reads legacy docs with legacy semantics; this only makes the stored
 * convention explicit so admins edit v2 values.
 */
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../firebaseAdmin";
import { planPlanMigration, planUserOverrideMigration } from "../lib/entitlements/migratePlans";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const USERS = args.has("--users");

async function migratePlans() {
  const snap = await firestore.collection("plans").get();
  const nowIso = new Date().toISOString();
  let migrated = 0;
  for (const doc of snap.docs) {
    const step = planPlanMigration(doc.id, doc.data() || {}, nowIso);
    if (step.action === "skip_already_v2") {
      console.log(`  [skip]    plans/${doc.id} already limitsVersion 2`);
      continue;
    }
    migrated++;
    console.log(`  [${APPLY ? "write" : "dry"}]   plans/${doc.id}`);
    console.log(`            before.limits   = ${JSON.stringify(step.before?.limits)}`);
    console.log(`            before.editing  = ${JSON.stringify(step.before?.editing)}`);
    console.log(`            after.features  = ${JSON.stringify(step.update?.features)}`);
    console.log(`            after.limits    = ${JSON.stringify(step.update?.limits)}  (null = unlimited)`);
    if (APPLY && step.update) {
      await doc.ref.set(step.update, { mergeFields: Object.keys(step.update) });
    }
  }
  return { total: snap.size, migrated };
}

async function migrateUserOverrides() {
  const now = Date.now();
  const [byPlanId, byFlag] = await Promise.all([
    firestore.collection("users").where("adminOverridePlanId", "!=", null).get(),
    firestore.collection("users").where("adminOverride", "==", true).get(),
  ]);
  const seen = new Set<string>();
  let migrated = 0;
  for (const doc of [...byPlanId.docs, ...byFlag.docs]) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    const step = planUserOverrideMigration(doc.id, doc.data() || {}, now);
    if (step.action !== "migrate") continue;
    migrated++;
    console.log(`  [${APPLY ? "write" : "dry"}]   users/${doc.id} -> planOverride ${JSON.stringify(step.planOverride)}`);
    if (APPLY) {
      await doc.ref.update({
        planOverride: step.planOverride,
        adminOverridePlanId: FieldValue.delete(),
        adminOverride: FieldValue.delete(),
      });
    }
  }
  return { scanned: seen.size, migrated };
}

async function main() {
  console.log(`\n=== migratePlansToV2 (${APPLY ? "APPLY" : "DRY RUN"}) ===\n`);
  const plans = await migratePlans();
  console.log(`\nPlans: ${plans.migrated} of ${plans.total} ${APPLY ? "migrated" : "would be migrated"}.`);
  if (USERS) {
    console.log("");
    const users = await migrateUserOverrides();
    console.log(`\nUser overrides: ${users.migrated} of ${users.scanned} ${APPLY ? "migrated" : "would be migrated"}.`);
  }
  if (!APPLY) console.log("\nDry run: nothing was written. Re-run with --apply to write.\n");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("migratePlansToV2 failed:", err?.message || err);
    process.exit(1);
  }
);
