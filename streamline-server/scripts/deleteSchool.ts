/**
 * deleteSchool — Delete all Firestore data associated with a school & its founding admin.
 *
 * Usage:
 *   npx tsx scripts/deleteSchool.ts nxtlvltechllc@gmail.com
 *
 * Requires:
 *   - FIREBASE_SERVICE_ACCOUNT_JSON / firebaseServiceAccount.json present
 *   - APP_ENV set to the environment where the school was created (default: "local")
 *
 * This script:
 *   1. Finds the user doc in globalCol("users") by email
 *   2. Extracts the orgId from the user doc
 *   3. Deletes ALL org-scoped data across tenant collections
 *   4. Deletes the user doc from global/users
 *   5. Deletes the Firebase Auth user
 */

import "dotenv/config";
import admin from "firebase-admin";

// Initialise Firebase Admin before importing helpers that depend on it
const { firestore, auth } = require("../firebaseAdmin") as {
  firestore: FirebaseFirestore.Firestore;
  auth: admin.auth.Auth;
};

import { tenantCol, globalCol } from "../lib/dbPaths";
import { getAppEnv } from "../lib/runtimeContext";

/* ── Batch-delete helper ─────────────────────────────────────────── */

async function deleteByQuery(q: FirebaseFirestore.Query, label: string): Promise<number> {
  const snap = await q.get().catch(() => null as any);
  if (!snap || snap.empty) {
    console.log(`  ${label}: 0 docs (none found)`);
    return 0;
  }

  const batch = firestore.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
  console.log(`  ${label}: ${snap.size} docs deleted`);
  return snap.size;
}

/* ── Main ─────────────────────────────────────────────────────────── */

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: npx tsx scripts/deleteSchool.ts <email>");
    process.exit(1);
  }

  const appEnv = getAppEnv();
  console.log(`\n=== deleteSchool ===`);
  console.log(`  APP_ENV : ${appEnv}`);
  console.log(`  Email   : ${email}\n`);

  // 1. Find user by email in global users collection
  const userSnap = await globalCol("users").where("email", "==", email).limit(1).get();
  if (userSnap.empty) {
    console.error(`No user found with email "${email}" in globalCol("users") under env/${appEnv}`);
    process.exit(1);
  }

  const userDoc = userSnap.docs[0];
  const userData = userDoc.data() as any;
  const uid = userDoc.id;
  const orgId = userData?.orgId ?? userData?.org?.id;

  console.log(`  Found user: uid=${uid}, orgId=${orgId}, name=${userData?.name || userData?.displayName || "?"}`);

  if (!orgId) {
    console.error("User has no orgId — nothing to delete.");
    process.exit(1);
  }

  // 2. Delete all org-scoped data across tenant collections
  console.log(`\nDeleting org-scoped data for orgId="${orgId}"...\n`);

  await deleteByQuery(tenantCol("orgMembers").where("orgId", "==", orgId), "orgMembers");
  await deleteByQuery(tenantCol("rooms").where("orgId", "==", orgId), "rooms");
  await deleteByQuery(tenantCol("events").where("orgId", "==", orgId), "events");
  await deleteByQuery(tenantCol("invites").where("orgId", "==", orgId), "invites");
  await deleteByQuery(tenantCol("embeds").where("orgId", "==", orgId), "embeds");
  await deleteByQuery(tenantCol("recordings").where("orgId", "==", orgId), "recordings");

  // Delete config docs (known IDs)
  for (const suffix of ["roles", "permissions", "embed"]) {
    const configId = `${orgId}_${suffix}`;
    const configRef = tenantCol("config").doc(configId);
    const configSnap = await configRef.get().catch(() => null as any);
    if (configSnap?.exists) {
      await configRef.delete();
      console.log(`  config/${configId}: deleted`);
    } else {
      console.log(`  config/${configId}: not found`);
    }
  }

  // Delete audit entries (new collection + legacy collection)
  await deleteByQuery(tenantCol("eduAudit").where("orgId", "==", orgId), "eduAudit");
  await deleteByQuery(tenantCol("audit").where("orgId", "==", orgId), "audit (legacy)");

  // Delete org doc
  const orgRef = tenantCol("orgs").doc(orgId);
  const orgSnap = await orgRef.get().catch(() => null as any);
  if (orgSnap?.exists) {
    await orgRef.delete();
    console.log(`  orgs/${orgId}: deleted`);
  } else {
    console.log(`  orgs/${orgId}: not found`);
  }

  // 3. Delete user doc from global users
  await userDoc.ref.delete();
  console.log(`\n  global/users/${uid}: deleted`);

  // 4. Delete Firebase Auth user
  try {
    await auth.deleteUser(uid);
    console.log(`  Firebase Auth user ${uid}: deleted`);
  } catch (err: any) {
    if (err?.code === "auth/user-not-found") {
      console.log(`  Firebase Auth user ${uid}: not found (already deleted or never created)`);
    } else {
      console.warn(`  Firebase Auth user ${uid}: delete failed —`, err.message);
    }
  }

  console.log(`\n✅ School data for "${email}" (org: ${orgId}) fully deleted.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
