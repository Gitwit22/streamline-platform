/**
 * runtimeContext — Single source of truth for environment and tenant context.
 *
 * APP_ENV  → "local" (default), "test", or "prod"
 * TENANT   → "edu" or "corporate"
 *
 * The tenant is detected from the Express request path when possible,
 * falling back to the TENANT env var (default "edu").
 */

/* ── Types ────────────────────────────────────────────────────────── */

export type AppEnv = "local" | "test" | "prod";
export type Tenant = "edu" | "corporate";

/* ── APP_ENV ──────────────────────────────────────────────────────── */

const VALID_ENVS = new Set<AppEnv>(["local", "test", "prod"]);

export function getAppEnv(): AppEnv {
  const raw = (process.env.APP_ENV || "").trim().toLowerCase();
  if (VALID_ENVS.has(raw as AppEnv)) return raw as AppEnv;
  return "local";
}

/* ── Tenant detection ─────────────────────────────────────────────── */

/**
 * Derive the tenant from a URL pathname.
 *
 * Server API paths:
 *   /api/edu/...        → "edu"
 *   /api/corp/...       → "corporate"
 *
 * Client-facing paths:
 *   /streamline/edu/... → "edu"
 *   /edu/...            → "edu"
 *   /corporate/...      → "corporate"
 *
 * Falls back to the TENANT env var (default "edu").
 */
export function getTenantFromPath(pathname: string): Tenant {
  const p = (pathname || "").toLowerCase();

  // Server API routes
  if (p.startsWith("/api/edu")) return "edu";
  if (p.startsWith("/api/corp")) return "corporate";

  // Client-facing or SSR routes
  if (p.includes("/edu")) return "edu";
  if (p.includes("/corporate") || p.includes("/corp")) return "corporate";

  // Fallback to env var
  return getTenantFromEnv();
}

/** Read TENANT from env (default: "edu"). */
export function getTenantFromEnv(): Tenant {
  const raw = (process.env.TENANT || "").trim().toLowerCase();
  if (raw === "corporate" || raw === "corp") return "corporate";
  return "edu";
}

/* ── Path roots ───────────────────────────────────────────────────── */

/**
 * Firestore document root for a given environment + tenant.
 *
 * Example: `env/local/tenants/edu`
 */
export function getDbRoot(appEnv?: AppEnv, tenant?: Tenant): string {
  const e = appEnv ?? getAppEnv();
  const t = tenant ?? getTenantFromEnv();
  return `env/${e}/tenants/${t}`;
}

/**
 * R2 / S3 key prefix for a given environment + tenant.
 *
 * Example: `local/edu`
 */
export function getStorageRoot(appEnv?: AppEnv, tenant?: Tenant): string {
  const e = appEnv ?? getAppEnv();
  const t = tenant ?? getTenantFromEnv();
  return `${e}/${t}`;
}
