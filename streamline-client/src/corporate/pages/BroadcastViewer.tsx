import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Radio, Users, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { watchBroadcast, type WatchResponse } from "../api/broadcasts";
import { HlsPlayer } from "@/pages/HlsPlayes";
import { useCorporateMe } from "../layout/CorporateProtectedRoute";
import { isCorporateBypassEnabled } from "../state/corporateMode";

/**
 * BroadcastViewer — the viewer page for a live corporate broadcast.
 *
 * Polls the watch endpoint, shows the HLS player when live,
 * and a waiting room when the stream hasn't started yet.
 */
export default function BroadcastViewer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const bypass = isCorporateBypassEnabled();

  const [watch, setWatch] = useState<WatchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      if (bypass) {
        setWatch({
          id,
          title: "Q1 All-Hands Town Hall",
          team: "Executive Team",
          status: "live",
          playlistUrl: null, // No real HLS in bypass
          viewerCount: 847,
          startedAt: Date.now() - 18 * 60_000,
        });
      } else {
        const data = await watchBroadcast(id);
        setWatch(data);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load broadcast");
    } finally {
      setLoading(false);
    }
  }, [id, bypass]);

  // Initial load
  useEffect(() => { load(); }, [load]);

  // Poll for updates every 8 seconds
  useEffect(() => {
    if (!id) return;
    const interval = setInterval(async () => {
      try {
        if (bypass) {
          setWatch(prev => prev ? { ...prev, viewerCount: 847 + Math.floor(Math.random() * 30) } : prev);
        } else {
          const data = await watchBroadcast(id);
          setWatch(data);
        }
      } catch {}
    }, 8_000);
    return () => clearInterval(interval);
  }, [id, bypass]);

  const isLive = watch?.status === "live";
  const elapsed = watch?.startedAt ? Math.floor((Date.now() - watch.startedAt) / 1000) : 0;
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${m}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col h-full animate-fade-in bg-surface">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/streamline/corporate/broadcasts")} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← Broadcasts
          </button>
          <div className="w-px h-5 bg-border" />
          <Radio className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            {watch?.title || "Broadcast"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isLive && (
            <>
              <span className="flex items-center gap-1.5 text-[11px] font-semibold bg-sl-red-dim text-sl-red border border-sl-red/20 px-2.5 py-1 rounded-full">
                <span className="w-2 h-2 rounded-full bg-sl-red animate-pulse" /> LIVE
              </span>
              <span className="font-mono text-xs text-muted-foreground">{fmt(elapsed)}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="w-3.5 h-3.5" /> {(watch?.viewerCount ?? 0).toLocaleString()}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-5">
        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-4 py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <div className="text-sm text-muted-foreground">Loading broadcast…</div>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex flex-col items-center gap-4 py-20">
            <div className="text-sm text-sl-red">{error}</div>
            <button onClick={() => navigate("/streamline/corporate/broadcasts")} className="px-4 py-2 rounded-lg bg-surface-2 border border-border text-sm text-muted-foreground hover:text-foreground">
              Back to Broadcasts
            </button>
          </div>
        )}

        {/* Live with HLS */}
        {!loading && !error && isLive && watch?.playlistUrl && (
          <div className="w-full max-w-4xl">
            <HlsPlayer
              playlistUrl={watch.playlistUrl}
              status="live"
              className="w-full"
            />
            <div className="mt-4 flex items-start gap-4">
              <div className="flex-1">
                <h1 className="text-lg font-bold text-foreground">{watch.title}</h1>
                <div className="text-xs text-muted-foreground mt-1">
                  {watch.team} · Started {fmt(elapsed)} ago · {(watch.viewerCount ?? 0).toLocaleString()} watching
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Live but no playlist URL (bypass mode or HLS still starting) */}
        {!loading && !error && isLive && !watch?.playlistUrl && (
          <div className="w-full max-w-4xl">
            <div className="w-full aspect-video bg-black rounded-2xl border border-border flex flex-col items-center justify-center gap-4">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider bg-sl-red text-white px-2.5 py-1 rounded">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE
                </span>
              </div>
              <Loader2 className="w-6 h-6 animate-spin text-white/50" />
              <div className="text-sm text-white/60">Stream is starting…</div>
              <div className="text-xs text-white/40">HLS feed will be available shortly</div>
            </div>
            <div className="mt-4">
              <h1 className="text-lg font-bold text-foreground">{watch?.title}</h1>
              <div className="text-xs text-muted-foreground mt-1">
                {watch?.team} · {(watch?.viewerCount ?? 0).toLocaleString()} watching
              </div>
            </div>
          </div>
        )}

        {/* Not live — waiting room */}
        {!loading && !error && !isLive && watch && (
          <div className="flex flex-col items-center gap-5 py-16">
            <div className="w-20 h-20 rounded-full bg-surface-2 border border-border flex items-center justify-center">
              <Radio className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <div className="text-center">
              <h1 className="text-lg font-bold text-foreground">{watch.title}</h1>
              <div className="text-xs text-muted-foreground mt-1">{watch.team}</div>
            </div>
            <div className={cn(
              "px-4 py-2 rounded-full text-sm font-semibold border",
              watch.status === "scheduled"
                ? "bg-accent-soft text-primary border-primary/20"
                : watch.status === "completed"
                  ? "bg-surface-3 text-muted-foreground border-border-2"
                  : "bg-surface-3 text-muted-foreground border-border-2"
            )}>
              {watch.status === "scheduled" ? "Scheduled — Waiting for host" :
               watch.status === "completed" ? "Broadcast Ended" :
               "Offline"}
            </div>
            <button onClick={() => navigate("/streamline/corporate/broadcasts")} className="text-xs text-primary hover:underline mt-2">
              ← Back to Broadcasts
            </button>
          </div>
        )}

        {/* Not found */}
        {!loading && !error && !watch && (
          <div className="flex flex-col items-center gap-4 py-20">
            <div className="text-sm text-muted-foreground">Broadcast not found</div>
            <button onClick={() => navigate("/streamline/corporate/broadcasts")} className="px-4 py-2 rounded-lg bg-surface-2 border border-border text-sm text-muted-foreground hover:text-foreground">
              Back to Broadcasts
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
