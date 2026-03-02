import { auth as firebaseAuth, firestore } from "../firebaseAdmin";

type Mode = "dry" | "apply";

function normalizeEmail(value: any): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function shouldSkipUid(uid: string): boolean {
  const raw = String(process.env.SKIP_UID_PREFIX || "").trim();
  if (!raw) return false;
  return uid.startsWith(raw);
}

async function ensureUser(uid: string, email: string | null, mode: Mode) {
  try {
    await firebaseAuth.getUser(uid);
    return { uid, created: false };
  } catch (err: any) {
    const code = String(err?.code || "");
    if (code !== "auth/user-not-found") throw err;
  }

  if (mode === "dry") {
    return { uid, created: true, dryRun: true };
  }

  // Note: Firebase requires unique emails. If email is duplicated in your system,
  // this will fail with auth/email-already-exists.
  await firebaseAuth.createUser({
    uid,
    email: email || undefined,
    emailVerified: false,
    disabled: false,
  });

  return { uid, created: true };
}

async function main() {
  const mode: Mode = process.env.APPLY === "1" ? "apply" : "dry";
  const limit = Number(process.env.LIMIT || "0");
  const startAfterUid = String(process.env.START_AFTER_UID || "").trim();

  console.log(
    JSON.stringify(
      {
        mode,
        limit: limit || null,
        startAfterUid: startAfterUid || null,
      },
      null,
      2
    )
  );

  const usersRef = firestore.collection("users");

  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  if (startAfterUid) {
    const snap = await usersRef.doc(startAfterUid).get();
    if (snap.exists) last = snap as any;
    else {
      throw new Error(`START_AFTER_UID not found: ${startAfterUid}`);
    }
  }

  let scanned = 0;
  let created = 0;
  let skipped = 0;
  let conflicts = 0;

  while (true) {
    let q: FirebaseFirestore.Query = usersRef.orderBy("email").limit(200);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned += 1;
      const uid = doc.id;
      if (shouldSkipUid(uid)) {
        skipped += 1;
        continue;
      }

      const data = (doc.data() || {}) as any;
      const emailNorm = normalizeEmail(data.email);
      const email = emailNorm ? emailNorm : null;

      try {
        const result = await ensureUser(uid, email, mode);
        if ((result as any).created) created += 1;
      } catch (err: any) {
        const code = String(err?.code || "");
        if (code === "auth/email-already-exists") {
          conflicts += 1;
          console.warn(
            "[backfill] email conflict; resolve duplicates before backfill",
            JSON.stringify({ uid, email }, null, 0)
          );
          continue;
        }
        throw err;
      }

      if (limit > 0 && scanned >= limit) break;
    }

    if (limit > 0 && scanned >= limit) break;
    last = snap.docs[snap.docs.length - 1] || null;
  }

  console.log(
    JSON.stringify(
      {
        done: true,
        mode,
        scanned,
        created,
        skipped,
        conflicts,
      },
      null,
      2
    )
  );

  if (conflicts > 0) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error("backfillFirebaseAuthUsers failed", err);
  process.exitCode = 1;
});
