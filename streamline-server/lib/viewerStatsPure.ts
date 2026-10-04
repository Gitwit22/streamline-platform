/**
 * Pure (Firestore-free) helpers for viewer counting. See lib/viewerStats.ts
 * for the storage side.
 *
 * Definitions
 * - A "live session" spans one go-live of a room (RTC host joins or HLS
 *   starts) until the room/HLS goes idle. Totals and peak reset per session.
 * - Current viewers = HLS viewers that heartbeated within HLS_VIEWER_TTL_MS
 *   + RTC audience (LiveKit participants that cannot publish).
 *   On-stage guests and hosts/producers are reported separately and are not
 *   "viewers"; agents, egress and invisible/hidden participants are ignored.
 * - Total viewers = unique viewers seen during the session (HLS viewer ids +
 *   RTC identities other than the host/producers).
 */

/** An HLS viewer counts as current while its last heartbeat is newer than this. */
export const HLS_VIEWER_TTL_MS = 45_000;
/** Clients ping this often while playing (keep < HLS_VIEWER_TTL_MS / 2). */
export const HLS_HEARTBEAT_INTERVAL_MS = 20_000;

export type ViewerKind = "hls" | "rtc";

export type ViewerStats = {
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  peak: number;
  totalUnique: number;
  totalUniqueRtc: number;
  totalUniqueHls: number;
};

/** Client-generated viewer id: 16-64 chars of [A-Za-z0-9_-]. */
export function isValidViewerId(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(raw);
}

/** Firestore-doc-id-safe room id from untrusted input. */
export function isValidViewerRoomId(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const v = raw.trim();
  return v.length > 0 && v.length <= 128 && !v.includes("/") && v !== "." && v !== "..";
}

/** Doc id for a viewer inside a session (keys never contain "/"). */
export function viewerKeyFor(kind: ViewerKind, id: string): string {
  return `${kind}:${String(id || "").replace(/\//g, "_").slice(0, 200)}`;
}

/** Minimal participant shape (LiveKit ParticipantInfo or webhook JSON). */
export type ParticipantLike = {
  identity?: string | null;
  metadata?: string | null;
  /** ParticipantInfo.Kind: 0 STANDARD, 1 INGRESS, 2 EGRESS, 3 SIP, 4 AGENT (or the enum name). */
  kind?: number | string | null;
  isAgent?: boolean;
  permission?: { canPublish?: boolean; hidden?: boolean } | null;
};

export type ParticipantClass = "excluded" | "host" | "onStage" | "audience";

function kindName(kind: ParticipantLike["kind"]): string {
  if (typeof kind === "number") return ["STANDARD", "INGRESS", "EGRESS", "SIP", "AGENT"][kind] || "STANDARD";
  return String(kind || "STANDARD").toUpperCase();
}

function isHiddenMetadata(metadata: string | null | undefined): boolean {
  if (!metadata) return false;
  try {
    const m = JSON.parse(metadata);
    if (!m || typeof m !== "object") return false;
    const mode = String((m as any).presenceMode || "").toLowerCase();
    return mode === "invisible" || mode === "hidden" || mode === "silent" || (m as any).hidden === true;
  } catch {
    return false;
  }
}

/**
 * Classifies a participant for viewer counting.
 * - excluded: agents, egress/ingress, `EG_*`, invisible/hidden participants
 * - host: the room owner identity or a delegated producer (`producer:*`)
 * - onStage: can publish
 * - audience: cannot publish (or unknown permission)
 */
export function classifyParticipant(p: ParticipantLike, ownerUid?: string | null): ParticipantClass {
  const identity = String(p?.identity || "").trim();
  if (!identity) return "excluded";
  const kind = kindName(p.kind);
  if (p.isAgent || kind === "AGENT" || kind === "EGRESS" || kind === "INGRESS") return "excluded";
  if (identity.startsWith("EG_")) return "excluded";
  if (identity.startsWith("invisible_")) return "excluded";
  if (p.permission?.hidden === true) return "excluded";
  if (isHiddenMetadata(p.metadata)) return "excluded";
  const owner = String(ownerUid || "").trim();
  if ((owner && identity === owner) || identity.startsWith("producer:")) return "host";
  return p.permission?.canPublish === true ? "onStage" : "audience";
}

