/**
 * Which inbound Horizon bot events are persisted to `horizon_events` (capped)
 * and in what shape (pure). Read by GET /api/admin/alerts and the admin
 * Operations tab. Storage: lib/horizonEventStore.ts.
 */

export const HORIZON_EVENTS_COLLECTION = "horizon_events";
/** Keep at most this many docs; older ones are pruned. */
export const HORIZON_EVENTS_CAP = 1000;
/** Max serialized size of the stored `data` payload. */
export const HORIZON_EVENT_DATA_MAX_BYTES = 8 * 1024;

/** support.alert, alert.*, monitoring.* (except heartbeats). */
export function shouldPersistHorizonEvent(type: string): boolean {
  const t = String(type || "").trim().toLowerCase();
  if (!t) return false;
  if (t === "support.alert" || t === "support.request") return true;
  if (t.startsWith("alert.")) return true;
  if (t.startsWith("monitoring.") && t !== "monitoring.heartbeat") return true;
  return false;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

const SEVERITIES = new Set(["info", "low", "warning", "medium", "high", "error", "critical"]);

export function buildHorizonEventDoc(type: string, eventId: string, data: any, nowMs: number): Record<string, any> {
  const d = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  let stored: any = d;
  let truncated = false;
  try {
    const json = JSON.stringify(d);
    if (json && Buffer.byteLength(json, "utf8") > HORIZON_EVENT_DATA_MAX_BYTES) {
      stored = { truncatedJson: json.slice(0, HORIZON_EVENT_DATA_MAX_BYTES) };
      truncated = true;
    } else {
      // Round-trip drops undefined / functions Firestore would reject.
      stored = json ? JSON.parse(json) : {};
    }
  } catch {
    stored = {};
    truncated = true;
  }
  const severityRaw = String(d.severity || d.level || "").toLowerCase();
  return {
    type: String(type).trim(),
    eventId: String(eventId || "").slice(0, 200) || null,
    source: "horizon_bot",
    status: "pending",
    severity: SEVERITIES.has(severityRaw) ? severityRaw : "info",
    title: str(d.title, 300) ?? str(d.subject, 300) ?? str(d.summary, 300),
    message: str(d.message, 2000) ?? str(d.text, 2000) ?? str(d.description, 2000),
    roomId: str(d.roomId, 200),
    userId: str(d.userId, 200),
    data: stored,
    dataTruncated: truncated,
    createdAt: nowMs,
  };
}

/** How many of the oldest docs to delete to get back under the cap. */
export function horizonEventsToPrune(total: number, cap: number = HORIZON_EVENTS_CAP): number {
  const n = Math.floor(Number(total) || 0);
  return n > cap ? n - cap : 0;
}
