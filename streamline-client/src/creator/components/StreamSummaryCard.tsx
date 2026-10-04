import { useEffect, useState, type CSSProperties } from "react";
import {
  fetchStreamSummary,
  formatDuration,
  formatViewerCount,
  formatViewerSplit,
  formatWatchTime,
  outputDestinationsLabel,
  outputKindLabel,
  outputStatusLabel,
  type StreamSummary,
} from "../../lib/streamSummary";

/** While the session is still closing (webhooks pending), refresh a few times. */
const POLL_MS = 5_000;
const MAX_POLLS = 12;

/**
 * Post-stream summary for hosts/cohosts (GET /api/rooms/:roomId/stream-summary).
 * Renders nothing when the room never went live or the viewer is not a host.
 */
export default function StreamSummaryCard({ roomId, sessionId }: { roomId: string; sessionId?: string | null }) {
  const [summary, setSummary] = useState<StreamSummary | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "hidden" | "error">("loading");

  useEffect(() => {
    if (!roomId) {
      setState("hidden");
      return;
    }
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const result = await fetchStreamSummary(roomId, sessionId);
      if (cancelled) return;
      if (result.ok) {
        setSummary(result.summary);
        setState("ready");
        if (result.summary.live && polls < MAX_POLLS) {
          polls += 1;
          timer = setTimeout(load, POLL_MS);
        }
        return;
      }
      const next = (result as { reason?: string }).reason === "error" ? "error" : "hidden";
      setState((prev) => (prev === "ready" ? prev : next));
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [roomId, sessionId]);

  if (state === "hidden") return null;

  return (
    <div style={cardStyle} data-testid="stream-summary-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#fff" }}>Stream summary</h2>
        {summary?.live && (
          <span style={{ fontSize: 11, color: "#fcd34d", fontWeight: 700 }} title="Outputs are still closing">
            Finalizing…
          </span>
        )}
      </div>

      {state === "loading" && <div style={{ fontSize: 13, color: "#9ca3af" }}>Loading stream stats…</div>}
      {state === "error" && <div style={{ fontSize: 13, color: "#9ca3af" }}>Stream stats are unavailable right now.</div>}

      {summary && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            <Stat label="Peak concurrent viewers" value={formatViewerCount(summary.peakConcurrent)} />
            <Stat
              label="Unique viewers"
              value={formatViewerCount(summary.uniqueViewers.total)}
              sub={formatViewerSplit(summary.uniqueViewers)}
            />
            <Stat label="Stream duration" value={formatDuration(summary.durationSec)} />
            <Stat
              label="Avg watch time"
              value={formatWatchTime(summary.avgWatchSeconds)}
              sub={
                summary.avgWatchSeconds === null
                  ? "Not enough data"
                  : `${formatViewerCount(summary.watchSampleSize)} measured viewer${summary.watchSampleSize === 1 ? "" : "s"}`
              }
            />
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700, marginBottom: 8 }}>Outputs</div>
            {summary.outputs.length === 0 ? (
              <div style={{ fontSize: 13, color: "#9ca3af" }}>No multistream or channel outputs this session.</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {summary.outputs.map((o) => {
                  const st = outputStatusLabel(o.status);
                  return (
                    <div key={o.egressId} style={rowStyle} data-testid="stream-summary-output">
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>{outputDestinationsLabel(o)}</div>
                        <div style={{ fontSize: 11, color: "#6b7280" }}>
                          {outputKindLabel(o.kind)} · {formatDuration(o.durationSec)}
                        </div>
                        {o.error && <div style={{ fontSize: 11, color: "#fca5a5", marginTop: 2 }}>{o.error}</div>}
                        {o.destinations.some((d) => d.status === "failed") && (
                          <div style={{ fontSize: 11, color: "#fca5a5", marginTop: 2 }}>
                            Failed: {o.destinations.filter((d) => d.status === "failed").map((d) => d.label).join(", ")}
                          </div>
                        )}
                      </div>
                      <span style={{ ...badgeBase, ...TONES[st.tone] }}>{st.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={statStyle}>
      <div style={{ fontSize: 11, color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const cardStyle: CSSProperties = {
  background: "rgba(15, 15, 15, 0.7)",
  backdropFilter: "blur(20px)",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  borderRadius: 20,
  padding: 24,
  marginBottom: 24,
};
const statStyle: CSSProperties = {
  background: "rgba(0, 0, 0, 0.4)",
  border: "1px solid rgba(255, 255, 255, 0.05)",
  borderRadius: 12,
  padding: 12,
};
const rowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 10,
  background: "rgba(0, 0, 0, 0.4)",
  border: "1px solid rgba(255, 255, 255, 0.05)",
  borderRadius: 10,
  padding: "10px 12px",
};
const badgeBase: CSSProperties = {
  flexShrink: 0,
  fontSize: 11,
  fontWeight: 700,
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid",
};
const TONES: Record<"ok" | "live" | "warn" | "error", CSSProperties> = {
  ok: { color: "#bbf7d0", borderColor: "rgba(34,197,94,0.45)", background: "rgba(34,197,94,0.12)" },
  live: { color: "#fecaca", borderColor: "rgba(239,68,68,0.5)", background: "rgba(239,68,68,0.14)" },
  warn: { color: "#fde68a", borderColor: "rgba(245,158,11,0.45)", background: "rgba(245,158,11,0.12)" },
  error: { color: "#fca5a5", borderColor: "rgba(239,68,68,0.6)", background: "rgba(127,29,29,0.35)" },
};
