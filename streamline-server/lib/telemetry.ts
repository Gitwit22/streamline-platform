/**
 * Product telemetry: a small allowlist of server-side events (see
 * TELEMETRY_EVENT_TYPES in telemetryPure.ts) stored in `telemetryEvents`:
 *
 *   { id, eventType, userId?, roomId?, broadcastId?, timestamp (ms), metadata }
 *
 * Events are emitted at the source of truth (routes / webhooks / jobs), never
 * from the client. recordTelemetry is fire-and-forget: it never throws, never
 * blocks the caller, and is rate limited per event type + room/user and
 * globally, so a busy stream cannot turn into a write storm. Retention:
 * the expired-sessions job deletes docs older than TELEMETRY_RETENTION_DAYS
 * (default 30).
 *
 * TELEMETRY_DISABLED=true turns writes off.
 */
import type { NextFunction, Request, Response } from "express";
import { firestore } from "../firebaseAdmin";
import { SlidingWindowLimiter } from "./rateLimit";
import {
  TELEMETRY_COLLECTION,
  buildTelemetryDoc,
  entitlementDenialCode,
  isTelemetryEventType,
  telemetryRateKey,
  type TelemetryEventType,
  type TelemetryFields,
} from "./telemetryPure";

export { TELEMETRY_COLLECTION, TELEMETRY_EVENT_TYPES, type TelemetryEventType } from "./telemetryPure";

// Per (event type, room/user): bursts like many viewers joining one stream
// are sampled down to this many writes per minute.
const subjectLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 60, maxKeys: 20_000 });
// Whole-process ceiling.
const globalLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 1_200 });

let droppedSinceLog = 0;
let lastDropLogMs = 0;

function telemetryDisabled(): boolean {
  return String(process.env.TELEMETRY_DISABLED || "").toLowerCase() === "true";
}

function noteDropped(reason: string): void {
  droppedSinceLog += 1;
  const now = Date.now();
  if (now - lastDropLogMs > 60_000) {
    console.warn(`[telemetry] dropped ${droppedSinceLog} event(s) in the last minute (latest: ${reason})`);
    droppedSinceLog = 0;
    lastDropLogMs = now;
  }
}

/** Store one allowlisted telemetry event. Fire-and-forget; never throws. */
export function recordTelemetry(eventType: TelemetryEventType, fields: TelemetryFields = {}): void {
  try {
    if (telemetryDisabled()) return;
    if (!isTelemetryEventType(eventType)) {
      noteDropped(`not_allowlisted:${String(eventType).slice(0, 40)}`);
      return;
    }
    if (!subjectLimiter.hit(telemetryRateKey(eventType, fields)).allowed) {
      noteDropped(`rate_limited:${eventType}`);
      return;
    }
    if (!globalLimiter.hit("all").allowed) {
      noteDropped("global_rate_limited");
      return;
    }
    const ref = firestore.collection(TELEMETRY_COLLECTION).doc();
    const doc = buildTelemetryDoc(ref.id, eventType, fields, Date.now());
    ref.set(doc).catch((e: any) => noteDropped(`write_failed:${e?.code || e?.message || e}`));
  } catch (e: any) {
    noteDropped(`error:${e?.message || e}`);
  }
}

/**
 * Express middleware: records `entitlement.denied` whenever a route answers
 * with an entitlement error body ({ error: <any LIMIT_ERRORS code> }). One
 * place covers every gate (canAccessFeature, checkFeature, limits, usage gate).
 */
export function entitlementDenialTelemetry(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    try {
      const code = entitlementDenialCode(res.statusCode, body);
      if (code) {
        const params = ((req as any).params || {}) as Record<string, unknown>;
        const routePath = (req as any).route?.path;
        recordTelemetry("entitlement.denied", {
          userId: (req as any).user?.uid || null,
          roomId: typeof params.roomId === "string" ? params.roomId : null,
          metadata: {
            code,
            status: res.statusCode,
            method: req.method,
            route: `${req.baseUrl || ""}${typeof routePath === "string" ? routePath : ""}` || undefined,
            feature: typeof body?.feature === "string" ? body.feature : undefined,
            limitKey: typeof body?.limitKey === "string" ? body.limitKey : undefined,
            planId: typeof body?.planId === "string" ? body.planId : undefined,
          },
        });
      }
    } catch {
      // never interfere with the response
    }
    return originalJson(body);
  }) as any;
  next();
}
