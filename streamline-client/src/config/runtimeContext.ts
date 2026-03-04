/**
 * runtimeContext (client-side) — Exposes APP_ENV for display / diagnostics.
 *
 * All DB and storage isolation lives server-side. The client only needs
 * to know the environment (local / test / prod) for badge display and
 * to pass it as a header when needed.
 *
 * Set via Vite env var: VITE_APP_ENV (defaults to "local").
 */

export type AppEnv = "local" | "test" | "prod";
export type Tenant = "edu" | "corporate";

const VALID_ENVS = new Set<AppEnv>(["local", "test", "prod"]);

export function getAppEnv(): AppEnv {
  const raw = (import.meta.env.VITE_APP_ENV || "").trim().toLowerCase();
  if (VALID_ENVS.has(raw as AppEnv)) return raw as AppEnv;
  return "local";
}

/**
 * Detect tenant from the current URL path.
 * /edu/...       → "edu"
 * /corporate/... → "corporate"
 * Default        → "edu"
 */
export function getTenantFromPath(): Tenant {
  const p = window.location.pathname.toLowerCase();
  if (p.includes("/corporate") || p.includes("/corp")) return "corporate";
  return "edu";
}

/** True when NOT in production — useful for showing dev badges / warnings. */
export function isNonProd(): boolean {
  return getAppEnv() !== "prod";
}
