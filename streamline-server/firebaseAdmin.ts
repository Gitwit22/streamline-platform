import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

function parseServiceAccountJson(raw: string, source: string): admin.ServiceAccount {
  const normalized = raw.replace(/^\uFEFF/, "").trim();
  if (!normalized.startsWith("{")) {
    throw new Error(`${source} does not contain a JSON object`);
  }
  return JSON.parse(normalized) as admin.ServiceAccount;
}

function tryParseJsonOrBase64(raw: string, source: string): admin.ServiceAccount {
  try {
    return parseServiceAccountJson(raw, source);
  } catch (jsonErr) {
    const b64Candidate = raw.trim();
    const looksLikeBase64 = /^[A-Za-z0-9+/=\r\n]+$/.test(b64Candidate);

    if (looksLikeBase64) {
      try {
        const decoded = Buffer.from(b64Candidate, "base64").toString("utf8");
        const fromBase64 = parseServiceAccountJson(
          decoded,
          `${source} (base64-decoded)`
        );
        console.warn(
          `[firebaseAdmin] ${source} appears to be base64-encoded JSON; parsed successfully. ` +
            "Prefer using FIREBASE_SERVICE_ACCOUNT_BASE64 for this format."
        );
        return fromBase64;
      } catch {
        // Fall through and rethrow the original JSON error with clearer source context.
      }
    }

    throw jsonErr;
  }
}

function loadServiceAccount(): admin.ServiceAccount {
  const errors: string[] = [];

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawJson) {
    try {
      return tryParseJsonOrBase64(rawJson, "FIREBASE_SERVICE_ACCOUNT_JSON");
    } catch (err) {
      errors.push(
        `FIREBASE_SERVICE_ACCOUNT_JSON is set but invalid: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  const rawB64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
  if (rawB64) {
    try {
      const decoded = Buffer.from(rawB64, "base64").toString("utf8");
      return parseServiceAccountJson(decoded, "FIREBASE_SERVICE_ACCOUNT_BASE64");
    } catch (err) {
      errors.push(
        `FIREBASE_SERVICE_ACCOUNT_BASE64 is set but invalid: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  const filePath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.resolve(process.cwd(), "firebaseServiceAccount.json");

  if (fs.existsSync(filePath)) {
    try {
      const txt = fs.readFileSync(filePath, "utf8");
      return parseServiceAccountJson(txt, `FIREBASE_SERVICE_ACCOUNT_PATH (${filePath})`);
    } catch (err) {
      errors.push(
        `FIREBASE_SERVICE_ACCOUNT_PATH points to an invalid JSON file (${filePath}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  const details = errors.length ? ` Details: ${errors.join(" | ")}` : "";
  throw new Error(
    "Firebase service account is missing or invalid. Set FIREBASE_SERVICE_ACCOUNT_JSON (plain JSON), " +
      "FIREBASE_SERVICE_ACCOUNT_BASE64 (base64-encoded JSON), or FIREBASE_SERVICE_ACCOUNT_PATH (path to JSON file)." +
      details
  );
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount()),
  });
}

export const firestore = admin.firestore();
export const auth = admin.auth();
