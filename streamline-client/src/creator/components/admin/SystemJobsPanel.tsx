import { Fragment, useCallback, useEffect, useState, type CSSProperties } from "react";
import { apiFetchAuth } from "../../../lib/api";
import {
  formatDuration,
  formatInterval,
  formatRelative,
  formatTime,
  highlightText,
  type JobsResponse,
  type SystemJob,
} from "./systemJobsFormat";

export type { JobRunSummary, SystemJob } from "./systemJobsFormat";

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

const cell: CSSProperties = { padding: "8px 10px", borderBottom: "1px solid rgba(148,163,184,0.15)", fontSize: 13, verticalAlign: "top" };
const head: CSSProperties = { ...cell, color: "#9ca3af", fontWeight: 600, textAlign: "left", whiteSpace: "nowrap" };
const muted: CSSProperties = { color: "#9ca3af", fontSize: 12 };
const button: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "none",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
  background: "#2563eb",
  color: "#fff",
  whiteSpace: "nowrap",
};

function badge(status: string | null, running: boolean) {
  const text = running ? "Running" : status ? status[0].toUpperCase() + status.slice(1) : "Never run";
  const color = running ? "#60a5fa" : status === "success" ? "#22c55e" : status === "error" ? "#ef4444" : status === "skipped" ? "#eab308" : "#9ca3af";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        color,
        background: `${color}22`,
        border: `1px solid ${color}55`,
      }}
    >
      {text}
    </span>
  );
}

/**
 * SYSTEM JOBS: last run / status / processed / duration / next run for every
 * scheduled maintenance job, with history and an audit-logged "Run now".
 */
