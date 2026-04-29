/**
 * Horizon outbound webhook forwarder.
 *
 * Provides resilient HTTP forwarding with:
 *   - Configurable timeout
 *   - Exponential-backoff retries for transient (5xx / network) errors
 *   - Structured pino logging with request-id correlation
 *   - Optional Authorization header via shared secret
 *   - Non-blocking: callers fire-and-forget (promises resolve/reject silently)
 */
import { logger } from "../logger";
import { getHorizonWebhookConfig } from "./webhookConfig";

/* ── Types ────────────────────────────────────────────────────────────── */

export interface ForwardResult {
  ok: boolean;
  status?: number;
  /** Short machine-readable reason when ok=false. */
  reason?: string;
  /** Elapsed wall-clock ms for the entire forward attempt (including retries). */
  elapsedMs: number;
}

/* ── Core forwarder ───────────────────────────────────────────────────── */

/**
 * Forward a JSON payload to a Horizon receiver URL.
 *
 * Retries on 5xx or network errors up to `maxRetries` times with exponential
 * backoff (500ms × 2^attempt).  Rejects on 4xx immediately (client mistake).
 */
export async function forwardJson(
  url: string,
  body: Record<string, unknown>,
  opts?: { requestId?: string },
): Promise<ForwardResult> {
  const cfg = getHorizonWebhookConfig();
  const start = Date.now();
  const requestId = opts?.requestId ?? "no-req-id";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.webhookSecret) {
    headers["Authorization"] = `Bearer ${cfg.webhookSecret}`;
  }
  headers["X-Request-Id"] = requestId;

  let lastError: string | undefined;
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = 500 * Math.pow(2, attempt - 1); // 500, 1000, 2000 …
      await sleep(delayMs);
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);
      lastStatus = res.status;

      if (res.ok) {
        const elapsed = Date.now() - start;
        logger.info({ requestId, url, status: res.status, attempt, elapsedMs: elapsed }, "horizon webhook forwarded");
        return { ok: true, status: res.status, elapsedMs: elapsed };
      }

      // 4xx → do not retry (caller error or bad payload)
      if (res.status >= 400 && res.status < 500) {
        const errBody = await safeText(res);
        const elapsed = Date.now() - start;
        logger.warn({ requestId, url, status: res.status, attempt, errBody }, "horizon webhook 4xx — not retrying");
        return { ok: false, status: res.status, reason: "client_error", elapsedMs: elapsed };
      }

      // 5xx → retryable
      lastError = `HTTP ${res.status}`;
      logger.warn({ requestId, url, status: res.status, attempt }, "horizon webhook 5xx — will retry");
    } catch (err: any) {
      lastError = err?.name === "AbortError" ? "timeout" : String(err?.message || err);
      logger.warn({ requestId, url, attempt, error: lastError }, "horizon webhook network error — will retry");
    }
  }

  // Exhausted retries
  const elapsed = Date.now() - start;
  logger.error(
    { requestId, url, lastStatus, attempts: cfg.maxRetries + 1, error: lastError, elapsedMs: elapsed },
    "horizon webhook forwarding failed after retries",
  );
  return { ok: false, status: lastStatus, reason: lastError || "max_retries", elapsedMs: elapsed };
}

/**
 * Forward raw binary (audio) to a Horizon receiver URL.
 */
