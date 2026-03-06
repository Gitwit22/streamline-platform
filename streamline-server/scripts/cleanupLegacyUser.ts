/**
 * cleanupLegacyUser — Delete legacy user doc and Firebase Auth user by email.
 *
 * Usage: npx tsx scripts/cleanupLegacyUser.ts nxtlvltechllc@gmail.com
 */

import "dotenv/config";
import admin from "firebase-admin";

const { firestore, auth } = require("../firebaseAdmin") as {
  firestore: FirebaseFirestore.Firestore;
  auth: admin.auth.Auth;
};

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: npx tsx scripts/cleanupLegacyUser.ts <email>");
    process.exit(1);
  }

  console.log(`\nCleaning up legacy data for "${email}"...\n`);

  // 1. Delete legacy (bare-root) user doc by email
  const snap = await firestore.collection("users").where("email", "==", email).limit(5).get();
  if (snap.empty) {
    console.log("  No legacy user doc found.");
  } else {
    for (const doc of snap.docs) {
      console.log(`  Deleting legacy users/${doc.id}...`);
      await doc.ref.delete();
      console.log(`  Deleted.`);
    }
  }

  // 2. Delete Firebase Auth user by email
  try {
    const fbUser = await auth.getUserByEmail(email);
    console.log(`  Found Firebase Auth user: uid=${fbUser.uid}`);
    await auth.deleteUser(fbUser.uid);
    console.log(`  Firebase Auth user deleted.`);
  } catch (err: any) {
    if (err?.code === "auth/user-not-found") {
      console.log("  No Firebase Auth user found for this email.");
    } else {
      console.warn("  Auth lookup error:", err?.message);
    }
  }

  console.log("\nCleanup complete.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
