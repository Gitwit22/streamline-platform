import { useEffect, useMemo, useState } from "react";
import { useEduMe } from "../layout/EduProtectedRoute";
import { apiFetchAuth } from "../../lib/api";
import { editingApi, type Recording as ArchiveRecording } from "../../lib/editingApi";

/* ── Types ─────────────────────────────────────────────────────── */

type StatusFilter = "all" | "ready" | "processing" | "failed" | "archived";
type DateFilter = "all" | "7d" | "30d" | "90d";
type ToastMsg = { text: string; type: "info" | "error" } | null;

type LibraryItem = {
  id: string;
  title: string;
  duration: string;
  durationSec: number;
  date: string;
  status: "ready" | "processing" | "failed";
  roomId: string;
  roomName?: string;
  archived: boolean;
  /** Original archive Recording when available (for play/download/delete) */
  _raw?: ArchiveRecording;
};

/* ── Helpers ────────────────────────────────────────────────────── */

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
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

function formatDuration(sec: number) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

function normalizeStatus(raw: unknown): "ready" | "processing" | "failed" {
  const s = String(raw || "").toLowerCase();
  if (s === "ready") return "ready";
  if (s === "failed") return "failed";
  return "processing";
}

/* ── Component ─────────────────────────────────────────────────── */

export default function MediaLibrary() {
  const me = useEduMe();
  const role = String(me?.orgRole || me?.role || "faculty_admin");
  const isFacultyAdmin = role === "faculty_admin";

  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");

  /* ── Load data ─────────────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Fetch both the EDU recordings API and the editing API (archive)
        const [eduRes, archiveRecs] = await Promise.all([
          apiFetchAuth("/api/edu/recordings?limit=100")
            .then((r) => (r.ok ? r.json() : { recordings: [] }))
            .catch(() => ({ recordings: [] })),
          editingApi.getRecordings().catch(() => [] as ArchiveRecording[]),
        ]);

        if (cancelled) return;

        const eduItems: LibraryItem[] = (eduRes.recordings || []).map((r: any) => ({
          id: r.id,
          title: r.title || "",
          duration: r.duration || formatDuration(r.durationSec || 0),
          durationSec: r.durationSec || 0,
          date: r.date || "",
          status: normalizeStatus(r.status),
          roomId: r.roomId || "",
          archived: false,
        }));

        const archiveItems: LibraryItem[] = (Array.isArray(archiveRecs) ? archiveRecs : []).map(
          (r: ArchiveRecording) => ({
            id: r.id,
            title: r.title || "Untitled",
            duration: formatDuration(r.duration || 0),
            durationSec: r.duration || 0,
            date: r.createdAt || "",
            status: normalizeStatus(r.status),
            roomId: r.roomId || "",
            roomName: r.roomName || "",
            archived: true,
            _raw: r,
          }),
        );

        // De-duplicate by id (prefer EDU record when both exist)
        const seen = new Set<string>();
        const merged: LibraryItem[] = [];
        for (const item of [...eduItems, ...archiveItems]) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          merged.push(item);
        }

        // Sort newest first
        merged.sort(
          (a, b) =>
            new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
        );

        setItems(merged);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load media");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* ── Filtering ─────────────────────────────────────────────── */

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const minTs =
      dateFilter === "7d"
        ? now - 7 * 86400_000
        : dateFilter === "30d"
          ? now - 30 * 86400_000
          : dateFilter === "90d"
            ? now - 90 * 86400_000
            : null;

    return items.filter((r) => {
      // Status filter
      if (statusFilter === "archived" && !r.archived) return false;
      if (statusFilter !== "all" && statusFilter !== "archived" && r.status !== statusFilter) return false;

      // Search
      if (q && !r.title.toLowerCase().includes(q) && !(r.roomName || "").toLowerCase().includes(q)) return false;

      // Date filter
      if (minTs != null) {
        const ts = new Date(r.date || 0).getTime();
        if (!Number.isFinite(ts) || ts < minTs) return false;
      }

      return true;
    });
  }, [items, search, statusFilter, dateFilter]);

  /* ── Stats ─────────────────────────────────────────────────── */

  const stats = useMemo(() => {
    const total = items.length;
    const ready = items.filter((r) => r.status === "ready").length;
    const processing = items.filter((r) => r.status === "processing").length;
    const archived = items.filter((r) => r.archived).length;
    const failed = items.filter((r) => r.status === "failed").length;
    return { total, ready, processing, archived, failed };
  }, [items]);

  /* ── Actions ───────────────────────────────────────────────── */

  /* ── Inline toast ──────────────────────────────────────────── */
  const [toast, setToast] = useState<ToastMsg>(null);
  const showToast = (text: string, type: "info" | "error" = "info") => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handlePlay = (item: LibraryItem) => {
    if (item.status !== "ready") return;
    const url = (item._raw as any)?.videoUrl || (item._raw as any)?.url;
    if (url) window.open(String(url), "_blank", "noopener,noreferrer");
  };

  const handleDelete = async (item: LibraryItem) => {
    if (!isFacultyAdmin) return;
    const ok = window.confirm("Delete this recording? This cannot be undone.");
    if (!ok) return;
    try {
      if (item._raw) {
        await editingApi.deleteRecording(item.id);
      }
      setItems((cur) => cur.filter((x) => x.id !== item.id));
    } catch (e: any) {
      showToast(`Delete failed: ${String(e?.message || e)}`, "error");
    }
  };

  /* ── Render ────────────────────────────────────────────────── */

  const filterButtons: { key: StatusFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: stats.total },
    { key: "ready", label: "Ready", count: stats.ready },
    { key: "processing", label: "Processing", count: stats.processing },
    { key: "archived", label: "Archived", count: stats.archived },
    { key: "failed", label: "Failed", count: stats.failed },
  ];

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 animate-pulse rounded bg-slate-800" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-800/50" />
        ))}
      </div>
    );
  }

  return (
    <div className="relative space-y-6">
      {/* Inline toast */}
      {toast && (
        <div
          className={`fixed right-6 top-6 z-50 flex items-center gap-3 rounded-xl border px-5 py-3 text-sm font-medium shadow-lg transition-all ${
            toast.type === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-200"
              : "border-orange-500/30 bg-orange-500/10 text-orange-200"
          }`}
        >
          {toast.type === "error" ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 flex-none">
              <circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 flex-none">
              <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
            </svg>
          )}
          {toast.text}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Media Library</h1>
          <p className="mt-1 text-sm text-slate-400">
            All broadcasts, recordings, and archived media in one place.
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or room..."
            className="rounded-xl border border-slate-700 bg-slate-800/50 py-2.5 pl-10 pr-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status filter pills */}
        <div className="flex items-center gap-1.5">
          {filterButtons.map((fb) => (
            <button
              key={fb.key}
              onClick={() => setStatusFilter(fb.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                statusFilter === fb.key
                  ? "border border-orange-500/30 bg-orange-500/15 text-orange-300"
                  : "border border-slate-700 text-slate-400 hover:text-white"
              }`}
            >
              {fb.label}
              <span className="ml-1.5 opacity-60">{fb.count}</span>
            </button>
          ))}
        </div>

        {/* Date filter */}
        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value as DateFilter)}
          className="ml-auto rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-orange-500/40"
        >
          <option value="all">All time</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>

      {/* Item list */}
      <div className="space-y-3">
        {filtered.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between rounded-xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-5 transition hover:border-slate-600"
          >
            <div className="flex items-center gap-4">
              {/* Play icon */}
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10 text-orange-300">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
                </svg>
              </div>

              {/* Info */}
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">{item.title}</span>
                  {item.archived && (
                    <span className="rounded-full border border-slate-600/40 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-400">
                      Archived
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-3 text-sm text-slate-400">
                  <span>{item.duration}</span>
                  <span className="text-slate-600">•</span>
                  <span>{formatDate(item.date)}</span>
                  {item.roomName && (
                    <>
                      <span className="text-slate-600">•</span>
                      <span>{item.roomName}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right side: status + actions */}
            <div className="flex items-center gap-3">
              {/* Status badge */}
              {item.status === "ready" ? (
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-300">
                  Ready
                </span>
              ) : item.status === "processing" ? (
                <span className="rounded-full border border-amber-500/20 bg-amber-500/15 px-2.5 py-0.5 text-xs text-amber-300">
                  Processing
                </span>
              ) : (
                <span className="rounded-full border border-red-500/20 bg-red-500/15 px-2.5 py-0.5 text-xs text-red-300">
                  Failed
                </span>
              )}

              {/* Play */}
              <button
                onClick={() => handlePlay(item)}
                disabled={item.status !== "ready"}
                className={`rounded-lg px-3 py-1.5 text-xs transition ${
                  item.status === "ready"
                    ? "bg-slate-700/60 text-slate-300 hover:bg-slate-700 hover:text-white"
                    : "cursor-not-allowed bg-slate-800/30 text-slate-600"
                }`}
              >
                Play
              </button>

              {/* Delete (admin only) */}
              {isFacultyAdmin && (
                <button
                  onClick={() => void handleDelete(item)}
                  className="rounded-lg px-3 py-1.5 text-xs text-red-400/60 transition hover:bg-red-500/10 hover:text-red-300"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="rounded-2xl border border-slate-700 bg-slate-800/50 p-12 text-center">
            <div className="text-4xl">🎬</div>
            <div className="mt-3 text-lg font-semibold text-slate-300">
              {search || statusFilter !== "all"
                ? "No recordings match your filters"
                : "No recordings yet"}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              Recordings are created automatically when broadcasts end.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
