import { firestore } from "../firebaseAdmin";

function normalizeEmail(value: any): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function main() {
  const limit = Number(process.env.LIMIT || "0");
  const usersRef = firestore.collection("users");

  const emailToUids = new Map<string, string[]>();

  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let scanned = 0;

  while (true) {
    let q: FirebaseFirestore.Query = usersRef.orderBy("email").limit(500);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned += 1;
      const data = (doc.data() || {}) as any;
      const email = normalizeEmail(data.email);
      if (email) {
        const list = emailToUids.get(email) || [];
        list.push(doc.id);
        emailToUids.set(email, list);
      }

      if (limit > 0 && scanned >= limit) break;
    }

    if (limit > 0 && scanned >= limit) break;
    last = snap.docs[snap.docs.length - 1] || null;
  }

  const dups: Array<{ email: string; uids: string[] }> = [];
  for (const [email, uids] of emailToUids.entries()) {
    if (uids.length > 1) dups.push({ email, uids });
  }

  dups.sort((a, b) => b.uids.length - a.uids.length || a.email.localeCompare(b.email));

  console.log(JSON.stringify({ scanned, duplicateEmails: dups.length, dups }, null, 2));

  if (dups.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error("auditDuplicateEmails failed", err);
  process.exitCode = 1;
});
