/**
 * storagePaths — Centralised R2 / S3 key helpers with env + tenant prefix.
 *
 * Every storage key is prefixed with `{APP_ENV}/{TENANT}/` so that
 * local, test, and prod data never overlap, and EDU and Corporate
 * objects are cleanly separated within the same bucket.
 *
 * Examples:
 *   storageKey("recordings", userId, roomName, "recording.mp4")
 *     → "local/edu/recordings/{userId}/{roomName}/recording.mp4"
 *
 *   storageKey("hls", roomId, "room.m3u8")
 *     → "local/edu/hls/{roomId}/room.m3u8"
 *
 *   storagePrefix("recordings", userId, roomName)
 *     → "local/edu/recordings/{userId}/{roomName}/"
 */

import {
  type AppEnv,
  type Tenant,
  getAppEnv,
  getStorageRoot,
} from "./runtimeContext";

/* ── safety guard ─────────────────────────────────────────────────── */

function assertEnvSafe(appEnv: AppEnv): void {
  const runtime = getAppEnv();
  if (runtime === "local" && appEnv === "prod") {
    throw new Error(
      `[storagePaths] Refusing to access prod storage from a local environment.`
    );
  }
  if (runtime === "prod" && (appEnv === "local" || appEnv === "test")) {
    throw new Error(
      `[storagePaths] Refusing to access ${appEnv} storage from a prod environment.`
    );
  }
}

/* ── Key builders ─────────────────────────────────────────────────── */

export type StorageType =
  | "recordings"
  | "hls"
  | "thumbnails"
  | "uploads"
  | "exports"
  | "assets"
  | "tmp"
  | "test";

/**
 * Build a fully-qualified storage object key.
 *
 *   storageKey("recordings", userId, roomName, "recording.mp4")
 *   → "{APP_ENV}/{TENANT}/recordings/{userId}/{roomName}/recording.mp4"
 */
export function storageKey(
  type: StorageType,
  ...segments: string[]
): string {
  const root = getStorageRoot();
  assertEnvSafe(getAppEnv());
  const parts = [root, type, ...segments].filter(Boolean);
  return parts.join("/");
}

/**
 * Build a storage key for a specific tenant + env (overrides defaults).
 */
export function storageKeyFor(
  appEnv: AppEnv,
  tenant: Tenant,
  type: StorageType,
  ...segments: string[]
): string {
  assertEnvSafe(appEnv);
  const root = getStorageRoot(appEnv, tenant);
  const parts = [root, type, ...segments].filter(Boolean);
  return parts.join("/");
}

/**
 * Build a key prefix (for listing / deleting by prefix).
 * Ensures a trailing slash.
 *
 *   storagePrefix("recordings", userId, roomName)
 *   → "{APP_ENV}/{TENANT}/recordings/{userId}/{roomName}/"
 */
export function storagePrefix(
  type: StorageType,
  ...segments: string[]
): string {
  const key = storageKey(type, ...segments);
  return key.endsWith("/") ? key : `${key}/`;
}

/* ── Legacy key helpers (pre-migration) ───────────────────────────── */

/**
 * Build a legacy (bare) storage key without env/tenant prefix.
 * Use ONLY for migration fallback reads.
 *
 *   legacyStorageKey("recordings", userId, roomName, "recording.mp4")
 *   → "recordings/{userId}/{roomName}/recording.mp4"
 */
export function legacyStorageKey(
  type: string,
  ...segments: string[]
): string {
  return [type, ...segments].filter(Boolean).join("/");
}

/**
 * Legacy prefix builder.
 */
export function legacyStoragePrefix(
  type: string,
  ...segments: string[]
): string {
  const key = legacyStorageKey(type, ...segments);
  return key.endsWith("/") ? key : `${key}/`;
}

/* ── Migration helpers ────────────────────────────────────────────── */

/**
 * Convert a legacy (bare) key to the new prefixed key.
 *
 *   migrateKeyToNew("recordings/uid123/room/recording.mp4")
 *   → "local/edu/recordings/uid123/room/recording.mp4"
 */
export function migrateKeyToNew(legacyKey: string): string {
  const root = getStorageRoot();
  return `${root}/${legacyKey}`;
}
