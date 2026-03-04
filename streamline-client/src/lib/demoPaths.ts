/**
 * demoPaths — Client-side helpers that generate test-namespace paths
 * matching the server's env/tenant isolation conventions.
 *
 * When demo/bypass mode is active, all data references (document IDs,
 * storage keys, collection paths) are mapped to the "test" environment
 * so they never collide with local dev or production data.
 *
 * ## Firestore mapping
 *   demoDbRoot("edu")            → "env/test/tenants/edu"
 *   demoDbPath("edu", "events")  → "env/test/tenants/edu/events"
 *   demoDocId("edu", "events")   → "test-edu-evt-{random}"
 *
 * ## R2 / S3 storage mapping
 *   demoStorageKey("edu", "recordings", userId, roomId, "recording.mp4")
 *     → "test/edu/recordings/{userId}/{roomId}/recording.mp4"
 *
 *   demoStoragePrefix("edu", "recordings", userId)
 *     → "test/edu/recordings/{userId}/"
 *
 * These mirror the server-side pattern in:
 *   - streamline-server/lib/runtimeContext.ts  (getDbRoot / getStorageRoot)
 *   - streamline-server/lib/dbPaths.ts         (tenantCol / tenantDoc)
 *   - streamline-server/lib/storagePaths.ts    (storageKey / storagePrefix)
 */

/* ── Constants ────────────────────────────────────────────────────── */

/** Demo data always lives in the "test" environment namespace. */
const DEMO_ENV = "test" as const;

export type DemoTenant = "edu" | "corporate";

export type DemoStorageType =
  | "recordings"
  | "hls"
  | "thumbnails"
  | "uploads"
  | "exports"
  | "assets"
  | "tmp"
  | "test";

/* ── Firestore path helpers ───────────────────────────────────────── */

/**
 * Root Firestore path for demo data of a given tenant.
 *
 *   demoDbRoot("edu")  → "env/test/tenants/edu"
 */
export function demoDbRoot(tenant: DemoTenant): string {
  return `env/${DEMO_ENV}/tenants/${tenant}`;
}

/**
 * Firestore collection path for demo data.
 *
 *   demoDbPath("edu", "events")  → "env/test/tenants/edu/events"
 */
export function demoDbPath(tenant: DemoTenant, collection: string): string {
  return `${demoDbRoot(tenant)}/${collection}`;
}

/**
 * Generate a demo document ID with tenant + type prefix.
 *
 *   demoDocId("edu", "evt")  → "test-edu-evt-1718832000000"
 */
export function demoDocId(tenant: DemoTenant, typePrefix: string): string {
  return `${DEMO_ENV}-${tenant}-${typePrefix}-${Date.now()}`;
}

/**
 * Generate a stable (seeded) demo document ID — for pre-populated data.
 *
 *   demoSeedId("edu", "rec", 1)  → "test-edu-rec-1"
 */
export function demoSeedId(tenant: DemoTenant, typePrefix: string, n: number): string {
  return `${DEMO_ENV}-${tenant}-${typePrefix}-${n}`;
}

/* ── R2 / S3 storage key helpers ──────────────────────────────────── */

/**
 * Storage root prefix for demo data.
 *
 *   demoStorageRoot("edu")  → "test/edu"
 */
export function demoStorageRoot(tenant: DemoTenant): string {
  return `${DEMO_ENV}/${tenant}`;
}

/**
 * Build a fully-qualified demo storage key.
 *
 *   demoStorageKey("edu", "recordings", "uid1", "room1", "recording.mp4")
 *   → "test/edu/recordings/uid1/room1/recording.mp4"
 */
export function demoStorageKey(
  tenant: DemoTenant,
  type: DemoStorageType,
  ...segments: string[]
): string {
  return [demoStorageRoot(tenant), type, ...segments].filter(Boolean).join("/");
}

/**
 * Build a demo storage prefix (with trailing slash).
 *
 *   demoStoragePrefix("edu", "recordings", "uid1")
 *   → "test/edu/recordings/uid1/"
 */
export function demoStoragePrefix(
  tenant: DemoTenant,
  type: DemoStorageType,
  ...segments: string[]
): string {
  const key = demoStorageKey(tenant, type, ...segments);
  return key.endsWith("/") ? key : `${key}/`;
}

/* ── localStorage key convention ──────────────────────────────────── */

/**
 * Maps a localStorage demo key to its corresponding Firestore collection.
 *
 * This documents the convention for future server-side migration:
 *
 *   sl_edu_demo_people_v1    → env/test/tenants/edu/people
 *   sl_edu_events_v1         → env/test/tenants/edu/events
 *   sl_edu_demo_settings_v1  → env/test/tenants/edu/org (settings doc)
 *   sl_corporate_bypass data → env/test/tenants/corporate/{collection}
 */
export const DEMO_STORE_MAP = {
  // EDU stores
  sl_edu_demo_people_v1:   demoDbPath("edu", "people"),
  sl_edu_events_v1:        demoDbPath("edu", "events"),
  sl_edu_demo_settings_v1: demoDbPath("edu", "org"),

  // Corporate stores (in-memory, but mapped for reference)
  corporate_broadcasts:    demoDbPath("corporate", "broadcasts"),
  corporate_calls:         demoDbPath("corporate", "calls"),
  corporate_documents:     demoDbPath("corporate", "documents"),
  corporate_training:      demoDbPath("corporate", "training"),
  corporate_chat:          demoDbPath("corporate", "chat"),
} as const;
