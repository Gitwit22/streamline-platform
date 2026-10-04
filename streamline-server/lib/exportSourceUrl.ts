// ============================================================================
// Export source URL allowlist (SSRF guard)
//
// The export worker downloads clip media server-side. Clip URLs come from the
// user's saved timeline, so they are untrusted. Only URLs that point at our
// own object storage (R2 endpoint / bucket host / configured public bases) are
// allowed. This module is dependency-free so it can be unit tested without
// Firebase or AWS credentials.
// ============================================================================

export const EXPORT_DOWNLOAD_LIMITS = {
  /** Abort a download that receives no bytes for this long. */
  idleTimeoutMs: 60_000,
  /** Hard cap on the total time spent downloading one source. */
  totalTimeoutMs: 15 * 60_000,
  /** Hard cap on the size of one source file. */
  maxBytes: 2 * 1024 * 1024 * 1024,
  /** Maximum redirects followed; each hop is re-validated. */
  maxRedirects: 3,
} as const;

const MAX_URL_LENGTH = 4096;

type EnvLike = Record<string, string | undefined>;

/** Extract a lowercase hostname from a URL or bare host string. */
export function hostFromBase(raw: string | undefined | null): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    const u = new URL(withScheme);
    const host = u.hostname.toLowerCase().replace(/\.$/, "");
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Hosts our own storage serves media from. Derived from the same env vars
 * storageClient.ts / hls.ts use to build URLs, plus optional extra bases.
 */
export function getAllowedExportSourceHosts(env: EnvLike = process.env): Set<string> {
  const hosts = new Set<string>();
  const add = (h: string | null) => {
    if (h) hosts.add(h);
  };

  const accountId = String(env.R2_ACCOUNT_ID ?? "").trim();
  const bucket = String(env.R2_BUCKET ?? "").trim();

  // storageClient.ts: endpoint = https://<account>.r2.cloudflarestorage.com (or R2_ENDPOINT)
  const endpointHost = accountId
    ? `${accountId}.r2.cloudflarestorage.com`.toLowerCase()
    : hostFromBase(env.R2_ENDPOINT);
  add(endpointHost);
  if (endpointHost && bucket && endpointHost.endsWith(".r2.cloudflarestorage.com")) {
    const b = bucket.toLowerCase();
    // storageClient.getPublicUrl() does a string replace that yields
    // <account>.<bucket>.r2.cloudflarestorage.com — stored asset URLs use it.
    add(endpointHost.replace("r2.cloudflarestorage.com", `${b}.r2.cloudflarestorage.com`));
    // Standard S3 virtual-hosted style: <bucket>.<account>.r2.cloudflarestorage.com
    add(`${b}.${endpointHost}`);
  }

  add(hostFromBase(env.HLS_PUBLIC_BASE_URL));
  add(hostFromBase(env.R2_PUBLIC_BASE_URL));

  for (const extra of String(env.EXPORT_SOURCE_ALLOWED_HOSTS ?? "").split(",")) {
    add(hostFromBase(extra));
  }

  return hosts;
}

export type SourceUrlCheck = { ok: boolean; url?: URL; reason?: string };

/**
 * Validate a single source URL against the allowlist.
 * Rules: https only, no credentials, default port only, host must be allowlisted.
 */
export function validateExportSourceUrl(raw: unknown, allowedHosts: Set<string>): SourceUrlCheck {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "empty_url" };
  const value = raw.trim();
  if (value.length > MAX_URL_LENGTH) return { ok: false, reason: "url_too_long" };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.protocol !== "https:") return { ok: false, reason: "https_required" };
  if (url.username || url.password) return { ok: false, reason: "credentials_not_allowed" };
  if (url.port && url.port !== "443") return { ok: false, reason: "port_not_allowed" };

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || !allowedHosts.has(host)) return { ok: false, reason: "host_not_allowed" };

  return { ok: true, url };
}

/** Resolve a redirect Location header relative to the current URL. */
export function resolveRedirectUrl(currentUrl: string, location: string | undefined | null): string | null {
  if (!location) return null;
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    return null;
  }
}

/** Safe-to-log form of a URL: origin + path, query (signatures) dropped. */
export function redactUrlForLog(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname.length > 80 ? `${u.pathname.slice(0, 80)}…` : u.pathname;
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return "<invalid-url>";
  }
}
