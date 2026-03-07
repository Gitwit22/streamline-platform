/**
 * patchOrgStatus — One-shot script to add `status: "active"` to all org docs missing it.
 *
 * Usage:  APP_ENV=prod npx tsx scripts/patchOrgStatus.ts
 */

import "../firebaseAdmin";          // initialise Firebase
import { tenantCol } from "../lib/dbPaths";

async function main() {
  console.log("[patchOrgStatus] Scanning orgs for missing status field…");

  const orgsSnap = await tenantCol("orgs").get();
  let patched = 0;

  for (const doc of orgsSnap.docs) {
    const data = doc.data() as any;
    if (!data.status) {
      console.log(`  → Patching org ${doc.id} (${data.name || "unnamed"}) — adding status: "active"`);
      await tenantCol("orgs").doc(doc.id).set({ status: "active" }, { merge: true });
      patched++;
    } else {
      console.log(`  ✓ Org ${doc.id} already has status="${data.status}"`);
    }
  }

  console.log(`\n[patchOrgStatus] Done. Patched ${patched} org(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[patchOrgStatus] Fatal:", err);
  process.exit(1);
});
