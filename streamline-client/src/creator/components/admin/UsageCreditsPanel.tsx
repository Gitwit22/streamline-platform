import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { apiFetchAuth } from "../../../lib/api";
import { parseExpiryDate, parseGrantMinutes } from "../../../lib/adminAccountDeletion";

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

type CreditRow = {
  id: string;
  amount: number;
  remaining: number;
  consumedMinutes: number;
  type: string;
  expiresAt: string | null;
  source: string;
  reason: string;
  createdBy: string;
  createdAt: string | null;
  revokedAt: string | null;
  status: "active" | "depleted" | "expired" | "revoked" | "unsupported";
};

type CreditsPayload = {
  planAllowanceMinutes: number | null;
  usedMinutes: number;
  limitMinutes: number | null;
  creditRemainingMinutes: number;
  creditConsumedThisMonth: number;
  credits: CreditRow[];
};

export type UsageCreditsPanelProps = {
  userId: string;
  onMessage?: (msg: string) => void;
  onChanged?: () => void | Promise<void>;
};

const cell: CSSProperties = { padding: "6px 8px", borderBottom: "1px solid rgba(148,163,184,0.15)", fontSize: 12, textAlign: "left" };
const head: CSSProperties = { ...cell, color: "#9ca3af", fontWeight: 600 };
const input: CSSProperties = {
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid #374151",
  background: "#111827",
  color: "#e5e7eb",
  fontSize: 13,
};
const button: CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "none", fontWeight: 600, fontSize: 13, cursor: "pointer" };

async function describeError(res: Response): Promise<string> {
  try {
    const body: any = await res.json();
    const code = body?.error || `HTTP ${res.status}`;
    return body?.details ? `${code}: ${body.details}` : String(code);
  } catch {
    return `HTTP ${res.status}`;
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Never" : d.toLocaleDateString();
}

/**
 * One-time usage credits for a user: grant (minutes, reason, optional expiry),
 * list, revoke. Credits are consumed only by minutes beyond the plan
 * allowance and carry over month to month (not a monthly top-up).
 */
export function UsageCreditsPanel({ userId, onMessage, onChanged }: UsageCreditsPanelProps) {
  const [data, setData] = useState<CreditsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [minutes, setMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);

  const notify = (msg: string) => (onMessage ? onMessage(msg) : window.alert(msg));

  const load = useCallback(async () => {
    setLoadError(null);
    const res = await apiFetchAuth(`${API_BASE}/api/admin/users/${encodeURIComponent(userId)}/credits`, {}, { allowNonOk: true });
    if (!res.ok) {
      setLoadError(await describeError(res));
      return;
    }
    setData((await res.json()) as CreditsPayload);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const parsedMinutes = parseGrantMinutes(minutes);
  const minutesInvalid = minutes.trim() !== "" && parsedMinutes === null;
  const expiryMs = expires ? parseExpiryDate(expires) : null;
  const canGrant = parsedMinutes !== null && reason.trim().length > 0 && (!expires || (expiryMs !== null && expiryMs > Date.now())) && !busy;

  const grant = async () => {
    if (!canGrant || parsedMinutes === null) return;
    setBusy(true);
    try {
      const body: any = { minutes: parsedMinutes, reason: reason.trim(), type: "one_time" };
      if (expiryMs !== null) body.expiresAt = expiryMs;
      const res = await apiFetchAuth(
        `${API_BASE}/api/admin/users/${encodeURIComponent(userId)}/grant-minutes`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        { allowNonOk: true }
      );
      if (!res.ok) {
        notify(`Grant failed: ${await describeError(res)}`);
        return;
      }
      notify(`Granted a one-time credit of ${parsedMinutes} min`);
      setMinutes("");
      setReason("");
      setExpires("");
      await load();
      await onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (c: CreditRow) => {
    const why = window.prompt(`Revoke the remaining ${c.remaining} min of this credit? Reason (optional):`, "");
    if (why === null) return;
    setBusy(true);
    try {
      const res = await apiFetchAuth(
        `${API_BASE}/api/admin/users/${encodeURIComponent(userId)}/credits/${encodeURIComponent(c.id)}/revoke`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: why }) },
        { allowNonOk: true }
      );
      if (!res.ok) {
        notify(`Revoke failed: ${await describeError(res)}`);
        return;
      }
      notify("Credit revoked");
      await load();
      await onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ color: "#9ca3af", fontSize: 12 }}>
        One-time credit: used only after the plan's monthly minutes run out; whatever is left carries over to
        later months. It is not added every month.
      </div>
      {data && (
        <div style={{ fontSize: 13, color: "#e5e7eb" }}>
          Plan allowance: {data.planAllowanceMinutes === null ? "Unlimited" : `${data.planAllowanceMinutes} min/mo`} · Used this
          month: {data.usedMinutes} min · Credit used this month: {data.creditConsumedThisMonth} min · Credit remaining:{" "}
          <b>{data.creditRemainingMinutes} min</b>
        </div>
      )}
      {loadError && <div style={{ color: "#fca5a5", fontSize: 13 }}>Could not load credits: {loadError}</div>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input
          style={{ ...input, width: 110, borderColor: minutesInvalid ? "#ef4444" : "#374151" }}
          inputMode="numeric"
          placeholder="Minutes"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          aria-label="Minutes"
        />
        {[60, 120, 300, 600].map((m) => (
          <button key={m} type="button" style={{ ...button, background: "#1f2937", color: "#e5e7eb" }} onClick={() => setMinutes(String(m))}>
            {m}
          </button>
        ))}
        <input
          style={{ ...input, flex: 1, minWidth: 160 }}
          placeholder="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="Reason"
        />
        <label style={{ fontSize: 12, color: "#9ca3af", display: "flex", gap: 6, alignItems: "center" }}>
          Expires
          <input type="date" style={input} value={expires} onChange={(e) => setExpires(e.target.value)} aria-label="Expiry date" />
        </label>
        <button
          type="button"
          onClick={grant}
          disabled={!canGrant}
          style={{ ...button, background: "#16a34a", color: "#fff", opacity: canGrant ? 1 : 0.5 }}
        >
          Grant credit
        </button>
      </div>
      {minutesInvalid && <div style={{ color: "#fca5a5", fontSize: 12 }}>Minutes must be a positive whole number.</div>}

      {data && data.credits.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Granted", "Remaining", "Status", "Expires", "Reason", "Created", ""].map((h) => (
                <th key={h} style={head}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.credits.map((c) => (
              <tr key={c.id}>
                <td style={cell}>{c.amount} min</td>
                <td style={cell}>{c.remaining} min</td>
                <td style={cell}>{c.status}</td>
                <td style={cell}>{fmtDate(c.expiresAt)}</td>
                <td style={cell} title={`${c.source} · by ${c.createdBy}`}>
                  {c.reason || c.source}
                </td>
                <td style={cell}>{fmtDate(c.createdAt)}</td>
                <td style={cell}>
                  {c.status === "active" && (
                    <button type="button" disabled={busy} onClick={() => revoke(c)} style={{ ...button, background: "#7f1d1d", color: "#fff" }}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default UsageCreditsPanel;
