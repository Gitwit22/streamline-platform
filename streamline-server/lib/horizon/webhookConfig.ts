/**
 * Horizon webhook configuration — env-var driven, with shared-secret support.
 *
 * Env vars:
 *   HORIZON_CHAT_EVENT_URL   — receiver for chat events  (default: http://10.0.0.27:3000/api/streamline/chat-event)
 *   HORIZON_VOICE_EVENT_URL  — receiver for voice events  (default: http://10.0.0.27:3000/api/streamline/voice-event)
 *   HORIZON_WEBHOOK_SECRET   — optional HMAC/bearer secret for outbound signatures
 *   HORIZON_WEBHOOK_TIMEOUT  — request timeout in ms      (default: 5000)
 *   HORIZON_WEBHOOK_RETRIES  — max retries on transient failures (default: 2)
 */
import { timingSafeEqual } from "node:crypto";

const DEFAULT_CHAT_EVENT_URL = "http://10.0.0.27:3000/api/streamline/chat-event";
const DEFAULT_VOICE_EVENT_URL = "http://10.0.0.27:3000/api/streamline/voice-event";

export interface HorizonWebhookConfig {
  chatEventUrl: string;
  voiceEventUrl: string;
  /** Shared secret used for outbound Authorization header & inbound validation. */
  webhookSecret: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Maximum retries for transient (5xx / network) errors. */
  maxRetries: number;
}

let _cached: HorizonWebhookConfig | null = null;

export function getHorizonWebhookConfig(): HorizonWebhookConfig {
  if (_cached) return _cached;

  const cfg: HorizonWebhookConfig = {
    chatEventUrl: envStr("HORIZON_CHAT_EVENT_URL", DEFAULT_CHAT_EVENT_URL),
    voiceEventUrl: envStr("HORIZON_VOICE_EVENT_URL", DEFAULT_VOICE_EVENT_URL),
    webhookSecret: envStr("HORIZON_WEBHOOK_SECRET", ""),
    timeoutMs: envInt("HORIZON_WEBHOOK_TIMEOUT", 5_000),
    maxRetries: envInt("HORIZON_WEBHOOK_RETRIES", 2),
  };

  _cached = cfg;
  return cfg;
}

/** Verify an inbound bearer token against the configured webhook secret.
 *  Uses constant-time comparison to prevent timing attacks. */
export function verifyHorizonSecret(bearerToken: string | undefined): boolean {
  const secret = getHorizonWebhookConfig().webhookSecret;
  if (!secret) return true; // no secret configured → allow (internal network trust)
  if (!bearerToken) return false;
  const raw = bearerToken.startsWith("Bearer ") ? bearerToken.slice(7) : bearerToken;
  const a = Buffer.from(raw);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function envStr(key: string, fallback: string): string {
  const v = process.env[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : fallback;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}
