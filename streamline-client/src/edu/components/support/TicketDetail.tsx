import { useEffect, useState, useCallback } from "react";
import { useEduMe } from "../../layout/EduProtectedRoute";
import {
  getTicket,
  addTicketMessage,
  closeTicket,
  type EduSupportTicket,
  type EduSupportTicketMessage,
} from "../../api/tickets";

/* ── Helpers ───────────────────────────────────────────────────── */

function formatDate(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLabel(val: string) {
  return val.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    open: "bg-green-500/20 text-green-400 border-green-500/30",
    in_progress: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    waiting_on_user: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    resolved: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    closed: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };
  return map[status] || map.open;
}

function priorityBadge(priority: string) {
  const map: Record<string, string> = {
    low: "bg-slate-500/20 text-slate-300 border-slate-500/30",
    medium: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    urgent: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return map[priority] || map.low;
}

function msgTypeBadge(type: string) {
  if (type === "internal_note") return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  if (type === "status_change") return "bg-indigo-500/20 text-indigo-400 border-indigo-500/30";
  return "";
}

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/* ── Component ─────────────────────────────────────────────────── */

interface Props {
  ticketId: string;
  onBack: () => void;
}

export default function TicketDetail({ ticketId, onBack }: Props) {
  const me = useEduMe();
  const [ticket, setTicket] = useState<EduSupportTicket | null>(null);
  const [messages, setMessages] = useState<EduSupportTicketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Reply
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  // Close
  const [showClose, setShowClose] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getTicket(ticketId);
      setTicket(data.ticket);
      setMessages(data.messages);
    } catch {
      setError("Failed to load ticket");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      await addTicketMessage(ticketId, { type: "reply", message: reply.trim() });
      setReply("");
      await load();
    } catch {
      setError("Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  async function handleClose() {
    setClosing(true);
    try {
      await closeTicket(ticketId, closeNote.trim() || undefined);
      setShowClose(false);
      setCloseNote("");
      await load();
    } catch {
      setError("Failed to close ticket");
    } finally {
      setClosing(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl py-12 text-center text-sm text-slate-500">
        Loading ticket…
      </div>
    );
  }

  if (error && !ticket) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <button onClick={onBack} className="text-sm text-slate-400 hover:text-white transition-colors">
          ← Back to tickets
        </button>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      </div>
    );
  }

  if (!ticket) return null;

  const isClosed = ticket.status === "closed";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Back button */}
      <button onClick={onBack} className="text-sm text-slate-400 hover:text-white transition-colors">
        ← Back to tickets
      </button>

      {/* Ticket header */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-white">{ticket.title}</h1>
            <p className="mt-1 text-sm text-slate-400">
              Opened by <span className="text-slate-300">{ticket.createdByName}</span>
              {" · "}
              {formatDate(ticket.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-block rounded-full border px-3 py-1 text-xs font-medium ${statusBadge(ticket.status)}`}>
              {formatLabel(ticket.status)}
            </span>
            <span className={`inline-block rounded-full border px-3 py-1 text-xs font-medium ${priorityBadge(ticket.priority)}`}>
              {formatLabel(ticket.priority)}
            </span>
          </div>
        </div>

        {/* Meta row */}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
          <span>Category: <span className="text-slate-300">{formatLabel(ticket.category)}</span></span>
          {ticket.assignedToName && (
            <span>Assigned to: <span className="text-slate-300">{ticket.assignedToName}</span></span>
          )}
          {ticket.tags.length > 0 && (
            <span>Tags: <span className="text-slate-300">{ticket.tags.join(", ")}</span></span>
          )}
          {ticket.closedAt && (
            <span>Closed: <span className="text-slate-300">{formatDate(ticket.closedAt)}</span></span>
          )}
        </div>

        {/* Description */}
        <div className="mt-4 rounded-lg border border-slate-700/40 bg-slate-900/50 p-4">
          <p className="whitespace-pre-wrap text-sm text-slate-300">{ticket.description}</p>
        </div>
      </div>

      {/* Conversation thread */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
          Conversation ({messages.length})
        </h3>

        {messages.length === 0 && (
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 py-8 text-center text-sm text-slate-500">
            No messages yet. Add a reply below.
          </div>
        )}

        {messages.map((msg) => {
          const isMe = msg.authorUserId === me?.uid;
          const isSystem = msg.type === "status_change";
          const isNote = msg.type === "internal_note";
          return (
            <div
              key={msg.id}
              className={`rounded-xl border p-4 ${
                isNote
                  ? "border-amber-500/20 bg-amber-500/5"
                  : isSystem
                    ? "border-indigo-500/20 bg-indigo-500/5"
                    : "border-slate-700/50 bg-slate-800/30"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-white">
                  {initials(msg.authorName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${isMe ? "text-orange-400" : "text-white"}`}>
                      {msg.authorName}
                    </span>
                    <span className="text-xs text-slate-500">{formatLabel(msg.authorRole)}</span>
                    {(isNote || isSystem) && (
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${msgTypeBadge(msg.type)}`}>
                        {isNote ? "Internal Note" : "Status Change"}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-500">{formatDate(msg.createdAt)}</span>
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap pl-11 text-sm text-slate-300">{msg.message}</p>
            </div>
          );
        })}
      </div>

      {/* Reply box */}
      {!isClosed && (
        <form onSubmit={handleReply} className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write a reply…"
            rows={3}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-orange-500/50 focus:outline-none"
          />
          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowClose(true)}
              className="text-sm text-slate-400 hover:text-red-400 transition-colors"
            >
              Close Ticket
            </button>
            <button
              type="submit"
              disabled={!reply.trim() || sending}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send Reply"}
            </button>
          </div>
        </form>
      )}

      {isClosed && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4 text-center text-sm text-slate-500">
          This ticket is closed.
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Close ticket modal */}
      {showClose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white">Close Ticket</h2>
            <p className="mb-4 text-sm text-slate-400">
              Add an optional resolution note before closing.
            </p>
            <textarea
              value={closeNote}
              onChange={(e) => setCloseNote(e.target.value)}
              placeholder="Resolution note (optional)…"
              rows={3}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-orange-500/50 focus:outline-none"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowClose(false)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleClose}
                disabled={closing}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {closing ? "Closing…" : "Close Ticket"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
