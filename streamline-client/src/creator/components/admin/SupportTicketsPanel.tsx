import { useCallback, useEffect, useState } from "react";
import { adminRequest, badgeStyle, formatAgo, formatDateTime, humanize, ui } from "./adminUi";

export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

export type TicketSummary = {
  id: string;
  status: TicketStatus;
  allowedNext: TicketStatus[];
  subject: string;
  category: string;
  priority: string;
  submitter: { uid: string | null; email: string | null; auth: string | null };
  assignee: string | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  notesCount: number;
};

export type TicketDetail = TicketSummary & {
  message: string;
  meta: { pageUrl: string | null; userAgent: string | null; context: Record<string, string> };
  history: Array<{ at: number; by: string; action: string; from?: string | null; to?: string | null }>;
  internalNotes: Array<{ at: number; by: string; byEmail?: string | null; text: string }>;
};

const FILTERS: Array<{ id: "" | TicketStatus; label: string }> = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "resolved", label: "Resolved" },
  { id: "closed", label: "Closed" },
  { id: "", label: "All" },
];

/**
 * SUPPORT: tickets from the public /support form (supportTickets). List with
 * status filter, detail with status change, assignee and internal notes.
 * There is no outbound email: the submitter is not notified automatically.
 */
export function SupportTicketsPanel(props: { onMessage?: (msg: string) => void; onOpenUser?: (uid: string) => void }) {
  const [filter, setFilter] = useState<"" | TicketStatus>("open");
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);

  const notify = (msg: string) => props.onMessage?.(msg);

  const load = useCallback(
    async (cursor?: string | null) => {
      const qs = new URLSearchParams({ limit: "50" });
      if (filter) qs.set("status", filter);
      if (cursor) qs.set("cursor", cursor);
      const res = await adminRequest<{ tickets: TicketSummary[]; nextCursor: string | null }>(`/api/admin/support/tickets?${qs.toString()}`);
      if (!res.ok) {
        setError(`Failed to load tickets: ${res.error}`);
        if (!cursor) setTickets([]);
        return;
      }
      setError(null);
      setTickets((prev) => (cursor && prev ? [...prev, ...res.data.tickets] : res.data.tickets));
      setNextCursor(res.data.nextCursor);
    },
    [filter]
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const open = async (id: string) => {
    const res = await adminRequest<{ ticket: TicketDetail }>(`/api/admin/support/tickets/${encodeURIComponent(id)}`);
    if (!res.ok) {
      notify(`Failed to open ticket: ${res.error}`);
      return;
    }
    setSelected(res.data.ticket);
    setAssignee(res.data.ticket.assignee || "");
    setNote("");
  };

  const patch = async (body: Record<string, unknown>, okMsg: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await adminRequest<{ ticket: TicketDetail }>(`/api/admin/support/tickets/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        json: body,
      });
      if (!res.ok) {
        notify(`Update failed: ${res.error}`);
        return;
      }
      setSelected(res.data.ticket);
      setNote("");
      notify(okMsg);
      await load(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: selected ? "minmax(0, 1fr) minmax(0, 1fr)" : "1fr", gap: 16 }}>
      <div style={ui.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Support tickets</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="tablist" aria-label="Ticket status filter">
            {FILTERS.map((f) => (
              <button
                key={f.id || "all"}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                style={filter === f.id ? ui.button : ui.ghostButton}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <p style={{ ...ui.muted, marginTop: 0 }}>
          Submitted from the public /support form. No email provider is connected: reply to the submitter out of band.
        </p>
        {error && (
          <div role="alert" style={{ color: "#fca5a5", fontSize: 13, marginBottom: 8 }}>
            {error}
          </div>
        )}
        {!tickets ? (
          <div style={ui.muted}>Loading…</div>
        ) : tickets.length === 0 ? (
          <div style={ui.muted}>No tickets.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Status", "Subject", "From", "Priority", "Created"].map((h) => (
                  <th key={h} style={ui.head}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => open(t.id)}
                  style={{ cursor: "pointer", background: selected?.id === t.id ? "rgba(37,99,235,0.12)" : undefined }}
                >
                  <td style={ui.cell}>
                    <span style={badgeStyle(t.status)}>{humanize(t.status)}</span>
                  </td>
                  <td style={ui.cell}>
                    <div style={{ fontWeight: 600 }}>{t.subject || "(no subject)"}</div>
                    <div style={ui.muted}>
                      {humanize(t.category)}
                      {t.assignee ? ` · ${t.assignee}` : ""}
                      {t.notesCount ? ` · ${t.notesCount} note(s)` : ""}
                    </div>
                  </td>
                  <td style={ui.cell}>{t.submitter.email || (t.submitter.uid ? t.submitter.uid : "anonymous")}</td>
                  <td style={ui.cell}>{humanize(t.priority)}</td>
                  <td style={{ ...ui.cell, ...ui.muted }} title={formatDateTime(t.createdAtMs)}>
                    {formatAgo(t.createdAtMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {nextCursor && (
          <button type="button" style={{ ...ui.ghostButton, marginTop: 12 }} onClick={() => load(nextCursor)}>
            Load more
          </button>
        )}
      </div>

      {selected && (
        <div style={ui.card} aria-label="Ticket detail">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <h3 style={{ margin: "0 0 4px" }}>{selected.subject || "(no subject)"}</h3>
              <div style={ui.muted}>
                {selected.id} · {humanize(selected.category)} · {humanize(selected.priority)} priority · {formatDateTime(selected.createdAtMs)}
              </div>
            </div>
            <button type="button" style={ui.ghostButton} onClick={() => setSelected(null)} aria-label="Close ticket">
              ×
            </button>
          </div>

          <div style={{ margin: "12px 0", fontSize: 13 }}>
            From: {selected.submitter.email || "unknown"} ({selected.submitter.auth || "?"})
            {selected.submitter.uid && props.onOpenUser ? (
              <button
                type="button"
                style={{ ...ui.ghostButton, marginLeft: 8, padding: "2px 8px" }}
                onClick={() => props.onOpenUser?.(String(selected.submitter.uid))}
              >
                Open user
              </button>
            ) : null}
          </div>
          <div style={{ whiteSpace: "pre-wrap", background: "rgba(2,6,23,0.6)", padding: 12, borderRadius: 8, fontSize: 13 }}>
            {selected.message}
          </div>
          {selected.meta.pageUrl ? <div style={{ ...ui.muted, marginTop: 6 }}>Page: {selected.meta.pageUrl}</div> : null}

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "16px 0" }}>
            <span style={badgeStyle(selected.status)}>{humanize(selected.status)}</span>
            {selected.allowedNext.map((s) => (
              <button
                key={s}
                type="button"
                style={s === "closed" ? ui.ghostButton : ui.button}
                disabled={busy}
                onClick={() => patch({ status: s }, `Ticket marked ${humanize(s).toLowerCase()}`)}
              >
                {s === "open" ? "Reopen" : `Mark ${humanize(s).toLowerCase()}`}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <label style={ui.muted} htmlFor="ticket-assignee">
              Assignee
            </label>
            <input
              id="ticket-assignee"
              style={{ ...ui.input, flex: 1 }}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="name or email"
            />
            <button
              type="button"
              style={ui.ghostButton}
              disabled={busy || assignee.trim() === (selected.assignee || "")}
              onClick={() => patch({ assignee: assignee.trim() || null }, "Assignee updated")}
            >
              Save
            </button>
          </div>

          <label style={ui.muted} htmlFor="ticket-note">
            Internal note (admins only, not sent to the user)
          </label>
          <textarea
            id="ticket-note"
            style={{ ...ui.input, width: "100%", minHeight: 70, marginTop: 4, boxSizing: "border-box" }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            style={{ ...ui.button, marginTop: 6 }}
            disabled={busy || !note.trim()}
            onClick={() => patch({ internalNote: note }, "Note added")}
          >
            Add note
          </button>

          {selected.internalNotes.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Notes</div>
              {selected.internalNotes
                .slice()
                .reverse()
                .map((n, i) => (
                  <div key={`${n.at}-${i}`} style={{ borderLeft: "2px solid #374151", paddingLeft: 8, marginBottom: 8 }}>
                    <div style={ui.muted}>
                      {n.byEmail || n.by} · {formatDateTime(n.at)}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{n.text}</div>
                  </div>
                ))}
            </div>
          )}
          {selected.history.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>History</div>
              {selected.history
                .slice()
                .reverse()
                .map((h, i) => (
                  <div key={`${h.at}-${i}`} style={{ ...ui.muted, marginBottom: 4 }}>
                    {formatDateTime(h.at)} · {h.action === "status" ? `${humanize(h.from || "")} → ${humanize(h.to || "")}` : h.action === "assignee" ? `assignee → ${h.to || "none"}` : "note added"}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
