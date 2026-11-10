/**
 * Viewer playback authorization — client state machine (pure; unit-tested).
 *
 * The server decides who may watch a channel (POST
 * /api/public/{channels|rooms}/:id/playback) and answers with:
 *   200 → a playback URL (public direct URL, or a short-lived signed API path)
 *         or playbackUrl:null while the stream is offline
 *   401 → sign in (registered channels)
 *   402 → buy a ticket (pay-per-view)
 *   403 → private / subscribers-only / tickets not on sale
 *   404 → channel/room gone (or an older server without the endpoint)
 */

export type ViewerAccessMode = "public" | "registered" | "subscriber" | "pay_per_view" | "private";

export interface CheckoutInfo {
  eventId: string;
  eventName: string;
  monetizationMode: "off" | "fixed" | "pwyw" | "donation";
  currency: string;
  fixedAmountCents: number | null;
  pwywMinCents: number | null;
}

export type PlaybackGate =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "granted"; url: string; expiresAt: number | null; protected: boolean; mode: ViewerAccessMode }
  | {
      kind: "waiting_live";
      mode: ViewerAccessMode;
      /** PPV: "other_event" = the room is live for a different show than this ticket's. */
      reason?: "offline" | "other_event";
    }
  | { kind: "checkout"; checkout: CheckoutInfo | null; message: string; mode: ViewerAccessMode }
  | { kind: "login"; message: string }
  | {
      kind: "forbidden";
      reason:
        | "private"
        | "subscriber_not_available"
        | "ppv_unavailable"
        | "ppv_event_ended"
        | "ppv_broadcast_unassigned"
        | "event_not_found"
        | "unknown";
      message: string;
    }
  | { kind: "not_found" }
  | { kind: "unavailable"; message: string };

const MODES: ViewerAccessMode[] = ["public", "registered", "subscriber", "pay_per_view", "private"];

const FORBIDDEN_REASONS = [
  "private",
  "subscriber_not_available",
  "ppv_unavailable",
  "ppv_event_ended",
  "ppv_broadcast_unassigned",
  "event_not_found",
] as const;
type ForbiddenReason = (typeof FORBIDDEN_REASONS)[number] | "unknown";

const FORBIDDEN_FALLBACK: Record<ForbiddenReason, string> = {
  private: "This stream is private.",
  subscriber_not_available: "This stream is for subscribers only. Subscriptions are coming soon.",
  ppv_unavailable: "Tickets for this stream are not on sale right now.",
  ppv_event_ended: "This event has ended.",
  ppv_broadcast_unassigned: "This stream isn't available right now. The host has been notified.",
  event_not_found: "This event isn't on this channel.",
  unknown: "You don't have access to this stream.",
};

export function asAccessMode(v: unknown): ViewerAccessMode {
  return typeof v === "string" && (MODES as string[]).includes(v) ? (v as ViewerAccessMode) : "public";
}

/** API paths ("/api/hls/play/…") are made absolute against the API base. */
export function resolvePlaybackUrl(url: string, apiBase: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${String(apiBase || "").replace(/\/+$/, "")}${url}`;
  return url;
}

export function interpretPlaybackResponse(httpStatus: number, body: any, apiBase: string): PlaybackGate {
  const b = body && typeof body === "object" ? body : {};
  const mode = asAccessMode(b.mode);
  const message = typeof b.message === "string" && b.message ? b.message : "";

  if (httpStatus >= 200 && httpStatus < 300) {
    if (typeof b.playbackUrl === "string" && b.playbackUrl) {
      return {
        kind: "granted",
        url: resolvePlaybackUrl(b.playbackUrl, apiBase),
        expiresAt: typeof b.expiresAt === "number" && Number.isFinite(b.expiresAt) ? b.expiresAt : null,
        protected: b.protected === true,
        mode,
      };
    }
    const reason = b.waiting === "other_event" ? "other_event" : b.waiting === "offline" ? "offline" : undefined;
    return reason ? { kind: "waiting_live", mode, reason } : { kind: "waiting_live", mode };
  }
  if (httpStatus === 401) return { kind: "login", message: message || "Sign in to watch this stream." };
  if (httpStatus === 402) {
    const c = b.checkout && typeof b.checkout === "object" ? b.checkout : null;
    return {
      kind: "checkout",
      mode: "pay_per_view",
      message: message || "Buy a ticket to watch this stream.",
      checkout: c && typeof c.eventId === "string" ? (c as CheckoutInfo) : null,
    };
  }
  if (httpStatus === 403 || (httpStatus === 404 && b.error === "event_not_found")) {
    const reason = (FORBIDDEN_REASONS as readonly string[]).includes(b.error) ? (b.error as ForbiddenReason) : "unknown";
    return { kind: "forbidden", reason, message: message || FORBIDDEN_FALLBACK[reason] };
  }
  if (httpStatus === 404) return { kind: "not_found" };
  return { kind: "unavailable", message: "Playback is temporarily unavailable. Retrying…" };
}

/**
 * When to renew a signed URL: at ~2/3 of its remaining lifetime (min 5s).
 * null for URLs that never expire (public channels).
 */
export function playbackRenewDelayMs(expiresAt: number | null | undefined, nowMs: number): number | null {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  const remaining = expiresAt - nowMs;
  return Math.max(5_000, Math.floor((remaining * 2) / 3));
}

export function playbackTokenOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /[?&]token=([^&#]*)/.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** Replace the token query param of an API playlist URL (hls.js xhrSetup). */
export function swapPlaybackToken(url: string, token: string | null | undefined): string {
  if (!token || !url.includes("/api/hls/play/")) return url;
  const enc = encodeURIComponent(token);
  if (/[?&]token=[^&#]*/.test(url)) return url.replace(/([?&])token=[^&#]*/, `$1token=${enc}`);
  return `${url}${url.includes("?") ? "&" : "?"}token=${enc}`;
}

/** Same stream target ignoring the token (renewals keep the player attached). */
export function samePlaybackTarget(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const strip = (u: string) => u.replace(/([?&])token=[^&#]*&?/, "$1").replace(/[?&]$/, "");
  return strip(a) === strip(b);
}

/**
 * Player URL after a new grant: keep the attached URL when only the token
 * changed (hls.js swaps the token per request); native HLS (Safari) cannot
 * swap tokens, so it takes the fresh URL.
 */
export function nextPlayerUrl(current: string | null, granted: string, nativeHls: boolean): string {
  if (!current || nativeHls) return granted;
  return samePlaybackTarget(current, granted) ? current : granted;
}

/** After returning from Stripe Checkout: keep polling while the webhook lands. */
export const CHECKOUT_RETURN_MAX_ATTEMPTS = 30;
export function shouldKeepPollingAfterCheckout(gate: PlaybackGate, attempt: number): boolean {
  if (attempt >= CHECKOUT_RETURN_MAX_ATTEMPTS) return false;
  return gate.kind === "checkout" || gate.kind === "pending" || gate.kind === "unavailable";
}

export function formatPrice(cents: number | null | undefined, currency = "usd"): string {
  const n = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(n / 100);
  } catch {
    return `$${(n / 100).toFixed(2)}`;
  }
}