export function SystemJobsPanel(props: { onMessage?: (msg: string) => void }) {
  const [data, setData] = useState<JobsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const notify = (msg: string) => (props.onMessage ? props.onMessage(msg) : undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetchAuth(`${API_BASE}/api/admin/jobs?runs=10`, {}, { allowNonOk: true });
      if (!res.ok) {
        setError(`Failed to load jobs (HTTP ${res.status})`);
        return;
      }
      setData((await res.json()) as JobsResponse);
      setNowMs(Date.now());
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const refresh = window.setInterval(() => void load(), 30_000);
    const clock = window.setInterval(() => setNowMs(Date.now()), 10_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(refresh);
      window.clearInterval(clock);
    };
  }, [load]);

  const runNow = async (job: SystemJob) => {
    setBusy(job.name);
    try {
      const res = await apiFetchAuth(
        `${API_BASE}/api/admin/jobs/${encodeURIComponent(job.name)}/run`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
        { allowNonOk: true }
      );
      const body = (await res.json().catch(() => ({}))) as { reason?: string; error?: string; status?: string; processed?: number };
      if (res.status === 409) notify(`${job.title}: already running (${body?.reason || "lease held"})`);
      else if (!res.ok) notify(`${job.title}: failed (${body?.error || `HTTP ${res.status}`})`);
      else if (body?.status === "error") notify(`${job.title}: error: ${body?.error || "unknown"}`);
      else notify(`${job.title}: done, processed ${body?.processed ?? 0}`);
      await load();
    } catch (e: unknown) {
      notify(`${job.title}: ${e instanceof Error ? e.message : "request failed"}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>System Jobs</h3>
          <p style={{ ...muted, margin: "4px 0 0" }}>
            Scheduled maintenance: recording limits, purges, cleanup. {data && !data.schedulerRunning && "In-process scheduler is off on this instance (cron backstop only)."}
          </p>
        </div>
        <button style={{ ...button, background: "#374151" }} onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div style={{ color: "#f87171", marginBottom: 12 }}>{error}</div>}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
          <thead>
            <tr>
              <th style={head}>Job</th>
              <th style={head}>Last run</th>
              <th style={head}>Status</th>
              <th style={head}>Processed</th>
              <th style={head}>Duration</th>
              <th style={head}>Next run</th>
              <th style={head}>Error</th>
              <th style={head} />
            </tr>
          </thead>
          <tbody>
            {(data?.jobs || []).map((job) => {
              const hl = highlightText(job);
              const isOpen = expanded === job.name;
              return (
                <Fragment key={job.name}>
                  <tr>
                    <td style={cell}>
                      <button
                        onClick={() => setExpanded(isOpen ? null : job.name)}
                        style={{ background: "none", border: "none", color: "#e5e7eb", fontWeight: 700, padding: 0, cursor: "pointer", textAlign: "left" }}
                        title={job.description || job.name}
                      >
                        {isOpen ? "▾" : "▸"} {job.title}
                      </button>
                      <div style={muted}>
                        {formatInterval(job.intervalMs)} · {job.runCount} runs{job.errorCount ? ` · ${job.errorCount} errors` : ""}
                      </div>
                    </td>
                    <td style={cell}>
                      <div>{formatTime(job.lastRunAtMs)}</div>
                      <div style={muted}>{formatRelative(job.lastRunAtMs, nowMs)}</div>
                    </td>
                    <td style={cell}>{badge(job.lastStatus, job.running)}</td>
                    <td style={cell}>
                      <div>{job.lastProcessed ?? "—"}</div>
                      {hl && <div style={muted}>{hl}</div>}
                    </td>
                    <td style={cell}>{formatDuration(job.lastDurationMs)}</td>
                    <td style={cell}>
                      {job.enabled ? (
                        <>
                          <div>{job.nextRunAtMs ? formatTime(job.nextRunAtMs) : "Soon"}</div>
                          <div style={muted}>{job.nextRunAtMs ? (job.nextRunAtMs <= nowMs ? "due" : formatRelative(job.nextRunAtMs, nowMs)) : ""}</div>
                        </>
                      ) : (
                        <span style={muted}>Timer disabled</span>
                      )}
                    </td>
                    <td style={{ ...cell, color: "#fca5a5", maxWidth: 260, wordBreak: "break-word" }}>
                      {job.lastStatus === "error" ? job.lastError : ""}
                    </td>
                    <td style={cell}>
                      <button
                        style={{ ...button, opacity: busy === job.name || job.running ? 0.6 : 1 }}
                        disabled={busy !== null || job.running}
                        onClick={() => void runNow(job)}
                      >
                        {busy === job.name ? "Running…" : "Run now"}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td style={{ ...cell, background: "rgba(17,24,39,0.6)" }} colSpan={8}>
                        {job.description && <div style={{ ...muted, marginBottom: 8 }}>{job.description}</div>}
                        {job.recentRuns.length === 0 ? (
                          <div style={muted}>No runs recorded yet.</div>
                        ) : (
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                              <tr>
                                <th style={head}>Started</th>
                                <th style={head}>Trigger</th>
                                <th style={head}>Status</th>
                                <th style={head}>Processed</th>
                                <th style={head}>Duration</th>
                                <th style={head}>Details</th>
                              </tr>
                            </thead>
                            <tbody>
                              {job.recentRuns.map((r, i) => (
                                <tr key={r.id || `${r.startedAtMs}-${i}`}>
                                  <td style={cell}>
                                    {formatTime(r.startedAtMs)} <span style={muted}>{formatRelative(r.startedAtMs, nowMs)}</span>
                                  </td>
                                  <td style={cell}>{r.trigger || "—"}</td>
                                  <td style={cell}>{badge(r.status, false)}</td>
                                  <td style={cell}>{r.processed ?? 0}</td>
                                  <td style={cell}>{formatDuration(r.durationMs)}</td>
                                  <td style={{ ...cell, fontFamily: "monospace", fontSize: 11, wordBreak: "break-word" }}>
                                    {r.error ? <div style={{ color: "#fca5a5" }}>{r.error}</div> : null}
                                    {r.details && Object.keys(r.details).length ? JSON.stringify(r.details) : ""}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {data && data.jobs.length === 0 && (
              <tr>
                <td style={cell} colSpan={8}>
                  No jobs registered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default SystemJobsPanel;
