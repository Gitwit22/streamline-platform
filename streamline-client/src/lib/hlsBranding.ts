/**
 * HLS viewer ("Streamline Channel") branding shared by the settings editor
 * (creator/components/HlsBrandingEditor.tsx), its live preview and the public
 * viewer (creator/pages/Live.tsx), so the preview renders exactly what viewers
 * see.
 *
 * Storage: rooms/{roomId}.hlsConfig on the saved embed's own room, edited via
 * PUT /api/rooms/:roomId/hls-config (server: routes/roomsHlsConfig.ts,
 * gated by entitlements.features.hlsCustomization). The public saved-embed
 * resolver returns it as `branding`, so it applies whichever room is live on
 * the channel and while the channel is offline.
 */

export type HlsTheme = "light" | "dark";

export type RoomHlsConfig = {
  enabled: boolean;
  title?: string;
  subtitle?: string;
  logoUrl?: string;
  offlineMessage?: string;
  theme?: HlsTheme;
  updatedAt?: string;
};

export type HlsBranding = {
  title: string;
  subtitle: string;
  logoUrl: string;
  offlineMessage: string;
  theme: HlsTheme;
};

/** Mirrors the server limits (streamline-server/lib/hlsBrandingPure.ts). */
export const HLS_BRANDING_LIMITS = {
  title: 80,
  subtitle: 160,
  logoUrl: 2048,
  offlineMessage: 300,
} as const;

export const DEFAULT_OFFLINE_MESSAGE = "When the host goes live, playback will start automatically.";
export const DEFAULT_VIEWER_LOGO_URL = "/logo.png";

export const EMPTY_BRANDING: HlsBranding = {
  title: "",
  subtitle: "",
  logoUrl: "",
  offlineMessage: "",
  theme: "dark",
};

/** Normalizes a stored hlsConfig (or public `branding`) into editable branding. */
export function brandingFromConfig(cfg: Partial<RoomHlsConfig> | Partial<HlsBranding> | null | undefined): HlsBranding {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    title: s(cfg?.title),
    subtitle: s(cfg?.subtitle),
    logoUrl: s(cfg?.logoUrl),
    // The server default "This stream is offline." is the old placeholder; keep it as typed.
    offlineMessage: s(cfg?.offlineMessage),
    theme: cfg?.theme === "light" ? "light" : "dark",
  };
}

/** Returns an error message, or null when the logo URL is acceptable (empty = default logo). */
export function validateLogoUrl(raw: string): string | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  if (v.length > HLS_BRANDING_LIMITS.logoUrl) return "Logo URL is too long.";
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "Enter a full image URL starting with https://";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "Logo URL must start with https://";
  if (!u.hostname) return "Enter a full image URL starting with https://";
  return null;
}

/** Field-level validation for the editor; returns { field: message }. */
export function validateBranding(b: HlsBranding): Partial<Record<keyof HlsBranding, string>> {
  const errors: Partial<Record<keyof HlsBranding, string>> = {};
  if (b.title.length > HLS_BRANDING_LIMITS.title) errors.title = `Title must be ${HLS_BRANDING_LIMITS.title} characters or less.`;
  if (b.subtitle.length > HLS_BRANDING_LIMITS.subtitle) {
    errors.subtitle = `Subtitle must be ${HLS_BRANDING_LIMITS.subtitle} characters or less.`;
  }
  if (b.offlineMessage.length > HLS_BRANDING_LIMITS.offlineMessage) {
    errors.offlineMessage = `Offline message must be ${HLS_BRANDING_LIMITS.offlineMessage} characters or less.`;
  }
  const logoErr = validateLogoUrl(b.logoUrl);
  if (logoErr) errors.logoUrl = logoErr;
  return errors;
}

export function brandingEquals(a: HlsBranding, b: HlsBranding): boolean {
  return (
    a.title === b.title &&
    a.subtitle === b.subtitle &&
    a.logoUrl.trim() === b.logoUrl.trim() &&
    a.offlineMessage === b.offlineMessage &&
    a.theme === b.theme
  );
}

export type ResolvedViewerBranding = {
  title: string;
  subtitle: string;
  /** Custom logo URL, or "" for the default StreamLine mark. */
  logoUrl: string;
  offlineMessage: string;
  isLightTheme: boolean;
};

/**
 * What the public viewer renders. Channel branding (saved embed) wins over
 * the live room's own hlsConfig; empty fields fall back to the embed's name /
 * description, then generic defaults.
 */
export function resolveViewerBranding(params: {
  channelBranding?: Partial<HlsBranding> | null;
  roomConfig?: Partial<RoomHlsConfig> | null;
  embedName?: string | null;
  embedDescription?: string | null;
  roomName?: string | null;
}): ResolvedViewerBranding {
  const ch = params.channelBranding || null;
  const room = params.roomConfig || null;
  const pick = (k: "title" | "subtitle" | "logoUrl" | "offlineMessage") =>
    String((ch && typeof ch[k] === "string" && ch[k]!.trim()) || (room && typeof room[k] === "string" && room[k]!.trim()) || "");
  const theme = (ch ? ch.theme : undefined) || room?.theme || "dark";
  const logo = pick("logoUrl");
  const offline = pick("offlineMessage");
  return {
    title: pick("title") || String(params.embedName || params.roomName || "").trim() || "StreamLine",
    subtitle: pick("subtitle") || String(params.embedDescription || "").trim() || "Live Viewer",
    logoUrl: logo && !validateLogoUrl(logo) ? logo : "",
    // "This stream is offline." was the server's placeholder default; show the friendlier hint instead.
    offlineMessage: offline && offline !== "This stream is offline." ? offline : DEFAULT_OFFLINE_MESSAGE,
    isLightTheme: theme === "light",
  };
}
