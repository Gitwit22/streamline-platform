/**
 * Shared helpers for the admin panels (Operations, Support, User detail):
 * a JSON fetch wrapper over apiFetchAuth, formatting, and inline styles that
 * match the existing admin dashboard look.
 */
import type { CSSProperties } from "react";
import { apiFetchAuth } from "../../../lib/api";

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "").replace(/\/api$/, "");

/** `data` is set when ok, `error` when not (single shape: the client tsconfig is not strict). */
export type AdminResult<T> = { ok: boolean; data: T; error: string; status: number; body?: any };

/** Admin API call: `path` starts with /api/. Never throws. */
export async function adminRequest<T = any>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<AdminResult<T>> {
  const { json, ...rest } = init;
  const req: RequestInit = { cache: "no-store", ...rest };
  if (json !== undefined) {
    req.body = JSON.stringify(json);
    req.headers = { "Content-Type": "application/json", ...(rest.headers || {}) };
  }
  try {
    const res = await apiFetchAuth(`${API_BASE}${path}`, req, { allowNonOk: true });
    const body: any = await res.json().catch(() => null);
    if (!res.ok) {
      const code = body?.error ?? body?.message ?? `HTTP ${res.status}`;
      const details = Array.isArray(body?.details) ? body.details.join("; ") : body?.details;
      return { ok: false, status: res.status, data: null as unknown as T, error: details ? `${code}: ${details}` : String(code), body };
    }
    return { ok: true, status: res.status, data: body as T, error: "" };
  } catch (e: unknown) {
    return { ok: false, status: 0, data: null as unknown as T, error: e instanceof Error ? e.message : "Request failed" };
  }
}

export function formatDateTime(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function formatAgo(ms: number | null | undefined, nowMs: number = Date.now()): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "never";
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null) return "Unlimited";
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${Math.round(v * 10) / 10} ${units[i]}`;
}

/** null = Unlimited, 0 = None (plan limit convention). */
export function formatLimitMinutes(v: number | null | undefined): string {
  if (v === null) return "Unlimited";
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v === 0 ? "None" : `${v} min`;
}

export const ui = {
  card: {
    background: "rgba(15,23,42,0.6)",
    border: "1px solid rgba(148,163,184,0.18)",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  } as CSSProperties,
  h3: { margin: "0 0 12px", fontSize: 16 } as CSSProperties,
  muted: { color: "#9ca3af", fontSize: 12 } as CSSProperties,
  cell: { padding: "8px 10px", borderBottom: "1px solid rgba(148,163,184,0.15)", fontSize: 13, verticalAlign: "top" } as CSSProperties,
  head: {
    padding: "8px 10px",
    borderBottom: "1px solid rgba(148,163,184,0.15)",
    fontSize: 12,
    color: "#9ca3af",
    fontWeight: 600,
    textAlign: "left",
    whiteSpace: "nowrap",
  } as CSSProperties,
  button: {
    padding: "6px 12px",
    borderRadius: 6,
    border: "none",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    background: "#2563eb",
    color: "#fff",
    whiteSpace: "nowrap",
  } as CSSProperties,
  ghostButton: {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid #374151",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    background: "transparent",
    color: "#e5e7eb",
    whiteSpace: "nowrap",
  } as CSSProperties,
  dangerButton: {
    padding: "6px 12px",
    borderRadius: 6,
    border: "none",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    background: "#dc2626",
    color: "#fff",
    whiteSpace: "nowrap",
  } as CSSProperties,
  input: {
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid #374151",
    background: "#111827",
    color: "#e5e7eb",
    fontSize: 13,
  } as CSSProperties,
};

const STATUS_COLORS: Record<string, string> = {
  operational: "#22c55e",
  enabled: "#22c55e",
  configured: "#60a5fa",
  degraded: "#eab308",
  down: "#ef4444",
  not_configured: "#9ca3af",
  disabled: "#9ca3af",
  open: "#60a5fa",
  in_progress: "#eab308",
  resolved: "#22c55e",
  closed: "#9ca3af",
  success: "#22c55e",
  failed: "#ef4444",
  retrying: "#eab308",
  pending: "#eab308",
};

export function badgeStyle(status: string | null | undefined): CSSProperties {
  const color = STATUS_COLORS[String(status || "")] || "#9ca3af";
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    color,
    background: `${color}22`,
    border: `1px solid ${color}55`,
    whiteSpace: "nowrap",
  };
}

export function humanize(value: string | null | undefined): string {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
