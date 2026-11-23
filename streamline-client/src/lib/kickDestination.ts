/**
 * KICK destination helpers (manual stream-key flow). The server is the source
 * of truth (streamline-server/lib/kickDestinationPure.ts); these checks only
 * catch obvious mistakes before a request, and map server error codes to text
 * when a response carries no message. Never echo the URL or key back.
 */

export const KICK_PLATFORM = "kick";

export const KICK_SETUP_HELP =
  "In your Kick dashboard open Settings → Stream URL & Key, then paste the Server URL (rtmps://…) and the Stream Key.";

const KICK_MESSAGES: Record<string, string> = {
  kick_server_url_required: "Add the Server URL from your Kick dashboard (Settings → Stream URL & Key).",
  kick_server_url_invalid: "That Kick Server URL isn't valid. Copy the Server URL exactly as shown in your Kick dashboard.",
  kick_server_url_not_rtmps: "Kick only accepts secure ingest. The Server URL must start with rtmps://.",
  kick_server_url_key_mismatch:
    "The Server URL already ends with a different stream key. Paste only the Server URL, and the key in the Stream Key field.",
  kick_stream_key_required: "Add the Stream Key from your Kick dashboard.",
  kick_stream_key_invalid: "That Kick Stream Key isn't valid. Paste only the key (it usually starts with sk_), not a URL.",
  kick_profile_incompatible:
    "Kick was skipped: the stream's encoder settings are outside Kick's limits. Your other destinations are unaffected.",
};

export function isKickErrorCode(code: unknown): boolean {
  return typeof code === "string" && code.startsWith("kick_");
}

/** Server message first (it is fixed text, never user input), then the local map. */
export function kickErrorMessage(code: unknown, serverMessage?: unknown): string | null {
  if (!isKickErrorCode(code)) return null;
  if (typeof serverMessage === "string" && serverMessage.trim()) return serverMessage;
  return KICK_MESSAGES[code as string] || "Kick setup needs attention.";
}

/** Quick client-side check of a Server URL; null when it looks usable. */
export function kickServerUrlProblem(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return KICK_MESSAGES.kick_server_url_required;
  if (/^rtmp:\/\//i.test(s) || (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^rtmps:\/\//i.test(s))) {
    return KICK_MESSAGES.kick_server_url_not_rtmps;
  }
  if (!/^rtmps:\/\/[^\s/?#]+/i.test(s) || /[\s?#]/.test(s)) return KICK_MESSAGES.kick_server_url_invalid;
  return null;
}

/** Quick client-side check of a Stream Key; null when it looks usable. */
export function kickStreamKeyProblem(raw: string): string | null {
  const s = String(raw || "").replace(/\s+/g, "");
  if (!s) return KICK_MESSAGES.kick_stream_key_required;
  if (!/^[A-Za-z0-9._~-]{1,256}$/.test(s)) return KICK_MESSAGES.kick_stream_key_invalid;
  return null;
}

/** Error text for a failed destinations API call (apiFetchAuth throws { status, body }). */
export function destinationApiErrorMessage(err: unknown): string {
  const e = (err || {}) as { body?: { error?: unknown; message?: unknown }; message?: string };
  const body = e.body || {};
  const kick = kickErrorMessage(body?.error, body?.message);
  if (kick) return kick;
  if (body?.error === "duplicate_stream_key") return "That stream key is already saved for this platform.";
  if (body?.error === "duplicate_name") return "A destination with that name already exists for this platform.";
  if (body?.error === "LIMIT_EXCEEDED") return "You've reached your plan's destination limit.";
  return e.message || String(err);
}
