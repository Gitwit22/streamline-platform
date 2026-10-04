/**
 * Pure (Firestore-free) post-stream summary rules. Storage lives in
 * lib/streamSummary.ts; the route is GET /api/rooms/:roomId/stream-summary
 * (routes/viewers.ts).
 *
 * Inputs
 * - ViewerStats of one live session (lib/viewerStatsPure.ts).
 * - Viewer docs: rooms/{id}/viewerSessions/{sid}/viewers/{key}
 *     { kind, firstSeenAt, lastSeenAt, leftAt? }   (RTC leftAt from the
 *     LiveKit participant_left webhook)
 * - HLS presence docs: rooms/{id}/hlsViewers/{viewerId}
 *     { sessionId, firstSeenAt, lastSeenAtMs, leftAtMs? }   (heartbeats)
 * - Output intervals: egressSessions/{egressId} (lib/streamingMeter.ts) plus
 *   the egress outcome stored by the egress_ended webhook (egressStatus,
 *   egressError, egressStreamResults).
 *
 * Watch time: a viewer contributes a sample only when we actually observed
 * an end (a leave, or a heartbeat/sighting later than the first one). Viewers
 * we only saw once without a leave are excluded, so the average is never
 * diluted by fake zero-second watches. No samples -> avgWatchSeconds null.
 */
import { toEpochMs } from "./streamingMeterPure";
import type { ViewerStats } from "./viewerStatsPure";

export type ViewerDocLike = {
  /** Doc id, e.g. "hls:<viewerId>" or "rtc:<identity>". */
  key: string;
  kind?: unknown;
  firstSeenAt?: unknown;
  lastSeenAt?: unknown;
  leftAt?: unknown;
};

export type HlsPresenceLike = {
  viewerId: string;
  sessionId?: unknown;
  firstSeenAt?: unknown;
  lastSeenAtMs?: unknown;
  leftAtMs?: unknown;
};

export type WatchStats = {
  avgWatchSeconds: number | null;
  /** Viewers with a measured watch duration. */
  watchSampleSize: number;
  totalWatchSeconds: number;
};

function ms(v: unknown): number | null {
  const t = toEpochMs(v);
  return t !== null && t > 0 ? t : null;
}

function maxMs(...vals: Array<number | null>): number | null {
  const xs = vals.filter((v): v is number => typeof v === "number" && v > 0);
  return xs.length ? Math.max(...xs) : null;
}

/**
 * Seconds watched between start and end, clamped to the session window.
 * Returns null when the end is unknown or not after the start.
 */
export function watchSecondsFor(
  startMs: number | null,
  endMs: number | null,
  session: { startedAt: number; endedAt: number | null }
): number | null {
  if (startMs === null || endMs === null) return null;
  const lo = session.startedAt > 0 ? Math.max(startMs, session.startedAt) : startMs;
  const hi = session.endedAt ? Math.min(endMs, session.endedAt) : endMs;
  if (!(hi > lo)) return null;
  return Math.round((hi - lo) / 1000);
}

/** Average watch time across viewers with a measured duration. */
export function computeWatchStats(params: {
  viewers: ViewerDocLike[];
  hlsPresence: HlsPresenceLike[];
  session: { sessionId: string; startedAt: number; endedAt: number | null };
}): WatchStats {
  const presenceById = new Map<string, HlsPresenceLike>();
  for (const p of params.hlsPresence || []) {
    if (p && p.viewerId && String(p.sessionId || "") === params.session.sessionId) presenceById.set(p.viewerId, p);
  }
  let total = 0;
  let samples = 0;
  for (const v of params.viewers || []) {
    const key = String(v?.key || "");
    const kind = String(v?.kind || (key.startsWith("hls:") ? "hls" : "rtc"));
    let start = ms(v.firstSeenAt);
    let end: number | null;
    if (kind === "hls") {
      const p = presenceById.get(key.replace(/^hls:/, ""));
      const pFirst = ms(p?.firstSeenAt);
      if (pFirst !== null && (start === null || pFirst < start)) start = pFirst;
      end = maxMs(ms(p?.leftAtMs), ms(p?.lastSeenAtMs), ms(v.leftAt), ms(v.lastSeenAt));
    } else {
      end = maxMs(ms(v.leftAt), ms(v.lastSeenAt));
    }
    const secs = watchSecondsFor(start, end, params.session);
    if (secs === null || secs <= 0) continue;
    total += secs;
    samples += 1;
  }
  return {
    avgWatchSeconds: samples > 0 ? Math.round(total / samples) : null,
    watchSampleSize: samples,
    totalWatchSeconds: total,
  };
}

// ---------------------------------------------------------------------------
// Outputs (destination performance)
// ---------------------------------------------------------------------------

export type OutputStatus = "live" | "completed" | "failed" | "stopped_limit";

