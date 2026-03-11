/**
 * Horizon Bot – Event types & outbound dispatcher.
 *
 * When HORIZON_WEBHOOK_URL is configured, StreamLine will POST event payloads
 * to that URL with:
 *   - Authorization: Bearer <HORIZON_BEARER_TOKEN>
 *   - X-Horizon-Signature: sha256=<HMAC-SHA256 of body using HORIZON_WEBHOOK_SECRET>
 *   - Content-Type: application/json
 *
 * Events are dispatched fire-and-forget: failures are logged but never block
 * the main request path.
 */

import { signPayload } from "./hmac";

// ---------------------------------------------------------------------------
// Event type definitions
// ---------------------------------------------------------------------------

export type HorizonEventType =
  | "chat.message"
  | "chat.session_start"
  | "chat.session_end"
  | "voice.participant_joined"
  | "voice.participant_left"
  | "voice.room_started"
  | "voice.room_ended"
  | "voice.egress_ended"
  | "support.alert";

export interface HorizonEvent {
  /** Unique event identifier (UUID-like, for idempotency). */
  id: string;
  /** ISO-8601 timestamp of when the event was created. */
  timestamp: string;
  /** Event type discriminator. */
  type: HorizonEventType;
  /** Event-specific payload. */
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Configuration helpers (read once per call – cheap & hot-reload friendly)
// ---------------------------------------------------------------------------

function getConfig(): {
  webhookUrl: string | null;
  bearerToken: string | null;
  webhookSecret: string | null;
} {
  return {
    webhookUrl: process.env.HORIZON_WEBHOOK_URL?.trim() || null,
    bearerToken: process.env.HORIZON_BEARER_TOKEN?.trim() || null,
    webhookSecret: process.env.HORIZON_WEBHOOK_SECRET?.trim() || null,
  };
}

/** Returns true when enough env vars are set to dispatch outbound events. */
export function isHorizonEnabled(): boolean {
  const cfg = getConfig();
  return !!(cfg.webhookUrl && cfg.webhookSecret);
}

// ---------------------------------------------------------------------------
// Simple crypto-random ID (avoids external dependency)
// ---------------------------------------------------------------------------

function eventId(): string {
  const bytes = new Uint8Array(16);
  // Use Node crypto for random bytes
  require("crypto").randomFillSync(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Format as UUID v4-ish: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

// ---------------------------------------------------------------------------
// Outbound dispatch (fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Dispatch an event to the configured Horizon webhook URL.
 *
 * This function never throws – errors are logged to the console so the
 * caller's main flow is never impacted.
 */
export async function dispatchHorizonEvent(
  type: HorizonEventType,
  data: Record<string, unknown>
): Promise<void> {
  const cfg = getConfig();
  if (!cfg.webhookUrl || !cfg.webhookSecret) return; // silently skip if not configured

  const event: HorizonEvent = {
    id: eventId(),
    timestamp: new Date().toISOString(),
    type,
    data,
  };

  const body = JSON.stringify(event);
  const signature = signPayload(cfg.webhookSecret, body);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Horizon-Signature": signature,
  };
  if (cfg.bearerToken) {
    headers["Authorization"] = `Bearer ${cfg.bearerToken}`;
  }

  try {
    const resp = await fetch(cfg.webhookUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10_000), // 10 s hard timeout
    });

    console.log("[horizon-dispatch]", {
      type,
      eventId: event.id,
      status: resp.status,
      ok: resp.ok,
    });
  } catch (err: any) {
    // Fire-and-forget: log but don't rethrow.
    console.error("[horizon-dispatch] Failed to deliver event:", {
      type,
      eventId: event.id,
      error: err?.message || err,
    });
  }
}

// ---------------------------------------------------------------------------
// Convenience builders for Phase 1 event types
// ---------------------------------------------------------------------------

export function chatMessageEvent(opts: {
  roomId: string;
  sessionId: string;
  messageId: string;
  text: string;
  sender: { identity: string; uid?: string | null; role: string; name?: string | null };
}): void {
  dispatchHorizonEvent("chat.message", opts);
}

export function chatSessionStartEvent(opts: {
  roomId: string;
  sessionId: string;
}): void {
  dispatchHorizonEvent("chat.session_start", opts);
}

export function chatSessionEndEvent(opts: {
  roomId: string;
  sessionId: string;
}): void {
  dispatchHorizonEvent("chat.session_end", opts);
}

export function voiceRoomEvent(
  type: "voice.participant_joined" | "voice.participant_left" | "voice.room_started" | "voice.room_ended" | "voice.egress_ended",
  opts: Record<string, unknown>
): void {
  dispatchHorizonEvent(type, opts);
}
