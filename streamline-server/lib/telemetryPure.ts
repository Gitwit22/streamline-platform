/**
 * Pure helpers for product telemetry (lib/telemetry.ts). No Firestore here:
 * the allowlist, metadata sanitizing and the document shape are unit-tested
 * in telemetryPure.test.ts.
 */
import { LIMIT_ERRORS } from "./limitErrors";

/** The only event types that are stored. Anything else is dropped. */
export const TELEMETRY_EVENT_TYPES = [
  "broadcast.started",
  "broadcast.ended",
  "destination.connected",
  "destination.failed",
  "destination.reconnected",
  "recording.started",
  "recording.failed",
  "recording.completed",
  "hls.started",
  "hls.viewer_joined",
  "hls.viewer_left",
  "checkout.started",
  "checkout.completed",
  "checkout.failed",
  "entitlement.denied",
  "job.failed",
] as const;

export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];

const EVENT_SET: ReadonlySet<string> = new Set(TELEMETRY_EVENT_TYPES);

export function isTelemetryEventType(v: unknown): v is TelemetryEventType {
  return typeof v === "string" && EVENT_SET.has(v);
}

export const TELEMETRY_COLLECTION = "telemetryEvents";
export const TELEMETRY_METADATA_MAX_BYTES = 2_048;
export const TELEMETRY_METADATA_MAX_KEYS = 24;
const STRING_MAX = 300;
const ARRAY_MAX = 10;
const ID_MAX = 128;

/** Keys that could carry secrets or personal data never get stored. */
const SENSITIVE_KEY = /(token|secret|password|passwd|authorization|cookie|stream_?key|api_?key|email|phone|^ip$|ipaddress|card|rtmp_?url)/i;

/** Removes RTMP/SRT URLs (they embed stream keys) and bearer-ish tokens from free text. */
export function redactTelemetryString(raw: unknown): string {
  return String(raw ?? "")
    .replace(/(rtmps?|srt):\/\/\S+/gi, "[url]")
    .replace(/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]+/g, "[key]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    .slice(0, STRING_MAX);
}

type Scalar = string | number | boolean | null;

function sanitizeScalar(v: unknown): Scalar | undefined {
  if (v === null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") return redactTelemetryString(v);
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : undefined;
  return undefined;
}

function sanitizeValue(v: unknown, depth: number): unknown {
  const scalar = sanitizeScalar(v);
  if (scalar !== undefined) return scalar;
  if (Array.isArray(v)) {
    const out = v.slice(0, ARRAY_MAX).map((x) => sanitizeScalar(x)).filter((x) => x !== undefined);
    return out;
  }
  if (v && typeof v === "object" && depth < 1) {
    return sanitizeTelemetryMetadata(v as Record<string, unknown>, depth + 1);
  }
  return undefined;
}

/**
 * Flat-ish, size-capped copy of `meta`: scalars, short arrays of scalars and
 * one level of nested objects. Sensitive keys are dropped, strings redacted
 * and truncated, and keys are dropped from the end until the JSON fits
 * TELEMETRY_METADATA_MAX_BYTES.
 */
export function sanitizeTelemetryMetadata(meta: unknown, depth = 0): Record<string, unknown> {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [rawKey, value] of Object.entries(meta as Record<string, unknown>)) {
    if (count >= TELEMETRY_METADATA_MAX_KEYS) break;
    const key = String(rawKey).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);
    if (!key || SENSITIVE_KEY.test(key)) continue;
    const clean = sanitizeValue(value, depth);
    if (clean === undefined) continue;
    out[key] = clean;
    count += 1;
  }
  if (depth > 0) return out;
  const keys = Object.keys(out);
  while (keys.length && Buffer.byteLength(JSON.stringify(out), "utf8") > TELEMETRY_METADATA_MAX_BYTES) {
    delete out[keys.pop()!];
  }
  return out;
}

function cleanId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > ID_MAX || s.includes("/")) return null;
  return s;
}

export type TelemetryFields = {
  userId?: string | null;
  roomId?: string | null;
  broadcastId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type TelemetryEventDoc = {
  id: string;
  eventType: TelemetryEventType;
  userId: string | null;
  roomId: string | null;
  broadcastId: string | null;
  /** epoch ms; the retention cleanup ranges on this field. */
  timestamp: number;
  metadata: Record<string, unknown>;
};

export function buildTelemetryDoc(
  id: string,
  eventType: TelemetryEventType,
  fields: TelemetryFields,
  nowMs: number
): TelemetryEventDoc {
  return {
    id,
    eventType,
    userId: cleanId(fields.userId),
    roomId: cleanId(fields.roomId),
    broadcastId: cleanId(fields.broadcastId),
    timestamp: nowMs,
    metadata: sanitizeTelemetryMetadata(fields.metadata || {}),
  };
}

/** Rate-limit key: per event type and subject (room, else user, else global). */
export function telemetryRateKey(eventType: TelemetryEventType, fields: TelemetryFields): string {
  const subject = cleanId(fields.roomId) || cleanId(fields.userId) || "_";
  return `${eventType}|${subject}`;
}

/** Hostname of a URL (never the path or query, which may hold a stream key). */
export function urlHost(raw: unknown): string | null {
  try {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    return new URL(s).hostname.toLowerCase().slice(0, 100) || null;
  } catch {
    return null;
  }
}

/** Error codes that mean "your plan / platform does not allow this". */
export const ENTITLEMENT_DENIAL_CODES: ReadonlySet<string> = new Set<string>(Object.values(LIMIT_ERRORS));

/** The entitlement denial code in a JSON error body, else null. */
export function entitlementDenialCode(status: number, body: unknown): string | null {
  if (status !== 402 && status !== 403 && status !== 409 && status !== 429) return null;
  const code = body && typeof body === "object" ? (body as any).error : null;
  return typeof code === "string" && ENTITLEMENT_DENIAL_CODES.has(code) ? code : null;
}
