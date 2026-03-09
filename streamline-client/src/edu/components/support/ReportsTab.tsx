import { useState } from "react";
import {
  createTicket,
  type TicketCategory,
  type TicketPriority,
} from "../../api/tickets";

/* ── Report-type → ticket mapping ──────────────────────────────── */

const REPORT_TYPES: {
  value: string;
  label: string;
  category: TicketCategory;
}[] = [
  { value: "classroom_issue", label: "Classroom Issue", category: "student_issue" },
  { value: "technical_issue", label: "Technical Issue", category: "technical" },
  { value: "event_problem", label: "Event Problem", category: "event_issue" },
  { value: "inappropriate_behavior", label: "Inappropriate Behavior", category: "student_issue" },
  { value: "room_access_issue", label: "Room Access Issue", category: "room_access" },
  { value: "livestream_issue", label: "Livestream / Broadcast Issue", category: "broadcast" },
  { value: "account_issue", label: "Account Issue", category: "account" },
  { value: "other", label: "Other", category: "other" },
];

const SEVERITY_MAP: Record<string, TicketPriority> = {
  low: "low",
  medium: "medium",
  high: "high",
  critical: "urgent",
};

/* ── Component ─────────────────────────────────────────────────── */

interface Props {
  onRefresh: () => void;
}

export default function ReportsTab({ onRefresh }: Props) {
  const [reportType, setReportType] = useState(REPORT_TYPES[0].value);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [relatedRoom, setRelatedRoom] = useState("");
  const [severity, setSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  function reset() {
    setTitle("");
    setDetails("");
    setRelatedRoom("");
    setSeverity("medium");
    setReportType(REPORT_TYPES[0].value);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!details.trim()) {
      setError("Details are required.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess(false);

    const rt = REPORT_TYPES.find((r) => r.value === reportType) || REPORT_TYPES[0];

    // Build enriched description
    let desc = `Report Type: ${rt.label}`;
    if (relatedRoom.trim()) desc += `\nRelated Room/Event: ${relatedRoom.trim()}`;
    desc += `\n\n${details.trim()}`;

    try {
      await createTicket({
        title: title.trim(),
        description: desc,
        category: rt.category,
        priority: SEVERITY_MAP[severity] || "medium",
        tags: ["report", reportType, ...(relatedRoom.trim() ? [relatedRoom.trim().toLowerCase().replace(/\s+/g, "_")] : [])],
      });
      setSuccess(true);
      reset();
      onRefresh();
    } catch (err: any) {
      setError(err?.message || "Failed to submit report");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6">
        <h2 className="text-lg font-bold text-white">Submit a Report</h2>
        <p className="mb-5 text-sm text-slate-400">
          File a formal report about a classroom issue, technical problem, or other concern.
          Reports are reviewed by school administrators and support staff.
        </p>

        {success && (
          <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-400">
            Report submitted successfully! You can track it in the Tickets tab.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Report Type</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-orange-500/50 focus:outline-none"
            >
              {REPORT_TYPES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief summary of the report"
              maxLength={200}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-orange-500/50 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Details *</label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Describe the issue in detail…"
              rows={5}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-orange-500/50 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Related Room / Event</label>
              <input
                type="text"
                value={relatedRoom}
                onChange={(e) => setRelatedRoom(e.target.value)}
                placeholder="e.g. Algebra II"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-orange-500/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as any)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-orange-500/50 focus:outline-none"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
            >
              {submitting ? "Submitting Report…" : "Submit Report"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
