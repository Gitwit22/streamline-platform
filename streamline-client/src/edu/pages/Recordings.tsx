import { useEffect, useMemo, useState } from "react";
import { useEduMe } from "../layout/EduProtectedRoute";
import { isEduBypassEnabled } from "../state/eduMode";
import { DEMO_RECORDINGS, type DemoRecording } from "../state/demoData";
import { apiFetchAuth } from "../../lib/api";

/* ── Types ─────────────────────────────────────────────────────── */

type Recording = {
  id: string;
  title: string;
  duration: string;
  durationSec: number;
  date: string;
  status: "ready" | "processing" | "failed";
  roomId: string;
};

/* ── Helpers ────────────────────────────────────────────────────── */

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ── Component ─────────────────────────────────────────────────── */

export default function Recordings() {
  const me = useEduMe();
  const isDemo = isEduBypassEnabled();

  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (isDemo) {
      setRecordings(
        DEMO_RECORDINGS.map((r) => ({
          ...r,
          status: r.status as "ready" | "processing" | "failed",
        })),
      );
      setLoading(false);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        const res = await apiFetchAuth("/api/edu/recordings?limit=100");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (mounted) setRecordings(data.recordings || []);
      } catch (e: any) {
        if (mounted) setError(e?.message || "Failed to load recordings");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [isDemo]);

  const filtered = useMemo(() => {
    if (!search.trim()) return recordings;
    const q = search.toLowerCase();
    return recordings.filter((r) => r.title.toLowerCase().includes(q));
  }, [recordings, search]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-800" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-800/50" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Recordings</h1>
          <p className="mt-1 text-sm text-slate-400">
            {recordings.length} recording{recordings.length !== 1 ? "s" : ""} in your library
          </p>
        </div>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recordings..."
            className="rounded-xl border border-slate-700 bg-slate-800/50 py-2.5 pl-10 pr-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
      )}

      {/* Recording List */}
      <div className="space-y-3">
        {filtered.map((rec) => (
          <div
            key={rec.id}
            className="flex items-center justify-between rounded-xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-5 transition hover:border-slate-600"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10 text-orange-300">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
                </svg>
              </div>
              <div>
                <div className="font-semibold text-white">{rec.title}</div>
                <div className="mt-1 flex items-center gap-3 text-sm text-slate-400">
                  <span>{rec.duration}</span>
                  <span className="text-slate-600">•</span>
                  <span>{formatDate(rec.date)}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {rec.status === "ready" ? (
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-300">
                  Ready
                </span>
              ) : rec.status === "processing" ? (
                <span className="rounded-full border border-amber-500/20 bg-amber-500/15 px-2.5 py-0.5 text-xs text-amber-300">
                  Processing
                </span>
              ) : (
                <span className="rounded-full border border-red-500/20 bg-red-500/15 px-2.5 py-0.5 text-xs text-red-300">
                  Failed
                </span>
              )}
              <button className="rounded-lg bg-slate-700/60 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-700 hover:text-white">
                Play
              </button>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="rounded-2xl border border-slate-700 bg-slate-800/50 p-12 text-center">
            <div className="text-4xl">🎬</div>
            <div className="mt-3 text-lg font-semibold text-slate-300">
              {search ? "No recordings match your search" : "No recordings yet"}
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
