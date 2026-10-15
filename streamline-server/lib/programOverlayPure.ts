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
import { activeGraphics, normalizeRoomGraphics } from "./roomGraphicsPure";

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
  /** "#rrggbb": lower third / banner accent. */
  accentColor: string;
};

export const DEFAULT_ACCENT_COLOR = "#dc2626";

export const DEFAULT_KIT_VIDEO: KitVideoSettings = {
  showLogo: false,
  logoPosition: "top-right",
  logoSize: LOGO_SIZE_RANGE.default,
  logoOpacity: LOGO_OPACITY_RANGE.default,
  backgroundColor: "",
  backgroundImageUrl: "",
  accentColor: DEFAULT_ACCENT_COLOR,
};

/** Overlay payload in LiveKit room metadata (`programOverlay`). */
export type ProgramOverlay = {
  v: 1;
  logo: { url: string; position: LogoPosition; size: number; opacity: number } | null;
  background: { color: string; imageUrl: string } | null;
  /** Live room graphics (lib/roomGraphicsPure.ts); accent from the kit. */
  lowerThird: { name: string; title: string; accent: string } | null;
  banner: { text: string; scroll: boolean; accent: string } | null;
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
  if (v.accentColor !== undefined) {
    if (typeof v.accentColor !== "string" || !HEX_COLOR.test(v.accentColor.trim())) {
      return fail("accentColor", "accentColor must be #rrggbb");
    }
    out.accentColor = v.accentColor.trim().toLowerCase();
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
 * What the compositor draws: the kit's logo watermark and background, plus
 * the room's visible lower third and banner (styled with the kit's accent,
 * or the default accent without a kit). Null when nothing is drawn.
 * The watermark uses the kit's logo (the same image as the viewer page).
 */
export function buildProgramOverlay(
  kit: { logoUrl?: unknown; video?: unknown } | null,
  roomGraphics?: unknown
): ProgramOverlay | null {
  const video = normalizeKitVideo(kit ? kit.video : undefined);
  const logoUrl = kit && typeof kit.logoUrl === "string" ? kit.logoUrl.trim() : "";
  const logo =
    kit && video.showLogo && logoUrl && isValidLogoUrl(logoUrl)
      ? { url: logoUrl, position: video.logoPosition, size: video.logoSize, opacity: video.logoOpacity }
      : null;
  const background =
    kit && (video.backgroundColor || video.backgroundImageUrl)
      ? { color: video.backgroundColor, imageUrl: video.backgroundImageUrl }
      : null;
  const shown = activeGraphics(normalizeRoomGraphics(roomGraphics));
  const accent = video.accentColor;
  const lowerThird = shown.lowerThird ? { name: shown.lowerThird.name, title: shown.lowerThird.title, accent } : null;
  const banner = shown.banner ? { text: shown.banner.text, scroll: shown.banner.scroll, accent } : null;
  if (!logo && !background && !lowerThird && !banner) return null;
  return { v: 1, logo, background, lowerThird, banner };
}

/**
 * Room metadata with `programOverlay` set; other keys (programState, …)
 * untouched. A removed overlay is written as null (not deleted) so clients
 * can tell "branding removed" from "metadata not seeded yet". Returns null when the existing metadata isn't
 * a JSON object, so the caller skips the write instead of clobbering it.
 */
export function mergeOverlayIntoMetadata(existingJson: string | null | undefined, overlay: ProgramOverlay | null): string | null {
  return mergeRoomMetadata(existingJson, { programOverlay: overlay });
}

/**
 * Sets the given LiveKit room-metadata keys, keeping every other key. Both
 * writers (layout PATCH and overlay sync) pass BOTH keys from Firestore, so
 * whichever read-modify-write lands last still carries current values
 * instead of reverting the other writer's change (audit P2 lost updates).
 * A key that is absent from `patch` is left as it is.
 * Null when the existing metadata isn't a JSON object.
 */
export function mergeRoomMetadata(
  existingJson: string | null | undefined,
  patch: { programState?: unknown; programOverlay?: ProgramOverlay | null }
): string | null {
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
  const next: Record<string, unknown> = { ...base };
  if (patch.programState !== undefined) next.programState = patch.programState;
  if (patch.programOverlay !== undefined) next.programOverlay = patch.programOverlay;
  return JSON.stringify(next);
}
