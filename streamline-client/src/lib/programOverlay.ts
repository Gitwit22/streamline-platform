/**
 * On-video branding (corner logo, background) drawn on every output by the
 * program compositor (streamline-server/public/egress-templates/
 * program-compositor.html) and mirrored on the in-room stage.
 *
 * Source: LiveKit room metadata `programOverlay` (server:
 * streamline-server/lib/programOverlayPure.ts). The key is null when the
 * room's branding was removed, and absent until the server first seeds it;
 * in that case the overlay from GET /program-state is used.
 */
import { validateLogoUrl } from "./hlsBranding";

export const LOGO_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];

export const LOGO_SIZE_RANGE = { min: 4, max: 30, default: 12 } as const;
export const LOGO_OPACITY_RANGE = { min: 0.1, max: 1, default: 0.9 } as const;

export type KitVideoSettings = {
  showLogo: boolean;
  logoPosition: LogoPosition;
  logoSize: number;
  logoOpacity: number;
  backgroundColor: string;
  backgroundImageUrl: string;
  /** Lower third / banner accent ("#rrggbb"). */
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

export type ProgramOverlay = {
  v: 1;
  logo: { url: string; position: LogoPosition; size: number; opacity: number } | null;
  background: { color: string; imageUrl: string } | null;
  /** Live room graphics (lib/roomGraphics.ts), styled with the kit accent. */
  lowerThird: { name: string; title: string; accent: string } | null;
  banner: { text: string; scroll: boolean; accent: string } | null;
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Field errors for a kit's on-video settings ({} when valid); mirrors the server checks. */
export function validateKitVideo(v: KitVideoSettings): Partial<Record<"backgroundColor" | "backgroundImageUrl", string>> {
  const errors: Partial<Record<"backgroundColor" | "backgroundImageUrl", string>> = {};
  if (v.backgroundColor && !HEX.test(v.backgroundColor)) errors.backgroundColor = "Use a color like #112233.";
  const img = validateLogoUrl(v.backgroundImageUrl);
  if (img) errors.backgroundImageUrl = img.replace("Logo URL", "Image URL");
  return errors;
}

function safeUrl(u: unknown): string {
  if (typeof u !== "string" || !u) return "";
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.href : "";
  } catch {
    return "";
  }
}

function clamp(n: unknown, lo: number, hi: number, dflt: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
}

/** Validated overlay (unsafe URLs/colors dropped), or null when it draws nothing. */
export function normalizeProgramOverlay(raw: unknown): ProgramOverlay | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as {
    v?: unknown;
    logo?: Record<string, unknown> | null;
    background?: Record<string, unknown> | null;
    lowerThird?: Record<string, unknown> | null;
    banner?: Record<string, unknown> | null;
  };
  if (o.v !== 1) return null;
  const logoUrl = o.logo ? safeUrl(o.logo.url) : "";
  const logo = logoUrl
    ? {
        url: logoUrl,
        position: (LOGO_POSITIONS as readonly unknown[]).includes(o.logo!.position)
          ? (o.logo!.position as LogoPosition)
          : "top-right",
        size: clamp(o.logo!.size, LOGO_SIZE_RANGE.min, LOGO_SIZE_RANGE.max, LOGO_SIZE_RANGE.default),
        opacity: clamp(o.logo!.opacity, LOGO_OPACITY_RANGE.min, LOGO_OPACITY_RANGE.max, LOGO_OPACITY_RANGE.default),
      }
    : null;
  const color = o.background && typeof o.background.color === "string" && HEX.test(o.background.color) ? o.background.color : "";
  const imageUrl = o.background ? safeUrl(o.background.imageUrl) : "";
  const background = color || imageUrl ? { color, imageUrl } : null;
  const accentOf = (x: Record<string, unknown>) =>
    typeof x.accent === "string" && HEX.test(x.accent) ? x.accent : DEFAULT_ACCENT_COLOR;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const ltName = o.lowerThird ? text(o.lowerThird.name, 60) : "";
  const lowerThird = ltName
    ? { name: ltName, title: text(o.lowerThird!.title, 80), accent: accentOf(o.lowerThird!) }
    : null;
  const bnText = o.banner ? text(o.banner.text, 200) : "";
  const banner = bnText ? { text: bnText, scroll: o.banner!.scroll === true, accent: accentOf(o.banner!) } : null;
  if (!logo && !background && !lowerThird && !banner) return null;
  return { v: 1, logo, background, lowerThird, banner };
}

/**
 * The overlay from room metadata: `{ known: false }` when the server hasn't
 * written the key yet (use the GET fallback), else the (possibly null) overlay.
 */
export function programOverlayFromRoomMetadata(
  metadata: string | null | undefined
): { known: false } | { known: true; overlay: ProgramOverlay | null } {
  if (!metadata) return { known: false };
  try {
    const parsed = JSON.parse(metadata);
    if (!parsed || typeof parsed !== "object" || !("programOverlay" in parsed)) return { known: false };
    return { known: true, overlay: normalizeProgramOverlay(parsed.programOverlay) };
  } catch {
    return { known: false };
  }
}

/**
 * Same overlay a kit's settings produce (server: buildProgramOverlay), for
 * previews; `sample` adds an example lower third to show the accent.
 */
export function overlayFromKit(logoUrl: string, video: KitVideoSettings, sample = false): ProgramOverlay | null {
  return normalizeProgramOverlay({
    v: 1,
    logo: video.showLogo ? { url: logoUrl.trim(), position: video.logoPosition, size: video.logoSize, opacity: video.logoOpacity } : null,
    background: { color: video.backgroundColor, imageUrl: video.backgroundImageUrl.trim() },
    lowerThird: sample ? { name: "Your Name", title: "Lower third", accent: video.accentColor } : null,
    banner: null,
  });
}
