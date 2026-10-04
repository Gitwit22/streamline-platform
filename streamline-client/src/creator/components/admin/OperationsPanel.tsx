import { Fragment, useCallback, useEffect, useState } from "react";
import { adminRequest, badgeStyle, formatAgo, formatDateTime, humanize, ui } from "./adminUi";

export type ServiceCheck = {
  name: string;
  label?: string;
  status: string;
  latencyMs?: number | null;
  detail?: string | null;
  checkedAt?: string;
};

export type ActiveRoom = {
  roomId: string;
  name?: string | null;
  ownerId?: string | null;
  ownerEmail?: string | null;
  access?: string | null;
  startedAt?: number | null;
  createdAt?: number | null;
  participants?: number | null;
  onStage?: number | null;
  currentViewers?: number | null;
  hlsViewers?: number | null;
  viewerStats?: { peak: number; totalUnique: number } | null;
  activeOutputs?: number | null;
  hlsStatus?: string | null;
};

type Overview = {
  webhooks: { total: number; success: number; failed: number; retrying?: number };
  activeRooms: number;
  supportTickets?: { open: number; inProgress: number };
  pendingSupportEvents: number;
};

type Alert = {
  id: string;
  type?: string;
  severity?: string;
  title?: string | null;
  message?: string | null;
  status?: string;
  createdAt?: number;
  roomId?: string | null;
};

type Delivery = {
  id: string;
  event?: string;
  destination?: string;
  status?: string;
  statusCode?: number | null;
  attemptCount?: number;
  createdAt?: number;
};

type Summary = {
  sessionId: string;
  live: boolean;
  durationSec: number;
  peakConcurrent: number;
  uniqueViewers: { total: number; hls: number; rtc: number };
  avgWatchSeconds: number | null;
  outputs: Array<{ egressId: string; kind: string; status: string; durationSec: number; destinations: Array<{ label: string }> }>;
};

function num(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "—";
}

