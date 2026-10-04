/**
 * Post-stream summary: GET /api/rooms/:roomId/stream-summary (host/cohost)
 * plus the display helpers used by RoomExitPage and content cards.
 * Server shape: streamline-server/lib/streamSummaryPure.ts (StreamSummary).
 */
import { API_BASE } from "./apiBase";
import { apiFetchAuth } from "./api";

export type StreamOutputStatus = "live" | "completed" | "failed" | "stopped_limit";

export type StreamSummaryDestination = {
  platform: string;
  label: string;
  status?: "active" | "finished" | "failed";
  error?: string;
};

export type StreamSummaryOutput = {
  egressId: string;
  kind: "multistream" | "instagram" | "hls";
  destinations: StreamSummaryDestination[];
  startedAt: number | null;
  endedAt: number | null;
  durationSec: number;
  status: StreamOutputStatus;
  error?: string;
};

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
  outputs: StreamSummaryOutput[];
};

export type StreamSummaryResult =
  | { ok: true; summary: StreamSummary }
  | { ok: false; reason: "no_session" | "forbidden" | "error" };

export async function fetchStreamSummary(roomId: string, sessionId?: string | null): Promise<StreamSummaryResult> {
  const id = String(roomId || "").trim();
  if (!id) return { ok: false, reason: "error" };
  const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  try {
    const res = await apiFetchAuth(
      `${API_BASE}/api/rooms/${encodeURIComponent(id)}/stream-summary${qs}`,
      { cache: "no-store" },
      { allowNonOk: true }
    );
    if (res.status === 404) return { ok: false, reason: "no_session" };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "forbidden" };
    if (!res.ok) return { ok: false, reason: "error" };
    const body = (await res.json().catch(() => null)) as StreamSummary | null;
    if (!body || typeof body.sessionId !== "string") return { ok: false, reason: "error" };
    return { ok: true, summary: body };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** 0 -> "0s", 75 -> "1m 15s", 3725 -> "1h 2m". Non-numbers -> "—". */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (typeof totalSeconds !== "number" || !Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  return `${sec}s`;
}

/** Average watch time: "—" when the server could not measure it. */
export function formatWatchTime(avgSeconds: number | null | undefined): string {
  if (avgSeconds === null || avgSeconds === undefined) return "—";
  return formatDuration(avgSeconds);
}

/** 1234 -> "1,234"; 15300 -> "15.3K"; missing -> "—". */
export function formatViewerCount(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "—";
  const v = Math.floor(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (v >= 10_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return v.toLocaleString("en-US");
}

/** "21 channel · 9 in room" split for unique viewers. */
export function formatViewerSplit(u: { hls: number; rtc: number } | null | undefined): string {
  if (!u) return "";
  return `${formatViewerCount(u.hls)} channel · ${formatViewerCount(u.rtc)} in room`;
}

export function outputKindLabel(kind: StreamSummaryOutput["kind"]): string {
  if (kind === "hls") return "Streamline Channel (HLS)";
  if (kind === "instagram") return "Instagram (vertical)";
  return "Multistream";
}

export function outputStatusLabel(status: StreamOutputStatus | string): { label: string; tone: "ok" | "live" | "warn" | "error" } {
  switch (status) {
    case "live":
      return { label: "Live", tone: "live" };
    case "completed":
      return { label: "Completed", tone: "ok" };
    case "failed":
      return { label: "Failed", tone: "error" };
    case "stopped_limit":
      return { label: "Stopped (plan limit)", tone: "warn" };
    default:
      return { label: String(status || "Unknown"), tone: "warn" };
  }
}

/** Destination names for an output row, e.g. "YouTube, Twitch". */
export function outputDestinationsLabel(o: Pick<StreamSummaryOutput, "kind" | "destinations">): string {
  const names = (o.destinations || []).map((d) => d.label || d.platform).filter(Boolean);
  return names.length ? names.join(", ") : outputKindLabel(o.kind);
}

/** Viewer stats copied onto recording docs (server copyViewerStatsToRecording). */
export type RecordingStreamStats = {
  viewerCount?: number | null;
  peakViewers?: number | null;
  streamDurationSec?: number | null;
  avgWatchSeconds?: number | null;
};

/** Compact chips for a content card; empty when the recording has no stats. */
export function recordingStatChips(r: RecordingStreamStats | null | undefined): Array<{ key: string; label: string; title: string }> {
  if (!r) return [];
  const chips: Array<{ key: string; label: string; title: string }> = [];
  if (typeof r.peakViewers === "number" && r.peakViewers > 0) {
    chips.push({ key: "peak", label: `Peak ${formatViewerCount(r.peakViewers)}`, title: "Peak concurrent viewers" });
  }
  if (typeof r.viewerCount === "number" && r.viewerCount > 0) {
    chips.push({ key: "unique", label: `${formatViewerCount(r.viewerCount)} viewers`, title: "Unique viewers" });
  }
  if (typeof r.streamDurationSec === "number" && r.streamDurationSec > 0) {
    chips.push({ key: "duration", label: `Live ${formatDuration(r.streamDurationSec)}`, title: "Stream duration" });
  }
  if (typeof r.avgWatchSeconds === "number" && r.avgWatchSeconds > 0) {
    chips.push({ key: "avg", label: `Avg ${formatDuration(r.avgWatchSeconds)}`, title: "Average watch time" });
  }
  return chips;
}
