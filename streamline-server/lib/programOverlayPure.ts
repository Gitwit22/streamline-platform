/**
 * On-video branding (pure, no I/O).
 *
 * A brand kit's `video` settings describe what the program compositor draws
 * on every output (RTMP destinations, Instagram, HLS, recordings): the kit
 * logo as a corner watermark, and a background color or image behind the
 * layout. The server turns a room's kit into a `programOverlay` and writes it
 * into LiveKit room metadata next to `programState`; the compositor
 * (public/egress-templates/program-compositor.html) and the in-room stage
 * render it. Plan gate: entitlements.features.roomBranding.
 */
import { isValidLogoUrl } from "./hlsBrandingPure";

export const LOGO_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];

/** Logo width as a percent of the output width. */
export const LOGO_SIZE_RANGE = { min: 4, max: 30, default: 12 } as const;
export const LOGO_OPACITY_RANGE = { min: 0.1, max: 1, default: 0.9 } as const;

export type KitVideoSettings = {
  showLogo: boolean;
  logoPosition: LogoPosition;
  logoSize: number;
  logoOpacity: number;
  /** "#rrggbb" or "" (compositor default). */
  backgroundColor: string;
  /** http(s) image URL or "". */
  backgroundImageUrl: string;
};

export const DEFAULT_KIT_VIDEO: KitVideoSettings = {
  showLogo: false,
  logoPosition: "top-right",
  logoSize: LOGO_SIZE_RANGE.default,
  logoOpacity: LOGO_OPACITY_RANGE.default,
  backgroundColor: "",
  backgroundImageUrl: "",
};

/** Overlay payload in LiveKit room metadata (`programOverlay`). */
export type ProgramOverlay = {
  v: 1;
  logo: { url: string; position: LogoPosition; size: number; opacity: number } | null;
  background: { color: string; imageUrl: string } | null;
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Flat shape (no strictNullChecks on the server).
export type KitVideoParse = { ok: boolean; value?: Partial<KitVideoSettings>; field?: string; details?: string };

function fail(field: string, details: string): KitVideoParse {
  return { ok: false, field: `video.${field}`, details };
}

/** Validates the provided `video` fields (all optional). */
export function parseKitVideoInput(input: unknown): KitVideoParse {
  if (input === undefined) return { ok: true, value: {} };
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("", "video must be an object");
  const v = input as Record<string, unknown>;
  const out: Partial<KitVideoSettings> = {};

  if (v.showLogo !== undefined) {
    if (typeof v.showLogo !== "boolean") return fail("showLogo", "showLogo must be a boolean");
    out.showLogo = v.showLogo;
  }
  if (v.logoPosition !== undefined) {
    if (!(LOGO_POSITIONS as readonly unknown[]).includes(v.logoPosition)) {
      return fail("logoPosition", `logoPosition must be one of ${LOGO_POSITIONS.join(", ")}`);
    }
    out.logoPosition = v.logoPosition as LogoPosition;
  }
  if (v.logoSize !== undefined) {
    const n = Number(v.logoSize);
    if (typeof v.logoSize !== "number" || !Number.isFinite(n) || n < LOGO_SIZE_RANGE.min || n > LOGO_SIZE_RANGE.max) {
      return fail("logoSize", `logoSize must be ${LOGO_SIZE_RANGE.min}–${LOGO_SIZE_RANGE.max}`);
    }
    out.logoSize = Math.round(n);
  }
  if (v.logoOpacity !== undefined) {
    const n = Number(v.logoOpacity);
    if (typeof v.logoOpacity !== "number" || !Number.isFinite(n) || n < LOGO_OPACITY_RANGE.min || n > LOGO_OPACITY_RANGE.max) {
      return fail("logoOpacity", `logoOpacity must be ${LOGO_OPACITY_RANGE.min}–${LOGO_OPACITY_RANGE.max}`);
    }
    out.logoOpacity = Math.round(n * 100) / 100;
  }
  if (v.backgroundColor !== undefined) {
    if (typeof v.backgroundColor !== "string") return fail("backgroundColor", "backgroundColor must be a string");
    const c = v.backgroundColor.trim();
    if (c && !HEX_COLOR.test(c)) return fail("backgroundColor", "backgroundColor must be #rrggbb");
    out.backgroundColor = c.toLowerCase();
  }
  if (v.backgroundImageUrl !== undefined) {
    if (typeof v.backgroundImageUrl !== "string") return fail("backgroundImageUrl", "backgroundImageUrl must be a string");
    const u = v.backgroundImageUrl.trim();
    if (!isValidLogoUrl(u)) return fail("backgroundImageUrl", "backgroundImageUrl must be an http(s) URL");
    out.backgroundImageUrl = u;
  }
  return { ok: true, value: out };
}

/** Stored kit.video with defaults for missing or invalid values (old kits have none). */
export function normalizeKitVideo(stored: unknown): KitVideoSettings {
  const parsed = stored && typeof stored === "object" ? stored : {};
  const out: KitVideoSettings = { ...DEFAULT_KIT_VIDEO };
  for (const [k, val] of Object.entries(parsed as Record<string, unknown>)) {
    const one = parseKitVideoInput({ [k]: val });
    if (one.ok) Object.assign(out, one.value);
  }
  return out;
}

export function kitVideoEquals(a: KitVideoSettings, b: KitVideoSettings): boolean {
  return (Object.keys(DEFAULT_KIT_VIDEO) as Array<keyof KitVideoSettings>).every((k) => a[k] === b[k]);
}

/**
 * What the compositor draws for a kit, or null when the kit draws nothing.
 * The watermark uses the kit's logo (the same image as the viewer page).
 */
export function buildProgramOverlay(kit: { logoUrl?: unknown; video?: unknown } | null): ProgramOverlay | null {
  if (!kit) return null;
  const video = normalizeKitVideo(kit.video);
  const logoUrl = typeof kit.logoUrl === "string" ? kit.logoUrl.trim() : "";
  const logo =
    video.showLogo && logoUrl && isValidLogoUrl(logoUrl)
      ? { url: logoUrl, position: video.logoPosition, size: video.logoSize, opacity: video.logoOpacity }
      : null;
  const background =
    video.backgroundColor || video.backgroundImageUrl
      ? { color: video.backgroundColor, imageUrl: video.backgroundImageUrl }
      : null;
  if (!logo && !background) return null;
  return { v: 1, logo, background };
}

/**
 * Room metadata with `programOverlay` set; other keys (programState, …)
 * untouched. A removed overlay is written as null (not deleted) so clients
 * can tell "branding removed" from "metadata not seeded yet". Returns null when the existing metadata isn't
 * a JSON object, so the caller skips the write instead of clobbering it.
 */
export function mergeOverlayIntoMetadata(existingJson: string | null | undefined, overlay: ProgramOverlay | null): string | null {
  let base: Record<string, unknown> = {};
  if (existingJson) {
    try {
      const parsed = JSON.parse(existingJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      base = parsed;
    } catch {
      return null;
    }
  }
  return JSON.stringify({ ...base, programOverlay: overlay });
}
