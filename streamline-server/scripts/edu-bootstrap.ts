import "dotenv/config";
import { firestore } from "../firebaseAdmin";

function getArg(name: string): string | null {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return null;
  return process.argv[idx + 1] ? String(process.argv[idx + 1]) : null;
}

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function coerceEmail(value: any): string | null {
  const email = asString(value).trim().toLowerCase();
  if (!email) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
}

async function main() {
  const orgName = asString(getArg("orgName") || "Your School").trim() || "Your School";
  const adminEmail = coerceEmail(getArg("adminEmail"));
  const orgIdArg = asString(getArg("orgId") || "").trim();
  if (!adminEmail) {
    console.error("Missing --adminEmail");
    process.exit(1);
  }

  const orgId = orgIdArg || firestore.collection("orgs").doc().id;
  const now = Date.now();

  await firestore.collection("orgs").doc(orgId).set(
    {
      id: orgId,
      name: orgName,
      orgType: "edu",
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  );

  const userSnap = await firestore.collection("users").where("email", "==", adminEmail).limit(1).get();
  if (userSnap.empty) {
    console.error("User not found for email. Sign up first.");
    process.exit(2);
  }

  const userDoc = userSnap.docs[0];
  const uid = userDoc.id;

  await firestore.collection("users").doc(uid).set(
    {
      orgId,
      orgType: "edu",
      orgName,
      updatedAt: now,
    },
    { merge: true },
  );

  const memberId = `${orgId}_${uid}`;
  await firestore.collection("orgMembers").doc(memberId).set(
    {
      orgId,
      uid,
      email: adminEmail,
      role: "faculty_admin",
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  );

  console.log(JSON.stringify({ ok: true, orgId, orgName, uid, adminEmail, memberId }, null, 2));
}

main().catch((e) => {
  console.error("edu-bootstrap failed", e);
  process.exit(99);
});
