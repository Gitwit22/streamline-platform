/**
 * HLS playback tokens (pure; unit-tested).
 *
 * token = base64url(JSON payload) "." base64url(HMAC-SHA256(secret, payloadB64))
 *
 * Payload:
 *   v    – format version (1)
 *   r    – roomId the token is bound to (path binding: /api/hls/play/<r>/…)
 *   k    – HLS run id (rooms/{r}.hls.runId); a new go-live invalidates tokens
 *   exp  – expiry, unix seconds
 *   e    – viewerEntitlements doc id that granted access (re-checked for
 *          revocation on playlist fetches), optional
 *   m    – access mode at issue time (diagnostics only)
 *
 * The format is deliberately simple so an edge worker (Cloudflare Worker in
 * front of R2) can validate the same tokens with the shared
 * HLS_PLAYBACK_SECRET, if playlist proxying moves to the edge later.
 */
import crypto from "crypto";

export interface PlaybackTokenPayload {
  v: 1;
  r: string;
  k: string | null;
  exp: number;
  e?: string | null;
  m?: string;
}

export type PlaybackTokenVerify =
  | { ok: true; payload: PlaybackTokenPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_room" | "wrong_run" };

/** Default lifetime of a playback token (seconds). Clients renew at ~2/3. */
export const DEFAULT_PLAYBACK_TOKEN_TTL_SEC = 30 * 60;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function mac(secret: string, data: string): string {
  return b64url(crypto.createHmac("sha256", secret).update(data).digest());
}

export function signPlaybackToken(
  secret: string,
  input: { roomId: string; runId: string | null; ttlSec: number; entitlementId?: string | null; mode?: string },
  nowMs: number = Date.now()
): { token: string; expiresAt: number } {
  if (!secret) throw new Error("playback_secret_missing");
  const exp = Math.floor(nowMs / 1000) + Math.max(1, Math.floor(input.ttlSec));
  const payload: PlaybackTokenPayload = { v: 1, r: input.roomId, k: input.runId ?? null, exp };
  if (input.entitlementId) payload.e = input.entitlementId;
  if (input.mode) payload.m = input.mode;
  const body = b64url(JSON.stringify(payload));
  return { token: `${body}.${mac(secret, body)}`, expiresAt: exp * 1000 };
}

export function verifyPlaybackToken(
  secret: string,
  token: unknown,
  expect: { roomId: string; runId?: string | null },
  nowMs: number = Date.now()
): PlaybackTokenVerify {
  if (!secret || typeof token !== "string" || token.length > 2048) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, sig] = parts;
  const expected = mac(secret, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };

  let payload: PlaybackTokenPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload || payload.v !== 1 || typeof payload.r !== "string" || typeof payload.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if (Math.floor(nowMs / 1000) >= payload.exp) return { ok: false, reason: "expired" };
  if (payload.r !== expect.roomId) return { ok: false, reason: "wrong_room" };
  if (expect.runId !== undefined && (payload.k ?? null) !== (expect.runId ?? null)) {
    return { ok: false, reason: "wrong_run" };
  }
  return { ok: true, payload };
}

/**
 * HLS_PLAYBACK_SECRET (>= 32 chars). Production/staging without it: null, so
 * protected playback fails closed (503) instead of using a guessable secret.
 */
export function getPlaybackSecret(env: Record<string, string | undefined> = process.env): string | null {
  const raw = String(env.HLS_PLAYBACK_SECRET || "").trim();
  if (raw.length >= 32) return raw;
  const nodeEnv = String(env.NODE_ENV || "development").toLowerCase();
  if (nodeEnv === "production" || nodeEnv === "staging") return null;
  return raw || "dev-only-hls-playback-secret-not-for-production";
}

export function getPlaybackTokenTtlSec(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.HLS_PLAYBACK_TOKEN_TTL_SEC);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PLAYBACK_TOKEN_TTL_SEC;
  return Math.min(Math.max(Math.floor(n), 60), 6 * 60 * 60);
}