export async function forwardBinary(
  url: string,
  body: Buffer,
  meta: { contentType: string; roomId: string; userId: string; username: string; requestId?: string },
): Promise<ForwardResult> {
  const cfg = getHorizonWebhookConfig();
  const start = Date.now();
  const requestId = meta.requestId ?? "no-req-id";

  const headers: Record<string, string> = {
    "Content-Type": meta.contentType,
    "X-Room-Id": meta.roomId,
    "X-User-Id": meta.userId,
    "X-Username": meta.username,
    "X-Timestamp": new Date().toISOString(),
    "X-Request-Id": requestId,
  };
  if (cfg.webhookSecret) {
    headers["Authorization"] = `Bearer ${cfg.webhookSecret}`;
  }

  let lastError: string | undefined;
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = 500 * Math.pow(2, attempt - 1);
      await sleep(delayMs);
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: new Uint8Array(body.buffer, body.byteOffset, body.byteLength) as any,
        signal: controller.signal,
      });

      clearTimeout(timer);
      lastStatus = res.status;

      if (res.ok) {
        const elapsed = Date.now() - start;
        logger.info({ requestId, url, status: res.status, attempt, elapsedMs: elapsed, bytes: body.length }, "horizon voice webhook forwarded");
        return { ok: true, status: res.status, elapsedMs: elapsed };
      }

      if (res.status >= 400 && res.status < 500) {
        const errBody = await safeText(res);
        const elapsed = Date.now() - start;
        logger.warn({ requestId, url, status: res.status, attempt, errBody }, "horizon voice webhook 4xx — not retrying");
        return { ok: false, status: res.status, reason: "client_error", elapsedMs: elapsed };
      }

      lastError = `HTTP ${res.status}`;
      logger.warn({ requestId, url, status: res.status, attempt }, "horizon voice webhook 5xx — will retry");
    } catch (err: any) {
      lastError = err?.name === "AbortError" ? "timeout" : String(err?.message || err);
      logger.warn({ requestId, url, attempt, error: lastError }, "horizon voice webhook network error — will retry");
    }
  }

  const elapsed = Date.now() - start;
  logger.error(
    { requestId, url, lastStatus, attempts: cfg.maxRetries + 1, error: lastError, elapsedMs: elapsed },
    "horizon voice webhook forwarding failed after retries",
  );
  return { ok: false, status: lastStatus, reason: lastError || "max_retries", elapsedMs: elapsed };
}

/* ── Convenience wrappers ────────────────────────────────────────────── */

/**
 * Fire-and-forget: forward a chat event to the configured Horizon receiver.
 * Never throws — logs errors internally.
 */
export function forwardChatEvent(payload: Record<string, unknown>, requestId?: string): void {
  const cfg = getHorizonWebhookConfig();
  logger.debug({ requestId, url: cfg.chatEventUrl, roomId: payload.roomId }, "[monitoring:outbound] dispatching chat event to Horizon");
  forwardJson(cfg.chatEventUrl, payload, { requestId }).then((result) => {
    if (result.ok) {
      logger.debug({ requestId, elapsedMs: result.elapsedMs }, "[monitoring:outbound] chat event delivered to Horizon");
    } else {
      logger.warn({ requestId, status: result.status, reason: result.reason, elapsedMs: result.elapsedMs }, "[monitoring:outbound] chat event delivery to Horizon failed");
    }
  }).catch((err) => {
    logger.error({ err, requestId }, "forwardChatEvent unexpected error");
  });
}

/**
 * Fire-and-forget: forward a voice event to the configured Horizon receiver.
 * Never throws — logs errors internally.
 */
export function forwardVoiceEvent(
  audio: Buffer,
  meta: { contentType: string; roomId: string; userId: string; username: string; requestId?: string },
): void {
  const cfg = getHorizonWebhookConfig();
  logger.debug({ requestId: meta.requestId, url: cfg.voiceEventUrl, roomId: meta.roomId }, "[monitoring:outbound] dispatching voice event to Horizon");
  forwardBinary(cfg.voiceEventUrl, audio, meta).then((result) => {
    if (result.ok) {
      logger.debug({ requestId: meta.requestId, elapsedMs: result.elapsedMs }, "[monitoring:outbound] voice event delivered to Horizon");
    } else {
      logger.warn({ requestId: meta.requestId, status: result.status, reason: result.reason, elapsedMs: result.elapsedMs }, "[monitoring:outbound] voice event delivery to Horizon failed");
    }
  }).catch((err) => {
    logger.error({ err, requestId: meta.requestId }, "forwardVoiceEvent unexpected error");
  });
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 500);
  } catch {
    return "(unreadable)";
  }
}
