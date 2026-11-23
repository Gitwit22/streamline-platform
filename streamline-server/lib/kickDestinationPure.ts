/**
 * KICK as a first-class outbound destination (manual stream-key flow).
 * Pure; unit-tested in kickDestinationPure.test.ts.
 *
 * KICK ingest (help.kick.com "How to stream on Kick"): RTMPS server URL from
 * the creator dashboard + a stream key; H.264, CBR, max 8000 kbps, 2 s
 * keyframes, output up to 1920x1080.
 *
 * Secrets: the stream key and the full ingest URL (server URL + key) never
 * leave this module except as the egress target. Errors are codes with fixed
 * messages; nothing here echoes the submitted URL or key.
 */

export const KICK_PLATFORM = "kick";

export const KICK_REQUIREMENTS = {
  protocol: "rtmps",
  videoCodec: "h264",
  maxLongEdge: 1920,
  maxShortEdge: 1080,
  maxFps: 60,
  maxVideoKbps: 8000,
  keyframeIntervalSec: 2,
} as const;

export type KickErrorCode =
  | "kick_server_url_required"
  | "kick_server_url_invalid"
  | "kick_server_url_not_rtmps"
  | "kick_server_url_key_mismatch"
  | "kick_stream_key_required"
  | "kick_stream_key_invalid"
  | "kick_profile_incompatible";

export const KICK_ERROR_MESSAGES: Record<KickErrorCode, string> = {
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

export function isKickPlatform(platform: unknown): boolean {
  return String(platform || "").trim().toLowerCase() === KICK_PLATFORM;
}

/** Kick stream keys are IVS-style tokens, e.g. sk_us-west-2_AbC123. */
const KEY_PATTERN = /^[A-Za-z0-9._~-]{1,256}$/;
const EMBEDDED_KEY_PATTERN = /^sk_[A-Za-z0-9._~-]+$/;

export type KickResult<T> = ({ ok: true } & T) | { ok: false; code: KickErrorCode };

/**
 * Normalize a creator-provided Kick Server URL. Keeps host, port and ingest
 * path exactly (only trailing slashes go). A Kick key pasted onto the end of
 * the URL is split off and returned as `embeddedKey` so it is never appended
 * twice.
 */
export function normalizeKickServerUrl(raw: unknown): KickResult<{ url: string; embeddedKey: string | null }> {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return { ok: false, code: "kick_server_url_required" };
  if (/\s/.test(s)) return { ok: false, code: "kick_server_url_invalid" };
  if (/^rtmp:\/\//i.test(s)) return { ok: false, code: "kick_server_url_not_rtmps" };
  if (!/^rtmps:\/\//i.test(s)) {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(s)
      ? { ok: false, code: "kick_server_url_not_rtmps" }
      : { ok: false, code: "kick_server_url_invalid" };
  }

  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return { ok: false, code: "kick_server_url_invalid" };
  }
  // Credentials, queries and fragments have no place in an ingest URL (and
  // could carry secrets into places we display the server URL).
  if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    return { ok: false, code: "kick_server_url_invalid" };
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  let embeddedKey: string | null = null;
  if (segments.length > 0 && EMBEDDED_KEY_PATTERN.test(segments[segments.length - 1])) {
    embeddedKey = segments.pop() as string;
  }
  const path = segments.length ? `/${segments.join("/")}` : "";
  const port = parsed.port ? `:${parsed.port}` : "";
  return { ok: true, url: `rtmps://${parsed.hostname}${port}${path}`, embeddedKey };
}

/** Whitespace is dropped (copy/paste artifacts), matching the generic key normalizer. */
export function normalizeKickStreamKey(raw: unknown): KickResult<{ key: string }> {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, "") : "";
  if (!s) return { ok: false, code: "kick_stream_key_required" };
  if (!KEY_PATTERN.test(s)) return { ok: false, code: "kick_stream_key_invalid" };
  return { ok: true, key: s };
}

/**
 * Validate a Server URL + optional Stream Key together. A key embedded in
 * the URL is used when no key is given; a different explicit key is an error
 * (we can't tell which one the creator meant).
 */
export function resolveKickCredentials(input: {
  serverUrl: unknown;
  streamKey?: unknown;
  requireKey: boolean;
}): KickResult<{ serverUrl: string; streamKey: string | null }> {
  const server = normalizeKickServerUrl(input.serverUrl);
  if (server.ok === false) return server;

  const hasExplicitKey = typeof input.streamKey === "string" && input.streamKey.replace(/\s+/g, "") !== "";
  let key: string | null = null;
  if (hasExplicitKey) {
    const k = normalizeKickStreamKey(input.streamKey);
    if (k.ok === false) return k;
    key = k.key;
    if (server.embeddedKey && server.embeddedKey !== key) return { ok: false, code: "kick_server_url_key_mismatch" };
  } else if (server.embeddedKey) {
    key = server.embeddedKey;
  }
  if (input.requireKey && !key) return { ok: false, code: "kick_stream_key_required" };
  return { ok: true, serverUrl: server.url, streamKey: key };
}

/** Full ingest URL: server URL + "/" + key, with the key appended exactly once. */
export function buildKickIngestUrl(serverUrl: string, streamKey: string): string {
  const base = String(serverUrl || "").replace(/\/+$/, "");
  const key = String(streamKey || "");
  if (base.endsWith(`/${key}`)) return base;
  return `${base}/${key}`;
}

export type EncoderProfileForCheck = {
  width: number;
  height: number;
  framerate: number;
  videoBitrate: number;
  keyFrameInterval: number;
  /** Omitted = LiveKit's default for RTMP egress (H.264). */
  videoCodec?: string | null;
};

/** Does the shared egress encoder profile fit Kick's ingest limits? */
export function checkKickEncoderProfile(
  enc: EncoderProfileForCheck
): { ok: true } | { ok: false; code: "kick_profile_incompatible"; problems: string[] } {
  const r = KICK_REQUIREMENTS;
  const problems: string[] = [];
  const longEdge = Math.max(enc.width, enc.height);
  const shortEdge = Math.min(enc.width, enc.height);
  if (!(longEdge <= r.maxLongEdge && shortEdge <= r.maxShortEdge)) {
    problems.push(`resolution ${enc.width}x${enc.height} is above Kick's ${r.maxLongEdge}x${r.maxShortEdge}`);
  }
  if (!(enc.framerate > 0 && enc.framerate <= r.maxFps)) {
    problems.push(`frame rate ${enc.framerate} fps is above Kick's ${r.maxFps} fps`);
  }
  if (!(enc.videoBitrate > 0 && enc.videoBitrate <= r.maxVideoKbps)) {
    problems.push(`video bitrate ${enc.videoBitrate} kbps is above Kick's ${r.maxVideoKbps} kbps`);
  }
  if (!(enc.keyFrameInterval > 0 && enc.keyFrameInterval <= r.keyframeIntervalSec)) {
    problems.push(`keyframe interval ${enc.keyFrameInterval}s is longer than Kick's ${r.keyframeIntervalSec}s`);
  }
  const codec = String(enc.videoCodec || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (codec && !codec.startsWith("h264")) {
    problems.push(`video codec ${enc.videoCodec} is not H.264`);
  }
  return problems.length ? { ok: false, code: "kick_profile_incompatible", problems } : { ok: true };
}

/** Kick keys look like sk_<region>_<token>; scrub any that leak into an error string. */
export function scrubKickKeys(text: string | null): string | null {
  if (text === null) return null;
  return text.replace(/\bsk_[A-Za-z0-9._~-]+/g, "sk_***");
}
