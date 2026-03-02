import { useEffect, useMemo, useState } from "react";
import { apiFetchAuth } from "../../lib/api";
import { editingApi, type Recording } from "../../lib/editingApi";
import { useEduMe } from "../layout/EduProtectedRoute";

type ArchiveMeta = {
  title?: string;
  notes?: string;
};

const ARCHIVE_META_KEY = "sl_edu_archive_meta_v1";

function readMeta(): Record<string, ArchiveMeta> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ARCHIVE_META_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, ArchiveMeta>;
  } catch {
    return {};
  }
}

function writeMeta(next: Record<string, ArchiveMeta>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ARCHIVE_META_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatDuration(secondsRaw: number) {
  const s = Math.max(0, Math.floor(Number(secondsRaw) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function normalizeStatus(statusRaw: unknown): "processing" | "ready" | "failed" {
  const s = String(statusRaw || "").toLowerCase();
  if (s === "ready") return "ready";
  if (s === "failed") return "failed";
  return "processing";
}

function typeLabel(usageType: Recording["usageType"]) {
  if (usageType === "live") return "Live";
  if (usageType === "recording_only") return "Recording";
  if (usageType === "live+recording") return "Live + Recording";
  return "Recording";
}

function TypeChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-700/40 bg-slate-900/60 px-2 py-0.5 text-xs text-slate-200">
      {label}
    </span>
  );
}

function StatusChip({ status }: { status: "processing" | "ready" | "failed" }) {
  const cls =
    status === "ready"
      ? "border-emerald-500/20 bg-emerald-500/15 text-emerald-200"
      : status === "failed"
        ? "border-red-500/20 bg-red-500/15 text-red-200"
        : "border-amber-500/20 bg-amber-500/15 text-amber-200";
  const label = status === "ready" ? "Ready" : status === "failed" ? "Failed" : "Processing";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>{label}</span>
  );
}

function DotsMenu({
  disabled,
  onRename,
  onNotes,
  onDelete,
}: {
  disabled?: boolean;
  onRename: () => void;
  onNotes: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Close when clicking outside the menu.
      const el = target.closest("[data-dots-menu]");
      if (!el) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative" data-dots-menu>
      <button
        type="button"
        disabled={!!disabled}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border text-sm transition-colors ${
          disabled
            ? "cursor-not-allowed border-slate-800/50 bg-slate-900/30 text-slate-500"
            : "border-slate-800/50 bg-slate-900/50 text-slate-200 hover:border-slate-700 hover:bg-slate-800/60"
        }`}
        aria-label="More"
      >
        ⋯
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-xl border border-slate-800/70 bg-slate-950/95 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onRename();
            }}
            className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-900/60"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onNotes();
            }}
            className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-900/60"
          >
            Notes
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="w-full px-3 py-2 text-left text-sm text-red-200 hover:bg-red-500/10"
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function Archive() {
  const me = useEduMe();
  const roleRaw = String(me?.orgRole || me?.role || "viewer");

  const isFacultyAdmin = roleRaw === "faculty_admin";
  const isStudentProducer = roleRaw === "student_producer" || roleRaw === "student_producer_assigned";
  const isTalent = roleRaw === "talent";
  const isViewer = roleRaw === "viewer";

  const canSeePage = isFacultyAdmin || isStudentProducer;
  const canDownload = isFacultyAdmin; // prevent leaks by default

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<Recording[]>([]);
  const [meta, setMeta] = useState<Record<string, ArchiveMeta>>(() => readMeta());

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ready" | "processing" | "failed">("all");
  const [typeFilter, setTypeFilter] = useState<
    "all" | "live" | "recording_only" | "live+recording"
  >("all");
  const [dateFilter, setDateFilter] = useState<"all" | "7d" | "30d" | "90d">("30d");

  useEffect(() => {
    setMeta(readMeta());
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const recs = await editingApi.getRecordings();
        if (cancelled) return;
        setItems(Array.isArray(recs) ? recs : []);
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        setItems([]);
        setLoading(false);
        setLoadError(String(e?.message || "Failed to load recordings"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const minTs =
      dateFilter === "7d"
        ? now - 7 * 24 * 60 * 60 * 1000
        : dateFilter === "30d"
          ? now - 30 * 24 * 60 * 60 * 1000
          : dateFilter === "90d"
            ? now - 90 * 24 * 60 * 60 * 1000
            : null;

    return (items || [])
      .slice()
      .sort((a, b) => {
        const at = new Date(a.createdAt || 0).getTime();
        const bt = new Date(b.createdAt || 0).getTime();
        return bt - at;
      })
      .filter((r) => {
        const status = normalizeStatus(r.status);
        if (statusFilter !== "all" && status !== statusFilter) return false;
        if (typeFilter !== "all" && r.usageType !== typeFilter) return false;
        if (q) {
          const title = String(meta[r.id]?.title || r.title || "").toLowerCase();
          const roomName = String(r.roomName || "").toLowerCase();
          if (!title.includes(q) && !roomName.includes(q)) return false;
        }
        if (minTs != null) {
          const ts = new Date(r.createdAt || 0).getTime();
          if (!Number.isFinite(ts) || ts < minTs) return false;
        }
        return true;
      });
  }, [items, search, statusFilter, typeFilter, dateFilter, meta]);

  if (!me || !canSeePage || isTalent || isViewer) {
    return (
      <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6 text-slate-200">
        <div className="text-lg font-semibold text-white">No access</div>
        <div className="mt-2 text-sm text-slate-400">
          This page is only available to Faculty/Admin and approved Student Producers.
        </div>
      </div>
    );
  }

  const handlePlay = (r: Recording) => {
    const status = normalizeStatus(r.status);
    if (status !== "ready") return;
    const url = String(r.videoUrl || "").trim();
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleDownload = async (r: Recording) => {
    if (!canDownload) return;
    const status = normalizeStatus(r.status);
    if (status !== "ready") return;
    try {
      const res = await apiFetchAuth(`/api/recordings/${encodeURIComponent(r.id)}/download-link`, {}, { allowNonOk: true });
      if (res.status === 410) {
        alert("This download link expired. Generate a fresh link from the original room if needed.");
        return;
      }
      if (res.status === 402) {
        alert("Upgrade required to download this recording.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(String(body?.error || body?.message || `HTTP ${res.status}`));
      }
      const data = await res.json().catch(() => null);
      const url = data?.data?.url;
      if (!data?.success || !url) throw new Error("Invalid download link response");
      window.open(String(url), "_blank", "noopener,noreferrer");
    } catch (e: any) {
      alert(`Download failed: ${String(e?.message || e || "unknown")}`);
    }
  };

  const setMetaField = (id: string, patch: Partial<ArchiveMeta>) => {
    setMeta((cur) => {
      const next = { ...cur, [id]: { ...(cur[id] || {}), ...patch } };
      writeMeta(next);
      return next;
    });
  };

  const handleDelete = async (r: Recording) => {
    if (!isFacultyAdmin) return;
    const ok = window.confirm("Delete this recording? This cannot be undone.");
    if (!ok) return;
    try {
      await editingApi.deleteRecording(r.id);
      setItems((cur) => cur.filter((x) => x.id !== r.id));
    } catch (e: any) {
      alert(`Delete failed: ${String(e?.message || e || "unknown")}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-2xl font-semibold text-white">Archive</div>
            <div className="mt-1 text-sm text-slate-400">Find past recordings fast.</div>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title or room…"
              className="w-full rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-orange-500/60 sm:w-72"
            />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">Status</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500/60"
            >
              <option value="all">All</option>
              <option value="ready">Ready</option>
              <option value="processing">Processing</option>
              <option value="failed">Failed</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">Type</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500/60"
            >
              <option value="all">All</option>
              <option value="live">Live</option>
              <option value="recording_only">Recording</option>
              <option value="live+recording">Live + Recording</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">Date</span>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as any)}
              className="rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-500/60"
            >
              <option value="all">All time</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-0">
        {loading ? (
          <div className="p-6 text-sm text-slate-300">Loading recordings…</div>
        ) : loadError ? (
          <div className="p-6">
            <div className="text-sm font-medium text-white">Couldn’t load recordings</div>
            <div className="mt-1 text-sm text-slate-400">{loadError}</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <div className="text-sm font-medium text-white">No recordings found</div>
            <div className="mt-1 text-sm text-slate-400">Try changing filters or search.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-700/60 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Created by</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/40">
                {filtered.map((r) => {
                  const status = normalizeStatus(r.status);
                  const title = String(meta[r.id]?.title || r.title || "Untitled").trim() || "Untitled";
                  const createdBy = r.userId && me?.uid && r.userId === me.uid ? "You" : r.userId ? "User" : "You";
                  const canPlay = status === "ready";
                  const canDl = canDownload && status === "ready";

                  return (
                    <tr key={r.id} className="hover:bg-slate-900/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-slate-700/50 bg-slate-950/30">
                            {r.thumbnailUrl ? (
                              <img src={r.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-white">{title}</div>
                            <div className="mt-1 flex items-center gap-2">
                              <StatusChip status={status} />
                              {r.roomName ? (
                                <span className="truncate text-xs text-slate-400">{r.roomName}</span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <TypeChip label={typeLabel(r.usageType)} />
                      </td>
                      <td className="px-4 py-3 text-slate-200">{formatDate(r.createdAt)}</td>
                      <td className="px-4 py-3 text-slate-200">{formatDuration(r.duration)}</td>
                      <td className="px-4 py-3 text-slate-300">{createdBy}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handlePlay(r)}
                            disabled={!canPlay}
                            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                              canPlay
                                ? "border-slate-700/60 bg-slate-950/40 text-white hover:border-slate-600/70 hover:bg-slate-900/50"
                                : "cursor-not-allowed border-slate-700/50 bg-slate-900/20 text-slate-500"
                            }`}
                          >
                            Play
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDownload(r)}
                            disabled={!canDl}
                            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                              canDl
                                ? "border-orange-500/30 bg-orange-500/15 text-orange-100 hover:border-orange-400/40 hover:bg-orange-500/20"
                                : "cursor-not-allowed border-slate-700/50 bg-slate-900/20 text-slate-500"
                            }`}
                          >
                            Download
                          </button>
                          <DotsMenu
                            disabled={!isFacultyAdmin}
                            onRename={() => {
                              const next = window.prompt("Rename recording", title);
                              if (next == null) return;
                              const v = String(next).trim();
                              if (!v) return;
                              setMetaField(r.id, { title: v });
                            }}
                            onNotes={() => {
                              const current = String(meta[r.id]?.notes || "");
                              const next = window.prompt("Notes", current);
                              if (next == null) return;
                              setMetaField(r.id, { notes: String(next) });
                            }}
                            onDelete={() => void handleDelete(r)}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
