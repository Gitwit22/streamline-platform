import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

function loadServiceAccount(): admin.ServiceAccount {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    return JSON.parse(rawJson) as admin.ServiceAccount;
  }

  const rawB64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (rawB64) {
    const decoded = Buffer.from(rawB64, "base64").toString("utf8");
    return JSON.parse(decoded) as admin.ServiceAccount;
  }

  const filePath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.resolve(process.cwd(), "firebaseServiceAccount.json");

  if (fs.existsSync(filePath)) {
    const txt = fs.readFileSync(filePath, "utf8");
    return JSON.parse(txt) as admin.ServiceAccount;
  }

  throw new Error(
    "Firebase service account not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON (recommended), FIREBASE_SERVICE_ACCOUNT_BASE64, or FIREBASE_SERVICE_ACCOUNT_PATH (dotenv loads .env). You can also place a local key at streamline-server/firebaseServiceAccount.json (gitignored)."
  );
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount()),
  });
}

export const firestore = admin.firestore();
export const auth = admin.auth();