export type StreamDestination = {
  platform: string;
  label: string;
  /** Per-destination result from LiveKit streamResults (when known). */
  status?: "active" | "finished" | "failed";
  error?: string;
};

export type StreamOutputSummary = {
  egressId: string;
  kind: "multistream" | "instagram" | "hls";
  destinations: StreamDestination[];
  startedAt: number | null;
  endedAt: number | null;
  durationSec: number;
  status: OutputStatus;
  error?: string;
};

const DESTINATION_LABELS: Record<string, string> = {
  youtube: "YouTube",
  facebook: "Facebook",
  twitch: "Twitch",
  instagram: "Instagram",
  kick: "Kick",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  x: "X",
  twitter: "X",
  rumble: "Rumble",
  custom: "Custom RTMP",
  rtmp: "Custom RTMP",
  streamline_hls: "Streamline Channel (HLS)",
  hls: "Streamline Channel (HLS)",
};

export function destinationLabel(platform: unknown): string {
  const p = String(platform || "").trim();
  if (!p) return "Destination";
  const known = DESTINATION_LABELS[p.toLowerCase()];
  if (known) return known;
  const words = p.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const LIMIT_REASONS = new Set(["monthly_limit", "max_session", "hls_session_cap", "max_interval"]);

/** LiveKit EgressStatus (enum number or name) -> lowercase name. */
export function egressStatusName(status: unknown): string | null {
  if (status === null || status === undefined || status === "") return null;
  const names = ["starting", "active", "ending", "complete", "failed", "aborted", "limit_reached"];
  if (typeof status === "number") return names[status] ?? null;
  const s = String(status).toLowerCase().replace(/^egress_/, "");
  if (/^\d+$/.test(s)) return names[Number(s)] ?? null;
  return s || null;
}

/** LiveKit StreamInfo.Status (enum number or name) -> lowercase name. */
export function streamResultStatusName(status: unknown): "active" | "finished" | "failed" | null {
  if (status === null || status === undefined || status === "") return null;
  const names = ["active", "finished", "failed"] as const;
  if (typeof status === "number") return names[status] ?? null;
  const s = String(status).toLowerCase();
  if (/^\d+$/.test(s)) return names[Number(s)] ?? null;
  return (names as readonly string[]).includes(s) ? (s as any) : null;
}

/** Removes RTMP URLs (they embed stream keys) from an error message. */
export function redactEgressError(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return s.replace(/rtmps?:\/\/\S+/gi, "[rtmp url]").replace(/srt:\/\/\S+/gi, "[srt url]").slice(0, 300);
}

/** Fields the egress_ended webhook stores on egressSessions/{egressId}. */
export function egressOutcomeFields(info: any): {
  egressStatus: string | null;
  egressError: string | null;
  egressStreamResults: Array<{ status: string | null; error: string | null }>;
} {
  const results = Array.isArray(info?.streamResults) ? info.streamResults : [];
  return {
    egressStatus: egressStatusName(info?.status),
    egressError: redactEgressError(info?.error || info?.errorMessage),
    egressStreamResults: results.slice(0, 20).map((r: any) => ({
      status: streamResultStatusName(r?.status),
      error: redactEgressError(r?.error),
    })),
  };
}

/** Status of one output interval. */
export function outputStatusFor(d: any): { status: OutputStatus; error: string | null } {
  const egressStatus = egressStatusName(d?.egressStatus);
  const error = redactEgressError(d?.egressError);
  const ended = !!toEpochMs(d?.endedAt) || d?.meterOpen === false;
  const results: any[] = Array.isArray(d?.egressStreamResults) ? d.egressStreamResults : [];
  const allFailed = results.length > 0 && results.every((r) => streamResultStatusName(r?.status) === "failed");
  if (egressStatus === "failed" || egressStatus === "aborted" || allFailed) {
    const firstErr = results.map((r) => redactEgressError(r?.error)).find(Boolean) || null;
    return { status: "failed", error: error || firstErr || "Output failed" };
  }
  if (egressStatus === "limit_reached" || LIMIT_REASONS.has(String(d?.closeReason || ""))) {
    return { status: "stopped_limit", error: error || null };
  }
  if (!ended) return { status: "live", error: null };
  if (error) return { status: "failed", error };
  return { status: "completed", error: null };
}

export function summarizeOutput(egressId: string, d: any, nowMs: number): StreamOutputSummary {
  const kindRaw = String(d?.kind || "").toLowerCase();
  const kind: StreamOutputSummary["kind"] =
    kindRaw === "hls" ? "hls" : kindRaw === "instagram" || String(d?.group || "") === "instagram" ? "instagram" : "multistream";
  const startedAt = toEpochMs(d?.startedAt);
  const endedAt = toEpochMs(d?.endedAt);
  const { status, error } = outputStatusFor(d);
  const end = endedAt ?? (status === "live" ? nowMs : null);
  const durationSec = startedAt !== null && end !== null && end > startedAt ? Math.round((end - startedAt) / 1000) : 0;
  const rawDest: unknown[] = Array.isArray(d?.destinations) ? d.destinations : [];
  const results: any[] = Array.isArray(d?.egressStreamResults) ? d.egressStreamResults : [];
  const matchResults = results.length === rawDest.length;
  const destinations: StreamDestination[] = rawDest.map((p, i) => {
    const out: StreamDestination = { platform: String(p || "destination"), label: destinationLabel(p) };
    if (matchResults) {
      const st = streamResultStatusName(results[i]?.status);
      if (st) out.status = st;
      const err = redactEgressError(results[i]?.error);
      if (err) out.error = err;
    }
    return out;
  });
  return {
    egressId,
    kind,
    destinations,
    startedAt,
    endedAt,
    durationSec,
    status,
    ...(error ? { error } : {}),
  };
}

/** Outputs may start a little before the viewer session (HLS warm-up). */
export const OUTPUT_SESSION_SLACK_MS = 5 * 60_000;

/** Outputs that overlap the session window, oldest first. */
export function outputsForSession(
  docs: Array<{ id: string; data: any }>,
  session: { startedAt: number; endedAt: number | null },
  nowMs: number
): StreamOutputSummary[] {
  const lo = session.startedAt - OUTPUT_SESSION_SLACK_MS;
  const hi = session.endedAt ?? nowMs;
  return (docs || [])
    .map((doc) => summarizeOutput(doc.id, doc.data, nowMs))
    .filter((o) => {
      if (o.startedAt === null || o.startedAt > hi) return false;
      const oEnd = o.endedAt ?? (o.status === "live" ? nowMs : o.startedAt);
      return o.startedAt >= lo || oEnd > session.startedAt;
    })
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export type StreamSummary = {
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  live: boolean;
  durationSec: number;
  peakConcurrent: number;
  uniqueViewers: { total: number; hls: number; rtc: number };
  avgWatchSeconds: number | null;
  watchSampleSize: number;
  outputs: StreamOutputSummary[];
};

export function sessionDurationSec(stats: { startedAt: number; endedAt: number | null }, nowMs: number): number {
  if (!stats.startedAt) return 0;
  const end = stats.endedAt ?? nowMs;
  return end > stats.startedAt ? Math.round((end - stats.startedAt) / 1000) : 0;
}

export function buildStreamSummary(
  stats: ViewerStats,
  watch: Pick<WatchStats, "avgWatchSeconds" | "watchSampleSize">,
  outputs: StreamOutputSummary[],
  nowMs: number
): StreamSummary {
  return {
    sessionId: stats.sessionId,
    startedAt: stats.startedAt,
    endedAt: stats.endedAt,
    live: stats.endedAt === null,
    durationSec: sessionDurationSec(stats, nowMs),
    peakConcurrent: stats.peak,
    uniqueViewers: { total: stats.totalUnique, hls: stats.totalUniqueHls, rtc: stats.totalUniqueRtc },
    avgWatchSeconds: watch.avgWatchSeconds,
    watchSampleSize: watch.watchSampleSize,
    outputs,
  };
}

/** viewerSessions/{sid}.summary written when a session ends. */
export type StoredSessionSummary = {
  durationSec: number;
  peakConcurrent: number;
  uniqueViewers: { total: number; hls: number; rtc: number };
  avgWatchSeconds: number | null;
  watchSampleSize: number;
  computedAt: number;
};

export function storedSummaryFrom(stats: ViewerStats, watch: WatchStats, nowMs: number): StoredSessionSummary {
  return {
    durationSec: sessionDurationSec(stats, nowMs),
    peakConcurrent: stats.peak,
    uniqueViewers: { total: stats.totalUnique, hls: stats.totalUniqueHls, rtc: stats.totalUniqueRtc },
    avgWatchSeconds: watch.avgWatchSeconds,
    watchSampleSize: watch.watchSampleSize,
    computedAt: nowMs,
  };
}

export function readStoredSummary(raw: unknown): StoredSessionSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as any;
  const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
  if (typeof r.computedAt !== "number") return null;
  const avg = r.avgWatchSeconds === null || r.avgWatchSeconds === undefined ? null : n(r.avgWatchSeconds);
  return {
    durationSec: n(r.durationSec),
    peakConcurrent: n(r.peakConcurrent),
    uniqueViewers: { total: n(r.uniqueViewers?.total), hls: n(r.uniqueViewers?.hls), rtc: n(r.uniqueViewers?.rtc) },
    avgWatchSeconds: avg,
    watchSampleSize: n(r.watchSampleSize),
    computedAt: r.computedAt,
  };
}