/** True when a participant should be counted toward RTC total viewers. */
export function isCountableRtcViewer(p: ParticipantLike, ownerUid?: string | null): boolean {
  const c = classifyParticipant(p, ownerUid);
  return c === "onStage" || c === "audience";
}

export type RtcCounts = { host: number; onStage: number; audience: number };

export function summarizeRtcParticipants(list: ParticipantLike[], ownerUid?: string | null): RtcCounts {
  const out: RtcCounts = { host: 0, onStage: 0, audience: 0 };
  const seen = new Set<string>();
  for (const p of list || []) {
    const id = String(p?.identity || "");
    if (seen.has(id)) continue;
    seen.add(id);
    const c = classifyParticipant(p, ownerUid);
    if (c !== "excluded") out[c] += 1;
  }
  return out;
}

/** Current viewers = HLS current + RTC audience (stage and hosts excluded). */
export function currentViewerTotal(hls: number, rtcAudience: number): number {
  return Math.max(0, Math.floor(hls || 0)) + Math.max(0, Math.floor(rtcAudience || 0));
}

export function nextPeak(prevPeak: unknown, current: unknown): number {
  const p = Math.max(0, Math.floor(Number(prevPeak) || 0));
  const c = Math.max(0, Math.floor(Number(current) || 0));
  return Math.max(p, c);
}

export function newViewerStats(sessionId: string, now: number): ViewerStats {
  return { sessionId, startedAt: now, endedAt: null, peak: 0, totalUnique: 0, totalUniqueRtc: 0, totalUniqueHls: 0 };
}

/** Reads rooms/{id}.viewerStats defensively. */
export function readViewerStats(raw: unknown): ViewerStats | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sessionId = typeof r.sessionId === "string" ? r.sessionId : "";
  if (!sessionId) return null;
  const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
  const endedAt = r.endedAt === null || r.endedAt === undefined ? null : n(r.endedAt) || null;
  return {
    sessionId,
    startedAt: n(r.startedAt),
    endedAt,
    peak: n(r.peak),
    totalUnique: n(r.totalUnique),
    totalUniqueRtc: n(r.totalUniqueRtc),
    totalUniqueHls: n(r.totalUniqueHls),
  };
}

export function isSessionActive(stats: ViewerStats | null): stats is ViewerStats {
  return !!stats && !!stats.sessionId && stats.endedAt === null;
}

/** Totals after a viewer is seen for the first time in the session. */
export function withNewViewer(stats: ViewerStats, kind: ViewerKind): ViewerStats {
  return {
    ...stats,
    totalUnique: stats.totalUnique + 1,
    totalUniqueRtc: stats.totalUniqueRtc + (kind === "rtc" ? 1 : 0),
    totalUniqueHls: stats.totalUniqueHls + (kind === "hls" ? 1 : 0),
  };
}

/** Final stats when a session ends (peak includes the last observed current). */
export function finalizeViewerStats(stats: ViewerStats, now: number, lastCurrent = 0): ViewerStats {
  return { ...stats, endedAt: stats.endedAt ?? now, peak: nextPeak(stats.peak, lastCurrent) };
}

/** HLS heartbeat leave payloads arrive via sendBeacon as text/plain JSON. */
export function parseHeartbeatBody(body: unknown): { roomId?: unknown; viewerId?: unknown; kind?: unknown; leave?: unknown } {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return body && typeof body === "object" ? (body as any) : {};
}

export type RecordingViewerFields = {
  viewerCount: number;
  peakViewers: number;
  /** Live session length (not the recording's own duration). */
  streamDurationSec: number;
  avgWatchSeconds: number | null;
  streamSessionId: string;
};

/** Recording fields copied from a session (unique total, peak, duration, avg watch). */
export function recordingViewerFields(
  stats: ViewerStats | null,
  opts: { avgWatchSeconds?: number | null; nowMs?: number } = {}
): RecordingViewerFields | null {
  if (!stats) return null;
  const end = stats.endedAt ?? opts.nowMs ?? Date.now();
  const streamDurationSec = stats.startedAt && end > stats.startedAt ? Math.round((end - stats.startedAt) / 1000) : 0;
  const avg = opts.avgWatchSeconds;
  return {
    viewerCount: stats.totalUnique,
    peakViewers: stats.peak,
    streamDurationSec,
    avgWatchSeconds: typeof avg === "number" && Number.isFinite(avg) ? Math.max(0, Math.round(avg)) : null,
    streamSessionId: stats.sessionId,
  };
}
