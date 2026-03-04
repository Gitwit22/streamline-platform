/**
 * dbPaths — Centralised Firestore path helpers with env + tenant prefix.
 *
 * ## Tenant-scoped data (per-org / per-lane)
 *   `tenantCol("events")` → `env/{APP_ENV}/tenants/{TENANT}/events`
 *   `tenantDoc("events", eventId)` → `env/{APP_ENV}/tenants/{TENANT}/events/{eventId}`
 *
 * ## Global data (shared across all tenants — users, plans, featureFlags…)
 *   `globalCol("users")` → `env/{APP_ENV}/global/users`
 *   `globalDoc("users", uid)` → `env/{APP_ENV}/global/users/{uid}`
 *
 * Both sets are scoped under `env/{APP_ENV}/` so local / test / prod
 * never overlap, but the "tenants" vs "global" split prevents
 * tenant-scoped data from leaking between EDU and Corporate.
 *
 * ## Migration compatibility
 *   `legacyCol("events")` → `events`  (bare Firestore root — for fallback reads)
 *   `tenantReadWithFallback(...)` — tries new path, falls back to legacy.
 */

import { firestore } from "../firebaseAdmin";
import {
  type AppEnv,
  type Tenant,
  getAppEnv,
  getDbRoot,
} from "./runtimeContext";

/* ── safety guard ─────────────────────────────────────────────────── */

function assertEnvSafe(appEnv: AppEnv): void {
  const runtime = getAppEnv();
  if (runtime === "local" && appEnv === "prod") {
    throw new Error(
      `[dbPaths] Refusing to access prod data from a local environment. ` +
        `Set APP_ENV=prod explicitly if this is intentional.`
    );
  }
  if (runtime === "prod" && (appEnv === "local" || appEnv === "test")) {
    throw new Error(
      `[dbPaths] Refusing to access ${appEnv} data from a prod environment. ` +
        `This is almost certainly a bug.`
    );
  }
}

/* ── Tenant-scoped helpers ────────────────────────────────────────── */

/**
 * Returns a Firestore CollectionReference under the tenant root.
 *
 *   tenantCol("events", "prod", "edu")
 *   → firestore.collection("env/prod/tenants/edu/events")
 */
export function tenantCol(
  collection: string,
  appEnv?: AppEnv,
  tenant?: Tenant
) {
  const e = appEnv ?? getAppEnv();
  assertEnvSafe(e);
  const root = getDbRoot(e, tenant);
  return firestore.collection(`${root}/${collection}`);
}

/**
 * Returns a Firestore DocumentReference under the tenant root.
 *
 *   tenantDoc("events", eventId, "local", "edu")
 *   → firestore.doc("env/local/tenants/edu/events/{eventId}")
 */
export function tenantDoc(
  collection: string,
  docId: string,
  appEnv?: AppEnv,
  tenant?: Tenant
) {
  return tenantCol(collection, appEnv, tenant).doc(docId);
}

/**
 * Build a raw Firestore path string under the tenant root (no Firestore call).
 *
 *   tenantPath("events", "abc123")
 *   → "env/local/tenants/edu/events/abc123"
 */
export function tenantPath(
  collection: string,
  ...segments: string[]
): string {
  const root = getDbRoot();
  const parts = [root, collection, ...segments].filter(Boolean);
  return parts.join("/");
}

/* ── Global helpers (shared across tenants) ───────────────────────── */

function globalRoot(appEnv?: AppEnv): string {
  const e = appEnv ?? getAppEnv();
  return `env/${e}/global`;
}

/**
 * Returns a Firestore CollectionReference under the global root.
 *
 *   globalCol("users") → firestore.collection("env/local/global/users")
 */
export function globalCol(collection: string, appEnv?: AppEnv) {
  const e = appEnv ?? getAppEnv();
  assertEnvSafe(e);
  return firestore.collection(`${globalRoot(e)}/${collection}`);
}

/**
 * Returns a Firestore DocumentReference under the global root.
 *
 *   globalDoc("users", uid) → firestore.doc("env/local/global/users/{uid}")
 */
