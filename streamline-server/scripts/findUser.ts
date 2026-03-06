/**
 * findUser — Search for a user by email across ALL Firestore env roots & legacy paths.
 *
 * Usage:  npx tsx scripts/findUser.ts nxtlvltechllc@gmail.com
 */

import "dotenv/config";

// Initialise Firebase Admin
const { firestore } = require("../firebaseAdmin") as {
  firestore: FirebaseFirestore.Firestore;
};

async function searchCollection(path: string, email: string): Promise<void> {
  try {
    const snap = await firestore.collection(path).where("email", "==", email).limit(5).get();
    if (!snap.empty) {
      for (const doc of snap.docs) {
        const d = doc.data();
        console.log(`  FOUND in ${path}/${doc.id}`);
        console.log(`    email: ${d.email}, orgId: ${d.orgId || d.org?.id || "N/A"}, name: ${d.name || d.displayName || "?"}`);
      }
    } else {
      console.log(`  (none) ${path}`);
    }
  } catch (err: any) {
    console.log(`  (error) ${path} — ${err.message?.slice(0, 80)}`);
  }
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: npx tsx scripts/findUser.ts <email>");
    process.exit(1);
  }

  console.log(`\nSearching for "${email}" across all Firestore paths...\n`);

  // Check env-scoped paths
  for (const env of ["local", "test", "prod"]) {
    await searchCollection(`env/${env}/global/_/users`, email);
  }

  // Check legacy bare-root paths
  await searchCollection("users", email);
  await searchCollection("global/users", email);

  // Also check if there are any orgMembers with this email
  console.log(`\nSearching orgMembers...\n`);
  for (const env of ["local", "test", "prod"]) {
    await searchCollection(`env/${env}/tenants/edu/orgMembers`, email);
  }
  await searchCollection("orgMembers", email);

  // Check if there are any orgs at all 
  console.log(`\nListing orgs (up to 5 per env)...\n`);
  for (const env of ["local", "test", "prod"]) {
    try {
      const snap = await firestore.collection(`env/${env}/tenants/edu/orgs`).limit(5).get();
      if (!snap.empty) {
        for (const doc of snap.docs) {
          const d = doc.data();
          console.log(`  env/${env}/tenants/edu/orgs/${doc.id} — name: ${d.name || "?"}, onboardingComplete: ${d.onboardingComplete}`);
        }
      } else {
        console.log(`  (none) env/${env}/tenants/edu/orgs`);
      }
    } catch (err: any) {
      console.log(`  (error) env/${env}/orgs — ${err.message?.slice(0, 80)}`);
    }
  }

  // Legacy orgs
  try {
    const snap = await firestore.collection("orgs").limit(5).get();
    if (!snap.empty) {
      for (const doc of snap.docs) {
        const d = doc.data();
        console.log(`  orgs/${doc.id} — name: ${d.name || "?"}`);
      }
    } else {
      console.log(`  (none) orgs (legacy root)`);
    }
  } catch (err: any) {
    console.log(`  (error) legacy orgs — ${err.message?.slice(0, 80)}`);
  }

  console.log("\nDone.\n");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
