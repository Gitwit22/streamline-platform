/**
 * Webhook dispatcher for the StreamLine platform event hook system.
 *
 * Responsibilities:
 *   1. Accept a normalized StreamlineEventPayload.
 *   2. Resolve the destination URL from env-var configuration.
 *   3. HMAC-sign the outgoing payload.
 *   4. POST the payload with appropriate headers.
 *   5. Log delivery results to the Firestore `webhookDeliveries` collection.
 *   6. Retry transient failures (configurable).
 *   7. Never block the calling code path.
 */

import { signPayload } from "../lib/hmac";
import type { StreamlineEventPayload } from "./eventTypes";
import { eventCategory, type EventCategory } from "./eventTypes";

// ---------------------------------------------------------------------------
// Configuration (read from env vars)
// ---------------------------------------------------------------------------

function getConfig() {
  return {
    enabled: process.env.STREAMLINE_HOOKS_ENABLED === "true",
    secret: process.env.STREAMLINE_WEBHOOK_SECRET?.trim() || null,
    timeoutMs: parseInt(
      process.env.STREAMLINE_WEBHOOK_TIMEOUT_MS || "5000",
      10
    ),
    retryCount: parseInt(
      process.env.STREAMLINE_WEBHOOK_RETRY_COUNT || "3",
      10
    ),
  };
}

/** Map event categories to their destination env-var names. */
const DESTINATION_ENV_KEYS: Record<EventCategory, string> = {
  chat: "STREAMLINE_CHAT_EVENT_URL",
  voice: "STREAMLINE_VOICE_EVENT_URL",
  support: "STREAMLINE_SUPPORT_EVENT_URL",
  monitoring: "STREAMLINE_MONITORING_EVENT_URL",
  alert: "STREAMLINE_ALERT_EVENT_URL",
  room: "STREAMLINE_ROOM_EVENT_URL",
};

function getDestinationUrl(category: EventCategory): string | null {
  const key = DESTINATION_ENV_KEYS[category];
  return process.env[key]?.trim() || null;
}

// ---------------------------------------------------------------------------
// Unique ID generator (same approach as horizonEvents.ts)
// ---------------------------------------------------------------------------

function deliveryId(): string {
  const bytes = new Uint8Array(16);
  require("crypto").randomFillSync(bytes);
  const hex = Array.from(bytes)
    .map((b: number) => b.toString(16).padStart(2, "0"))
    .join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

// ---------------------------------------------------------------------------
// Firestore delivery log (lazy import to avoid circular deps at boot)
// ---------------------------------------------------------------------------

let _firestore: FirebaseFirestore.Firestore | null = null;

function getFirestore(): FirebaseFirestore.Firestore | null {
  if (_firestore) return _firestore;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _firestore = require("../firebaseAdmin").firestore;
    return _firestore;
  } catch {
    return null;
  }
}

interface DeliveryRecord {
  id: string;
  event: string;
  destination: string;
  entityId: string | null;
  status: "success" | "failed" | "retrying";
  statusCode: number | null;
  attemptCount: number;
  responseSnippet: string | null;
  createdAt: number;
  updatedAt: number;
  lastAttemptAt: number;
}

async function logDelivery(record: DeliveryRecord): Promise<void> {
  try {
    const db = getFirestore();
    if (!db) return;
    await db.collection("webhookDeliveries").doc(record.id).set(record);
  } catch (err: any) {
    console.error(
      "[webhook-dispatcher] Failed to log delivery:",
      err?.message || err
    );
  }
}

// ---------------------------------------------------------------------------
// Core dispatch logic
// ---------------------------------------------------------------------------

async function attemptDelivery(
  url: string,
  body: string,
  secret: string,
  timeoutMs: number,
  event: string
): Promise<{ ok: boolean; status: number; snippet: string }> {
  const signature = signPayload(secret, body);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Streamline-Event": event,
    "X-Streamline-Signature": signature,
    "X-Streamline-Timestamp": new Date().toISOString(),
  };

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  let snippet = "";
  try {
    snippet = (await resp.text()).slice(0, 500);
  } catch {
    /* ignore */
  }

  return { ok: resp.ok, status: resp.status, snippet };
}

/**
 * Dispatch a StreamLine event payload to the configured webhook destination.
 *
 * This function never throws – errors are caught and logged so the calling
 * code path is never blocked.
 */
export async function dispatchEvent(
  payload: StreamlineEventPayload
): Promise<void> {
  const cfg = getConfig();
  if (!cfg.enabled || !cfg.secret) return;

  const category = eventCategory(payload.event);
  const url = getDestinationUrl(category);
  if (!url) return; // no destination configured for this category

  const body = JSON.stringify(payload);
  const id = deliveryId();
  const now = Date.now();

  let lastStatus: number | null = null;
  let lastSnippet: string | null = null;
  let success = false;

  for (let attempt = 1; attempt <= cfg.retryCount; attempt++) {
    try {
      const result = await attemptDelivery(
        url,
        body,
        cfg.secret,
        cfg.timeoutMs,
        payload.event
      );

      lastStatus = result.status;
      lastSnippet = result.snippet;

      if (result.ok) {
        success = true;
        console.log("[webhook-dispatcher]", {
          event: payload.event,
          id,
          status: result.status,
          attempt,
        });
        break;
      }

      // Non-2xx but not a network error – log and keep retrying
      console.warn("[webhook-dispatcher] Non-OK response:", {
        event: payload.event,
        id,
        status: result.status,
        attempt,
      });
    } catch (err: any) {
      lastSnippet = err?.message || String(err);
      console.error("[webhook-dispatcher] Delivery error:", {
        event: payload.event,
        id,
        attempt,
        error: lastSnippet,
      });
    }

    // Wait before retry (simple exponential: 1s, 2s, 4s …)
    if (attempt < cfg.retryCount) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }

  // Log delivery to Firestore
  logDelivery({
    id,
    event: payload.event,
    destination: url,
    entityId: payload.entityId,
    status: success ? "success" : "failed",
    statusCode: lastStatus,
    attemptCount: cfg.retryCount,
    responseSnippet: lastSnippet?.slice(0, 500) ?? null,
    createdAt: now,
    updatedAt: Date.now(),
    lastAttemptAt: Date.now(),
  }).catch(() => {
    /* swallow – logging must never throw */
  });

  // Emit monitoring event on final failure so the monitoring emitter can
  // track webhook health.  We do this via a direct console log rather
  // than re-emitting into the bus (which would cause infinite recursion
  // for monitoring.webhook.failed events).
  if (!success) {
    console.error("[webhook-dispatcher] Final delivery failure:", {
      event: payload.event,
      id,
      destination: url,
    });
  }
}