function duration(sec: number | null | undefined): string {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${Math.round(sec % 60)}s`;
}

/**
 * OPERATIONS: service health, live rooms (owner, access mode, participants,
 * viewers, active outputs) with an inline stream summary, Horizon alerts and
 * recent webhook deliveries. Backed by /api/admin/monitoring/*, /alerts,
 * /rooms/active.
 */
export function OperationsPanel(props: { onOpenUser?: (uid: string) => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [services, setServices] = useState<ServiceCheck[] | null>(null);
  const [rooms, setRooms] = useState<ActiveRoom[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [summaryRoom, setSummaryRoom] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null | "none" | "error">(null);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    const errs: string[] = [];
    const [o, s, r, a, w] = await Promise.all([
      adminRequest<Overview>("/api/admin/monitoring/overview"),
      adminRequest<{ services: ServiceCheck[] }>(`/api/admin/monitoring/services${fresh ? "?fresh=1" : ""}`),
      adminRequest<{ rooms: ActiveRoom[] }>("/api/admin/rooms/active?limit=50"),
      adminRequest<{ alerts: Alert[] }>("/api/admin/alerts?limit=20"),
      adminRequest<{ deliveries: Delivery[] }>("/api/admin/monitoring/webhooks?limit=20"),
    ]);
    if (o.ok) setOverview(o.data);
    else errs.push(`Overview: ${o.error}`);
    if (s.ok) setServices(s.data.services || []);
    else errs.push(`Services: ${s.error}`);
    if (r.ok) setRooms(r.data.rooms || []);
    else errs.push(`Active rooms: ${r.error}`);
    if (a.ok) setAlerts(a.data.alerts || []);
    else errs.push(`Alerts: ${a.error}`);
    if (w.ok) setDeliveries(w.data.deliveries || []);
    else errs.push(`Webhooks: ${w.error}`);
    setErrors(errs);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSummary = async (roomId: string) => {
    if (summaryRoom === roomId) {
      setSummaryRoom(null);
      return;
    }
    setSummaryRoom(roomId);
    setSummary(null);
    const res = await adminRequest<Summary>(`/api/admin/rooms/${encodeURIComponent(roomId)}/stream-summary`);
    if (res.ok) setSummary(res.data);
    else setSummary(res.status === 404 ? "none" : "error");
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12 }}>
        <h3 style={{ margin: 0 }}>Operations</h3>
        <button type="button" style={ui.button} onClick={() => load(true)} disabled={loading}>
          {loading ? "Checking…" : "Re-check now"}
        </button>
      </div>
      {errors.length > 0 && (
        <div role="alert" style={{ ...ui.card, borderColor: "rgba(239,68,68,0.5)", color: "#fca5a5", fontSize: 13 }}>
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}

      {overview && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
          {[
            { l: "Live rooms", v: overview.activeRooms },
            { l: "Open tickets", v: overview.supportTickets?.open ?? 0 },
            { l: "In-progress tickets", v: overview.supportTickets?.inProgress ?? 0 },
            { l: "Pending alerts", v: overview.pendingSupportEvents },
            { l: "Webhooks (24h)", v: overview.webhooks.total },
            { l: "Webhooks failed (24h)", v: overview.webhooks.failed },
          ].map((s) => (
            <div key={s.l} style={{ ...ui.card, marginBottom: 0, textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{s.v}</div>
              <div style={ui.muted}>{s.l}</div>
            </div>
          ))}
        </div>
      )}

      <div style={ui.card}>
        <h3 style={ui.h3}>Service health</h3>
        {!services ? (
          <div style={ui.muted}>Loading…</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Service", "Status", "Latency", "Detail"].map((h) => (
                  <th key={h} style={ui.head}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.name}>
                  <td style={ui.cell}>{s.label || humanize(s.name)}</td>
                  <td style={ui.cell}>
                    <span style={badgeStyle(s.status)}>{humanize(s.status)}</span>
                  </td>
                  <td style={ui.cell}>{typeof s.latencyMs === "number" ? `${s.latencyMs} ms` : "—"}</td>
                  <td style={{ ...ui.cell, color: "#9ca3af" }}>{s.detail || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={ui.card}>
        <h3 style={ui.h3}>Live rooms {rooms ? `(${rooms.length})` : ""}</h3>
        {!rooms ? (
          <div style={ui.muted}>Loading…</div>
        ) : rooms.length === 0 ? (
          <div style={ui.muted}>No rooms are live right now.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Room", "Owner", "Access", "Participants", "Viewers (now / peak / unique)", "Outputs", "Started", ""].map((h) => (
                    <th key={h} style={ui.head}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <Fragment key={r.roomId}>
                    <tr>
                      <td style={ui.cell}>
                        <div style={{ fontWeight: 600 }}>{r.name || r.roomId}</div>
                        <div style={ui.muted}>{r.roomId}</div>
                      </td>
                      <td style={ui.cell}>
                        {r.ownerId && props.onOpenUser ? (
                          <button
                            type="button"
                            style={{ ...ui.ghostButton, padding: "2px 6px" }}
                            onClick={() => props.onOpenUser?.(String(r.ownerId))}
                          >
                            {r.ownerEmail || r.ownerId}
                          </button>
                        ) : (
                          r.ownerEmail || r.ownerId || "—"
                        )}
                      </td>
                      <td style={ui.cell}>{humanize(r.access || "")}</td>
                      <td style={ui.cell}>
                        {num(r.participants)}
                        {typeof r.onStage === "number" ? <div style={ui.muted}>{r.onStage} on stage</div> : null}
                      </td>
                      <td style={ui.cell}>
                        {num(r.currentViewers)} / {num(r.viewerStats?.peak)} / {num(r.viewerStats?.totalUnique)}
                        {typeof r.hlsViewers === "number" ? <div style={ui.muted}>{r.hlsViewers} HLS</div> : null}
                      </td>
                      <td style={ui.cell}>{num(r.activeOutputs)}</td>
                      <td style={ui.cell} title={formatDateTime(r.startedAt ?? null)}>
                        {formatAgo(r.startedAt ?? null)}
                      </td>
                      <td style={ui.cell}>
                        <button type="button" style={ui.ghostButton} onClick={() => toggleSummary(r.roomId)}>
                          {summaryRoom === r.roomId ? "Hide summary" : "Stream summary"}
                        </button>
                      </td>
                    </tr>
                    {summaryRoom === r.roomId && (
                      <tr>
                        <td colSpan={8} style={{ ...ui.cell, background: "rgba(2,6,23,0.5)" }}>
                          {summary === null ? (
                            <span style={ui.muted}>Loading summary…</span>
                          ) : summary === "none" ? (
                            <span style={ui.muted}>No live session recorded for this room yet.</span>
                          ) : summary === "error" ? (
                            <span style={{ color: "#fca5a5" }}>Failed to load the stream summary.</span>
                          ) : (
                            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}>
                              <span>Duration: {duration(summary.durationSec)}</span>
                              <span>Peak: {summary.peakConcurrent}</span>
                              <span>
                                Unique: {summary.uniqueViewers.total} ({summary.uniqueViewers.rtc} in-room, {summary.uniqueViewers.hls} HLS)
                              </span>
                              <span>Avg watch: {summary.avgWatchSeconds === null ? "—" : duration(summary.avgWatchSeconds)}</span>
                              <span>
                                Outputs:{" "}
                                {summary.outputs.length === 0
                                  ? "none"
                                  : summary.outputs
                                      .map((o) => `${o.kind} (${o.status}${o.destinations.length ? `: ${o.destinations.map((d) => d.label).join(", ")}` : ""})`)
                                      .join("; ")}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={ui.card}>
        <h3 style={ui.h3}>Recent alerts (Horizon)</h3>
        {!alerts ? (
          <div style={ui.muted}>Loading…</div>
        ) : alerts.length === 0 ? (
          <div style={ui.muted}>No alerts recorded.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td style={ui.cell}>
                    <span style={badgeStyle(a.severity === "critical" || a.severity === "high" || a.severity === "error" ? "failed" : a.status || "pending")}>
                      {a.severity || a.status || "event"}
                    </span>
                  </td>
                  <td style={ui.cell}>{a.type}</td>
                  <td style={ui.cell}>{a.title || a.message || (a.roomId ? `room ${a.roomId}` : "")}</td>
                  <td style={{ ...ui.cell, ...ui.muted }}>{formatAgo(a.createdAt ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={ui.card}>
        <h3 style={ui.h3}>Recent webhook deliveries</h3>
        {!deliveries ? (
          <div style={ui.muted}>Loading…</div>
        ) : deliveries.length === 0 ? (
          <div style={ui.muted}>No deliveries logged (outbound hooks may be disabled).</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td style={ui.cell}>
                    <span style={badgeStyle(d.status)}>{d.status}</span>
                  </td>
                  <td style={ui.cell}>{d.event}</td>
                  <td style={{ ...ui.cell, ...ui.muted }}>{d.destination}</td>
                  <td style={ui.cell}>{d.statusCode ?? "—"}</td>
                  <td style={{ ...ui.cell, ...ui.muted }}>{formatAgo(d.createdAt ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
