import { useEffect, useState, useCallback } from "react";
import {
  listTickets,
  createTicket,
  type EduSupportTicket,
  type TicketStatus,
  type TicketPriority,
  type TicketCategory,
} from "../../api/tickets";

/* ── Constants ─────────────────────────────────────────────────── */

const STATUS_OPTIONS: { value: TicketStatus | ""; label: string }[] = [
  { value: "", label: "All Statuses" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "waiting_on_user", label: "Waiting on User" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const PRIORITY_OPTIONS: { value: TicketPriority | ""; label: string }[] = [
  { value: "", label: "All Priorities" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const CATEGORY_OPTIONS: { value: TicketCategory | ""; label: string }[] = [
  { value: "", label: "All Categories" },
  { value: "technical", label: "Technical" },
  { value: "account", label: "Account" },
  { value: "broadcast", label: "Broadcast" },
  { value: "room_access", label: "Room Access" },
  { value: "event_issue", label: "Event Issue" },
  { value: "student_issue", label: "Student Issue" },
  { value: "other", label: "Other" },
];

/* ── Badge helpers ─────────────────────────────────────────────── */

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

function formatLabel(val: string) {
  return val.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(ms: number | null) {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/* ── Component ─────────────────────────────────────────────────── */

interface Props {
  refreshKey: number;
  onSelectTicket: (t: EduSupportTicket) => void;
  onRefresh: () => void;
}

export default function TicketsTab({ refreshKey, onSelectTicket, onRefresh }: Props) {
  const [tickets, setTickets] = useState<EduSupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");

  // Create modal
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      if (categoryFilter) params.category = categoryFilter;
      const data = await listTickets(params);
      setTickets(data.tickets);
    } catch {
      setError("Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter, categoryFilter]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Client-side search filter
  const filtered = search
    ? tickets.filter(
        (t) =>
          t.title.toLowerCase().includes(search.toLowerCase()) ||
          t.description.toLowerCase().includes(search.toLowerCase()) ||
          (t.tags || []).some((tag) => tag.toLowerCase().includes(search.toLowerCase())),
      )
    : tickets;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
        >
          + Open Ticket
        </button>

        <input
          type="text"
          placeholder="Search tickets…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-orange-500/50 focus:outline-none"
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-orange-500/50 focus:outline-none"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-orange-500/50 focus:outline-none"
        >
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-orange-500/50 focus:outline-none"
        >
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="py-12 text-center text-sm text-slate-500">Loading tickets…</div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 py-16 text-center">
          <p className="text-slate-400">No tickets found</p>
          <p className="mt-1 text-sm text-slate-500">
            {search || statusFilter || priorityFilter || categoryFilter
              ? "Try adjusting your filters."
              : "Click \"Open Ticket\" to create one."}
          </p>
        </div>
      )}

      {/* Ticket list */}
      {!loading && filtered.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-700/50">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-700/50 bg-slate-800/60">
              <tr>
                <th className="px-4 py-3 font-medium text-slate-400">Title</th>
                <th className="px-4 py-3 font-medium text-slate-400">Category</th>
                <th className="px-4 py-3 font-medium text-slate-400">Priority</th>
                <th className="px-4 py-3 font-medium text-slate-400">Status</th>
                <th className="px-4 py-3 font-medium text-slate-400">Created</th>
                <th className="px-4 py-3 font-medium text-slate-400">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {filtered.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => onSelectTicket(t)}
                  className="cursor-pointer transition-colors hover:bg-slate-800/40"
                >
                  <td className="max-w-xs truncate px-4 py-3 font-medium text-white">
                    {t.title}
                    {t.tags?.length > 0 && (
                      <span className="ml-2 text-xs text-slate-500">
                        {t.tags.slice(0, 2).map((tag) => `#${tag}`).join(" ")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{formatLabel(t.category)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${priorityBadge(t.priority)}`}>
                      {formatLabel(t.priority)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadge(t.status)}`}>
                      {formatLabel(t.status)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">{timeAgo(t.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">{timeAgo(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create ticket modal */}
      {showCreate && (
        <CreateTicketModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}

/* ── Create Ticket Modal ───────────────────────────────────────── */

function CreateTicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TicketCategory>("technical");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError("Title and description are required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await createTicket({
        title: title.trim(),
        description: description.trim(),
        category,
        priority,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      onCreated();
    } catch (err: any) {
      setError(err?.message || "Failed to create ticket");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
      >
        <h2 className="text-lg font-bold text-white">Open a Support Ticket</h2>
        <p className="mb-4 text-sm text-slate-400">Describe your issue and we'll look into it.</p>

        {error && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of the issue"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-orange-500/50 focus:outline-none"
              maxLength={200}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed explanation of the issue…"
              rows={4}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-orange-500/50 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as TicketCategory)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-orange-500/50 focus:outline-none"
              >
                {CATEGORY_OPTIONS.filter((o) => o.value).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-orange-500/50 focus:outline-none"
              >
                {PRIORITY_OPTIONS.filter((o) => o.value).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Tags (comma-separated)</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. grade10, algebra, broadcast"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-orange-500/50 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit Ticket"}
          </button>
        </div>
      </form>
    </div>
  );
}
