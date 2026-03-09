import { useEffect, useState, useCallback } from "react";
import { listTickets, type EduSupportTicket } from "../../api/tickets";

/* ── Helpers ───────────────────────────────────────────────────── */

function timeAgo(ms: number | null) {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    open: "text-green-400",
    in_progress: "text-blue-400",
    waiting_on_user: "text-yellow-400",
    resolved: "text-purple-400",
    closed: "text-slate-400",
  };
  return map[status] || "text-slate-400";
}

function formatLabel(val: string) {
  return val.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Heuristic: ticket was updated after creation → likely has responses */
function hasActivity(t: EduSupportTicket) {
  if (!t.updatedAt || !t.createdAt) return false;
  return t.updatedAt - t.createdAt > 30_000; // > 30s difference = activity
}

/* ── Component ─────────────────────────────────────────────────── */

interface Props {
  onSelectTicket: (t: EduSupportTicket) => void;
  refreshKey: number;
}

export default function ResponsesTab({ onSelectTicket, refreshKey }: Props) {
  const [tickets, setTickets] = useState<EduSupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listTickets();
      // Sort by most recently updated first; only show tickets with activity
      const sorted = data.tickets
        .filter((t) => hasActivity(t) || t.status !== "open")
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      setTickets(sorted);
    } catch {
      setError("Failed to load responses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white">Responses &amp; Activity</h2>
        <p className="text-sm text-slate-400">
          View replies and updates on your support tickets.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading && (
        <div className="py-12 text-center text-sm text-slate-500">Loading activity…</div>
      )}

      {!loading && !error && tickets.length === 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 py-16 text-center">
          <p className="text-slate-400">No responses yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Responses to your tickets and reports will appear here.
          </p>
        </div>
      )}

      {!loading && tickets.length > 0 && (
        <div className="space-y-2">
          {tickets.map((t) => {
            const isRecent = t.updatedAt && Date.now() - t.updatedAt < 86_400_000; // < 24h
            return (
              <button
                type="button"
                key={t.id}
                onClick={() => onSelectTicket(t)}
                className="w-full rounded-xl border border-slate-700/50 bg-slate-800/30 p-4 text-left transition-colors hover:border-slate-600 hover:bg-slate-800/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-white">{t.title}</span>
                      {isRecent && (
                        <span className="shrink-0 rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-400 border border-orange-500/30">
                          Updated
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-400">
                      {t.description.slice(0, 120)}
                      {t.description.length > 120 ? "…" : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`text-xs font-medium ${statusColor(t.status)}`}>
                      {formatLabel(t.status)}
                    </span>
                    <div className="mt-1 text-xs text-slate-500">{timeAgo(t.updatedAt)}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
