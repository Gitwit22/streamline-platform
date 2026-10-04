import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";

/**
 * Firebase Admin bootstrap.
 *
 * Initialization is lazy: importing this module never throws, so unit tests
 * and scripts that only touch pure helpers can import modules that depend on
 * it without credentials. The app is initialized the first time `firestore`
 * or `auth` is used (or when `getFirebaseApp()` is called).
 *
 * When a credential source is configured, the app is still initialized
 * eagerly at import time, so production keeps failing fast on bad
 * credentials, and code that calls `admin.firestore()` / `admin.auth()`
 * directly still finds a default app.
 *
 * Credential sources, in order:
 *   1. FIREBASE_SERVICE_ACCOUNT_JSON   (plain JSON; base64 tolerated)
 *   2. FIREBASE_SERVICE_ACCOUNT_BASE64 (standard or URL-safe base64 JSON)
 *   3. FIREBASE_SERVICE_ACCOUNT_PATH   (path to a JSON file), or
 *      ./firebaseServiceAccount.json   (gitignored local key)
 *   4. GOOGLE_APPLICATION_CREDENTIALS  (path, via applicationDefault(); a raw
 *      JSON value is also accepted), or Google Cloud runtime credentials.
 *
 * Error messages never include JSON.parse output, because it can echo
 * fragments of the private key.
 */

type ServiceAccountLike = admin.ServiceAccount & { private_key?: string };

class CredentialParseError extends Error {}

function normalizeServiceAccount(account: ServiceAccountLike): admin.ServiceAccount {
  // Env-var pasted keys often carry literal "\n" sequences instead of newlines.
  if (typeof account.private_key === "string") {
    account.private_key = account.private_key.replace(/\\n/g, "\n");
  }
  if (typeof account.privateKey === "string") {
    account.privateKey = account.privateKey.replace(/\\n/g, "\n");
  }
  return account;
}

function parseServiceAccountJson(raw: string, source: string): admin.ServiceAccount {
  const normalized = raw.replace(/^﻿/, "").trim();
  if (!normalized.startsWith("{")) {
    throw new CredentialParseError(`${source} does not contain a JSON object`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    // Deliberately drop the JSON.parse message: it can include key material.
    throw new CredentialParseError(`${source} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CredentialParseError(`${source} does not contain a JSON object`);
  }
  return normalizeServiceAccount(parsed as ServiceAccountLike);
}

function decodeBase64(raw: string): string | null {
  const compact = raw.replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return null;
  // Accept URL-safe base64 (-, _) as well as the standard alphabet.
  const standard = compact.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(standard, "base64").toString("utf8");
}

function parseJsonOrBase64(raw: string, source: string): admin.ServiceAccount {
  const trimmed = raw.trim();
  if (trimmed.replace(/^﻿/, "").startsWith("{")) {
    return parseServiceAccountJson(trimmed, source);
  }
  const decoded = decodeBase64(trimmed);
  if (decoded === null) {
    throw new CredentialParseError(`${source} is neither JSON nor base64-encoded JSON`);
  }
  return parseServiceAccountJson(decoded, `${source} (base64-decoded)`);
}

function errorMessage(err: unknown): string {
  return err instanceof CredentialParseError ? err.message : "unreadable value";
}

function defaultServiceAccountPath(): string {
  return (
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() ||
    path.resolve(process.cwd(), "firebaseServiceAccount.json")
  );
}

function isGoogleCloudRuntime(): boolean {
  return Boolean(
    process.env.K_SERVICE ||
      process.env.FUNCTION_TARGET ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT
  );
}

function hasConfiguredCredentialSource(): boolean {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ||
      process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim() ||
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      fs.existsSync(defaultServiceAccountPath())
  );
}

function resolveCredential(): admin.credential.Credential {
  const errors: string[] = [];

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawJson) {
    try {
      return admin.credential.cert(parseJsonOrBase64(rawJson, "FIREBASE_SERVICE_ACCOUNT_JSON"));
    } catch (err) {
      errors.push(`FIREBASE_SERVICE_ACCOUNT_JSON is set but invalid: ${errorMessage(err)}`);
    }
  }

  const rawB64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
  if (rawB64) {
    try {
      return admin.credential.cert(parseJsonOrBase64(rawB64, "FIREBASE_SERVICE_ACCOUNT_BASE64"));
    } catch (err) {
      errors.push(`FIREBASE_SERVICE_ACCOUNT_BASE64 is set but invalid: ${errorMessage(err)}`);
    }
  }

  const filePath = defaultServiceAccountPath();
  if (fs.existsSync(filePath)) {
    try {
      const txt = fs.readFileSync(filePath, "utf8");
      return admin.credential.cert(parseServiceAccountJson(txt, `service account file (${filePath})`));
    } catch (err) {
      errors.push(`Service account file ${filePath} is invalid: ${errorMessage(err)}`);
    }
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim()) {
    errors.push(`FIREBASE_SERVICE_ACCOUNT_PATH points to a missing file (${filePath})`);
  }

  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (gac) {
    if (gac.replace(/^﻿/, "").startsWith("{")) {
      // Some hosts store the key contents, not a path, in this variable.
      try {
        return admin.credential.cert(parseServiceAccountJson(gac, "GOOGLE_APPLICATION_CREDENTIALS"));
      } catch (err) {
        errors.push(`GOOGLE_APPLICATION_CREDENTIALS is set but invalid: ${errorMessage(err)}`);
      }
    } else if (fs.existsSync(gac)) {
      return admin.credential.applicationDefault();
    } else {
      errors.push(`GOOGLE_APPLICATION_CREDENTIALS points to a missing file (${gac})`);
    }
  } else if (errors.length === 0 && isGoogleCloudRuntime()) {
    // Running on Google Cloud: use the runtime service account.
    return admin.credential.applicationDefault();
  }

  const details = errors.length ? ` Details: ${errors.join(" | ")}` : "";
  throw new Error(
    "Firebase service account is missing or invalid. Set FIREBASE_SERVICE_ACCOUNT_JSON (plain JSON), " +
      "FIREBASE_SERVICE_ACCOUNT_BASE64 (base64-encoded JSON), FIREBASE_SERVICE_ACCOUNT_PATH (path to JSON file), " +
      "or GOOGLE_APPLICATION_CREDENTIALS (path to JSON file)." +
      details
  );
}

/** Returns the default Firebase app, initializing it on first use. */
export function getFirebaseApp(): admin.app.App {
  if (admin.apps.length && admin.apps[0]) return admin.apps[0];
  return admin.initializeApp({ credential: resolveCredential() });
}

function lazyService<T extends object>(factory: () => T): T {
  let instance: T | null = null;
  const resolve = (): T => {
    if (!instance) instance = factory();
    return instance;
  };
  return new Proxy({} as T, {
    get(_target, prop) {
      const real = resolve();
      const value = Reflect.get(real, prop, real);
      return typeof value === "function" ? value.bind(real) : value;
    },
    set(_target, prop, value) {
      return Reflect.set(resolve(), prop, value);
    },
    has(_target, prop) {
      return Reflect.has(resolve(), prop);
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(resolve());
    },
  });
}

export const firestore: admin.firestore.Firestore = lazyService(() => getFirebaseApp().firestore());
export const auth: admin.auth.Auth = lazyService(() => getFirebaseApp().auth());

// Keep the previous fail-fast behaviour when credentials are configured.
if (hasConfiguredCredentialSource()) {
  getFirebaseApp();
}

export default admin;
