import { useState, type CSSProperties } from "react";
import { apiFetchAuth } from "../../../lib/api";

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

export type AdminPlanOverrideView = {
  planId: string;
  reason?: string;
  createdBy?: string;
  startsAt?: number | null;
  expiresAt?: number | null;
  active?: boolean;
  legacy?: boolean;
} | null;

export type PlanOverridePanelProps = {
  userId: string;
  /** Stripe / billing base plan (users.planId). */
  basePlanId?: string | null;
  /** Plan every feature reads (override > platform admin > base). */
  effectivePlanId?: string | null;
  planOverride?: AdminPlanOverrideView;
  decidedBy?: string | null;
  subscriptionBlockedReason?: string | null;
  planOptions: Array<{ id: string; name?: string }>;
  onChanged?: () => void | Promise<void>;
  onMessage?: (msg: string) => void;
};

async function describeError(res: Response): Promise<string> {
  try {
    const body: any = await res.json();
    return String(body?.error || body?.reason || `HTTP ${res.status}`);
  } catch {
    return `HTTP ${res.status}`;
  }
}

function formatDate(ms?: number | null): string {
  if (!ms) return "Never";
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "Never" : d.toLocaleString();
}

const cell: CSSProperties = { padding: "6px 8px", borderBottom: "1px solid rgba(148,163,184,0.15)", fontSize: 13 };
const head: CSSProperties = { ...cell, color: "#9ca3af", fontWeight: 600, textAlign: "left" };
const input: CSSProperties = {
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid #374151",
  background: "#111827",
  color: "#e5e7eb",
  fontSize: 13,
};
const button: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "none",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};

/**
 * Admin override editor: Stripe Plan / Admin Override / Effective Plan /
 * Reason / Expires / [Remove Override]. An override grants the plan WITHOUT a
 * Stripe subscription (no billing block); expired overrides are ignored by the
 * server automatically. Every change is audit-logged server-side.
 */
export function PlanOverridePanel(props: PlanOverridePanelProps) {
  const { userId, planOverride } = props;
  const [planId, setPlanId] = useState<string>(planOverride?.planId || props.planOptions[0]?.id || "pro");
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);

  const notify = (msg: string) => (props.onMessage ? props.onMessage(msg) : window.alert(msg));

  const setOverride = async () => {
    if (!reason.trim()) {
      notify("A reason is required for an admin override.");
      return;
    }
    setBusy(true);
    try {
      const body: any = { planId, reason: reason.trim() };
      if (expires) body.expiresAt = new Date(expires).getTime();
      const res = await apiFetchAuth(
        `${API_BASE}/api/admin/users/${encodeURIComponent(userId)}/plan-override`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        { allowNonOk: true }
      );
      if (!res.ok) {
        notify(`Override failed: ${await describeError(res)}`);
        return;
      }
      notify(`Override set: ${planId}`);
      setReason("");
      setExpires("");
      await props.onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const removeOverride = async () => {
    if (!window.confirm("Remove the admin override? The user falls back to their Stripe/base plan.")) return;
    setBusy(true);
    try {
      const res = await apiFetchAuth(
        `${API_BASE}/api/admin/users/${encodeURIComponent(userId)}/plan-override`,
        { method: "DELETE" },
        { allowNonOk: true }
      );
      if (!res.ok) {
        notify(`Remove failed: ${await describeError(res)}`);
        return;
      }
      notify("Override removed");
      await props.onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const overrideLabel = planOverride
    ? `${planOverride.planId}${planOverride.legacy ? " (legacy)" : ""}${planOverride.active === false ? " (inactive)" : ""}`
    : "None";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Stripe Plan", "Admin Override", "Effective Plan", "Reason", "Expires", ""].map((h) => (
              <th key={h} style={head}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={cell}>
              {props.basePlanId || "free"}
              {props.subscriptionBlockedReason ? (
                <div style={{ fontSize: 11, color: "#f59e0b" }}>{props.subscriptionBlockedReason}</div>
              ) : null}
            </td>
            <td style={cell}>{overrideLabel}</td>
            <td style={{ ...cell, fontWeight: 700 }}>
              {props.effectivePlanId || props.basePlanId || "free"}
              {props.decidedBy === "internal_admin" ? (
                <div style={{ fontSize: 11, color: "#9ca3af" }}>platform admin</div>
              ) : null}
            </td>
            <td style={cell}>{planOverride?.reason || "—"}</td>
            <td style={cell}>{planOverride ? formatDate(planOverride.expiresAt) : "—"}</td>
            <td style={cell}>
              {planOverride ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={removeOverride}
                  style={{ ...button, background: "rgba(220,38,38,0.25)", color: "#fecaca" }}
                >
                  Remove Override
                </button>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <select value={planId} onChange={(e) => setPlanId(e.target.value)} style={input} aria-label="Override plan">
          {props.planOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.id}
            </option>
          ))}
        </select>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required)"
          style={{ ...input, minWidth: 180 }}
          aria-label="Override reason"
        />
        <input
          type="datetime-local"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
          style={input}
          aria-label="Override expires (optional)"
          title="Expires (optional; empty = no expiry)"
        />
        <button
          type="button"
          disabled={busy}
          onClick={setOverride}
          style={{ ...button, background: "#4f46e5", color: "#fff", opacity: busy ? 0.6 : 1 }}
        >
          {planOverride ? "Replace Override" : "Set Override"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af" }}>
        An override sets the EFFECTIVE plan without requiring a Stripe subscription. Use it instead of changing
        the base plan, which is owned by billing.
      </div>
    </div>
  );
}

export default PlanOverridePanel;
