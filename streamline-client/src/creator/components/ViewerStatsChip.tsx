import { useEffect, useState } from "react";
import { apiFetchOptionalAuth } from "../../lib/api";

/** Response of GET /api/rooms/:roomId/viewers (host/cohost only). */
export type RoomViewerStats = {
  sessionId: string | null;
  startedAt: number | null;
  live: boolean;
  current: { total: number; hls: number; rtcAudience: number; onStage: number };
  totalUnique: { total: number; hls: number; rtc: number };
  peak: number;
};

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function parseRoomViewerStats(raw: unknown): RoomViewerStats | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as any;
  return {
    sessionId: typeof r.sessionId === "string" ? r.sessionId : null,
    startedAt: typeof r.startedAt === "number" ? r.startedAt : null,
    live: r.live === true,
    current: {
      total: n(r.current?.total),
      hls: n(r.current?.hls),
      rtcAudience: n(r.current?.rtcAudience),
      onStage: n(r.current?.onStage),
    },
    totalUnique: { total: n(r.totalUnique?.total), hls: n(r.totalUnique?.hls), rtc: n(r.totalUnique?.rtc) },
    peak: n(r.peak),
  };
}

export function viewerStatsTooltip(s: RoomViewerStats): string {
  return [
    `Watching now: ${s.current.total} (HLS ${s.current.hls} · room audience ${s.current.rtcAudience})`,
    `On stage: ${s.current.onStage}`,
    `Peak: ${s.peak}`,
    `Total this session: ${s.totalUnique.total} (HLS ${s.totalUnique.hls} · room ${s.totalUnique.rtc})`,
  ].join("\n");
}

const LIVE_POLL_MS = 10_000;
const IDLE_POLL_MS = 30_000;

/**
 * Host/cohost viewer stat chip: "👁 {current} watching · {total} total".
 * Polls every 10s while the room's live session is active; hidden otherwise
 * and stops quietly on 401/403.
 */
export default function ViewerStatsChip({
  roomId,
  roomAccessToken,
}: {
  roomId: string;
  roomAccessToken: string | null;
}) {
  const [stats, setStats] = useState<RoomViewerStats | null>(null);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const poll = async () => {
      let live = false;
      try {
        const res = await apiFetchOptionalAuth(`/api/rooms/${encodeURIComponent(roomId)}/viewers`, {
          headers: roomAccessToken ? { "x-room-access-token": roomAccessToken } : {},
        });
        if (cancelled) return;
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          setStats(null);
          return;
        }
        if (res.ok) {
          failures = 0;
          const parsed = parseRoomViewerStats(await res.json().catch(() => null));
          if (cancelled) return;
          setStats(parsed);
          live = !!parsed?.live;
        } else {
          failures++;
        }
      } catch {
        failures++;
      }
      if (!cancelled) timer = setTimeout(poll, live && failures === 0 ? LIVE_POLL_MS : IDLE_POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [roomId, roomAccessToken]);

  if (!stats || !stats.live) return null;

  return (
    <div
      data-testid="viewer-stats-chip"
      title={viewerStatsTooltip(stats)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.25rem",
        fontSize: "0.75rem",
        color: "#e5e7eb",
        padding: "0.25rem 0.5rem",
        borderRadius: "999px",
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.12)",
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden>👁</span>
      <span>
        {stats.current.total.toLocaleString()} watching · {stats.totalUnique.total.toLocaleString()} total
      </span>
    </div>
  );
}