export function globalDoc(
  collection: string,
  docId: string,
  appEnv?: AppEnv
) {
  return globalCol(collection, appEnv).doc(docId);
}

/**
 * Build a raw global Firestore path string (no Firestore call).
 *
 *   globalPath("users", uid) → "env/local/global/users/{uid}"
 */
export function globalPath(collection: string, ...segments: string[]): string {
  const root = globalRoot();
  const parts = [root, collection, ...segments].filter(Boolean);
  return parts.join("/");
}

/* ── Legacy (bare root, pre-migration) ────────────────────────────── */

/**
 * Returns a Firestore CollectionReference at the bare root (legacy path).
 * Use ONLY for migration fallback reads.
 */
export function legacyCol(collection: string) {
  return firestore.collection(collection);
}

export function legacyDoc(collection: string, docId: string) {
  return firestore.collection(collection).doc(docId);
}

/* ── Migration helper ─────────────────────────────────────────────── */

/**
 * Try reading from the new tenant-scoped path first.
 * If the doc doesn't exist, fall back to the legacy (bare) path.
 *
 * On a successful fallback (non-prod only), optionally write-through
 * the data to the new path so future reads hit the new location.
 *
 * Returns { snap, migrated } where `migrated` is true if the data
 * came from the legacy path.
 */
export async function tenantReadWithFallback(
  collection: string,
  docId: string,
  opts?: { writeThrough?: boolean; tenant?: Tenant; appEnv?: AppEnv }
): Promise<{
  snap: FirebaseFirestore.DocumentSnapshot;
  migrated: boolean;
}> {
  const newDoc = tenantDoc(collection, docId, opts?.appEnv, opts?.tenant);
  const newSnap = await newDoc.get();
  if (newSnap.exists) return { snap: newSnap, migrated: false };

  // Try legacy path
  const oldSnap = await legacyDoc(collection, docId).get();
  if (!oldSnap.exists) return { snap: oldSnap, migrated: false };

  // Migrate forward (non-prod only, opt-in)
  const appEnv = opts?.appEnv ?? getAppEnv();
  if (opts?.writeThrough && appEnv !== "prod") {
    try {
      await newDoc.set(oldSnap.data()!);
      console.log(
        `[dbPaths] Migrated ${collection}/${docId} → ${newDoc.path}`
      );
    } catch (err) {
      console.warn(
        `[dbPaths] Write-through migration failed for ${collection}/${docId}:`,
        err
      );
    }
  } else {
    console.log(
      `[dbPaths] Legacy fallback read: ${collection}/${docId} (new path empty)`
    );
  }

  return { snap: oldSnap, migrated: true };
}

/**
 * Same as tenantReadWithFallback but for global collections.
 */
export async function globalReadWithFallback(
  collection: string,
  docId: string,
  opts?: { writeThrough?: boolean; appEnv?: AppEnv }
): Promise<{
  snap: FirebaseFirestore.DocumentSnapshot;
  migrated: boolean;
}> {
  const newDoc = globalDoc(collection, docId, opts?.appEnv);
  const newSnap = await newDoc.get();
  if (newSnap.exists) return { snap: newSnap, migrated: false };

  const oldSnap = await legacyDoc(collection, docId).get();
  if (!oldSnap.exists) return { snap: oldSnap, migrated: false };

  const appEnv = opts?.appEnv ?? getAppEnv();
  if (opts?.writeThrough && appEnv !== "prod") {
    try {
      await newDoc.set(oldSnap.data()!);
      console.log(
        `[dbPaths] Migrated global ${collection}/${docId} → ${newDoc.path}`
      );
    } catch (err) {
      console.warn(
        `[dbPaths] Global write-through migration failed for ${collection}/${docId}:`,
        err
      );
    }
  } else {
    console.log(
      `[dbPaths] Legacy fallback read: global/${collection}/${docId}`
    );
  }

  return { snap: oldSnap, migrated: true };
}
