/**
 * Validation for HLS viewer branding (rooms/{roomId}.hlsConfig title /
 * subtitle / logoUrl / offlineMessage / theme). Used by
 * PUT /api/rooms/:roomId/hls-config; the public viewer (/live/:savedEmbedId)
 * renders these values.
 */

export const HLS_BRANDING_LIMITS = {
  title: 80,
  subtitle: 160,
  logoUrl: 2048,
  offlineMessage: 300,
} as const;

// (Flat shape: the server compiles without strictNullChecks, so union narrowing on `ok` is unavailable.)
export type BrandingValidation = { ok: boolean; field?: string; details?: string };

/** Logo URLs must be absolute http(s) (rendered as <img src>; no data:/javascript:). */
export function isValidLogoUrl(raw: string): boolean {
  const v = raw.trim();
  if (!v) return true; // empty = default logo
  if (v.length > HLS_BRANDING_LIMITS.logoUrl) return false;
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname;
  } catch {
    return false;
  }
}

/** Length + URL checks for branding strings already known to be strings or undefined. */
export function validateBrandingInput(body: {
  title?: unknown;
  subtitle?: unknown;
  logoUrl?: unknown;
  offlineMessage?: unknown;
}): BrandingValidation {
  const fields = ["title", "subtitle", "logoUrl", "offlineMessage"] as const;
  for (const f of fields) {
    const v = body[f];
    if (v === undefined) continue;
    if (typeof v !== "string") return { ok: false, field: f, details: `${f} must be a string` };
    if (v.length > HLS_BRANDING_LIMITS[f]) {
      return { ok: false, field: f, details: `${f} must be ${HLS_BRANDING_LIMITS[f]} characters or less` };
    }
  }
  if (typeof body.logoUrl === "string" && !isValidLogoUrl(body.logoUrl)) {
    return { ok: false, field: "logoUrl", details: "logoUrl must be an http(s) URL" };
  }
  return { ok: true };
}

/** Public-safe branding subset of an hlsConfig (no enabled/updatedAt internals needed by viewers). */
export function publicBranding(cfg: any): {
  title: string;
  subtitle: string;
  logoUrl: string;
  offlineMessage: string;
  theme: "light" | "dark";
} | null {
  if (!cfg || typeof cfg !== "object") return null;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    title: s(cfg.title),
    subtitle: s(cfg.subtitle),
    logoUrl: isValidLogoUrl(s(cfg.logoUrl)) ? s(cfg.logoUrl).trim() : "",
    offlineMessage: s(cfg.offlineMessage),
    theme: cfg.theme === "light" ? "light" : "dark",
  };
}

/**
 * Older channels were created with this placeholder stored as their offline
 * message. It is not something the owner typed, so viewers get the friendly
 * default instead. A message the owner saves through the editor is marked
 * `offlineMessageCustom` and always shown as typed, even if it's this text.
 */
export const LEGACY_OFFLINE_PLACEHOLDER = "This stream is offline.";

/** Stored hlsConfig with the seeded (never typed) placeholder removed. */
export function normalizeStoredHlsConfig<T extends Record<string, any>>(cfg: T): T {
  if (!cfg || typeof cfg !== "object") return cfg;
  if (cfg.offlineMessage === LEGACY_OFFLINE_PLACEHOLDER && cfg.offlineMessageCustom !== true) {
    return { ...cfg, offlineMessage: "" };
  }
  return cfg;
}

/** Same checks as validateBrandingInput, for an hlsConfig override object (theme validated by the caller). */
export function validateHlsConfigBranding(cfg: { title?: unknown; subtitle?: unknown; logoUrl?: unknown; offlineMessage?: unknown }): BrandingValidation {
  return validateBrandingInput({
    title: cfg.title,
    subtitle: cfg.subtitle,
    logoUrl: cfg.logoUrl,
    offlineMessage: cfg.offlineMessage,
  });
}
