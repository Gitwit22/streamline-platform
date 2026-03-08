/**
 * Public viewer page for shareable room embeds.
 * URL: /live/:embedId
 *
 * Flow:
 *   1. Fetch embed metadata from GET /api/saved-embeds/public/:embedId → { activeRoomId }
 *   2. Poll GET /api/public/hls/:roomId for HLS status + playlist URL
 *   3. Render the HLS player when live, otherwise show status screens
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Hls from "hls.js";
import { Loader2, RefreshCw } from "lucide-react";
import { API_BASE } from "../lib/apiBase";

/* ── types ────────────────────────────────────────────────────── */
type EmbedMeta = {
  savedEmbedId: string;
  name: string;
  description?: string;
  activeRoomId: string | null;
  viewerPath?: string;
};

type HlsInfo = {
  status?: "idle" | "starting" | "live" | "error" | string;
  playlistUrl?: string | null;
  viewerCount?: number;
};

type ViewerState = "loading" | "idle" | "starting" | "live" | "error" | "not_found" | "embed_removed";

/* ── helpers ──────────────────────────────────────────────────── */
function canNativeHls(video: HTMLVideoElement) {
  return video.canPlayType("application/vnd.apple.mpegurl") !== "";
}

async function fetchEmbedMeta(embedId: string): Promise<EmbedMeta> {
  const res = await fetch(`${API_BASE}/api/saved-embeds/public/${encodeURIComponent(embedId)}`);
  if (res.status === 404) {
    const body = await res.json().catch(() => ({}));
    if (body?.error === "embed_removed") throw new Error("embed_removed");
    throw new Error("not_found");
  }
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

async function fetchHlsStatus(roomId: string): Promise<HlsInfo> {
  const res = await fetch(`${API_BASE}/api/public/hls/${encodeURIComponent(roomId)}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`hls_status_${res.status}:${text}`);
  }
  return res.json();
}

/* ── component ────────────────────────────────────────────────── */
export default function LiveRoomViewer() {
  const { id: embedId } = useParams<{ id: string }>();

  const [viewerState, setViewerState] = useState<ViewerState>("loading");
  const [embedMeta, setEmbedMeta] = useState<EmbedMeta | null>(null);
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [playerNonce, setPlayerNonce] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  /* ── 1. Fetch embed metadata ────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!embedId) {
        setViewerState("not_found");
        return;
      }

      setViewerState("loading");
      setErrorMsg(null);

      try {
        const meta = await fetchEmbedMeta(embedId);
        if (cancelled) return;
        setEmbedMeta(meta);

        if (!meta.activeRoomId) {
          setViewerState("idle");
          return;
        }

        // Immediately fetch HLS status
        try {
          const hls = await fetchHlsStatus(meta.activeRoomId);
          if (cancelled) return;
          const status = hls.status || "idle";
          setPlaylistUrl(hls.playlistUrl || null);
          setViewerCount(hls.viewerCount ?? null);
          setViewerState(status === "live" ? "live" : status === "starting" ? "starting" : "idle");
        } catch {
          if (cancelled) return;
          setViewerState("idle");
        }
      } catch (e: any) {
        if (cancelled) return;
        if (e?.message === "embed_removed") {
          setViewerState("embed_removed");
        } else if (e?.message === "not_found") {
          setViewerState("not_found");
        } else {
          setViewerState("error");
          setErrorMsg(e?.message || "Failed to load embed");
        }
      }
    })();

    return () => { cancelled = true; };
  }, [embedId]);

  /* ── 2. Poll HLS status every 5 s ──────────────────────────── */
  useEffect(() => {
    const roomId = embedMeta?.activeRoomId;
    if (!roomId) return;

    // Don't poll on terminal states
    if (viewerState === "not_found" || viewerState === "embed_removed") return;

    const poll = async () => {
      try {
        const hls = await fetchHlsStatus(roomId);
        const status = hls.status || "idle";
        setPlaylistUrl(hls.playlistUrl || null);
        setViewerCount(hls.viewerCount ?? null);
        setViewerState(status === "live" ? "live" : status === "starting" ? "starting" : "idle");
      } catch {
        // Ignore transient errors during polling
      }
    };

    const id = window.setInterval(poll, 5_000);
    return () => window.clearInterval(id);
  }, [embedMeta?.activeRoomId, viewerState]);

  /* ── 3. Attach/detach HLS.js player when live ──────────────── */
  const resolvedPlaylistUrl = viewerState === "live" ? (playlistUrl || null) : null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Clean up previous instance
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch { /* ignore */ }
      hlsRef.current = null;
    }

    video.pause();
    video.removeAttribute("src");
    video.load();

    if (!resolvedPlaylistUrl) return;

    // Safari / iOS native HLS
    if (canNativeHls(video)) {
      video.src = resolvedPlaylistUrl;
      video.muted = true;
      video.play()?.catch(() => { /* autoplay blocked */ });
      return;
    }

    // hls.js
    if (!Hls.isSupported()) return;

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
    });
    hlsRef.current = hls;

    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data?.fatal) return;
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          try { hls.startLoad(); } catch { /* ignore */ }
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          try { hls.recoverMediaError(); } catch { /* ignore */ }
          break;
        default:
          try { hls.destroy(); } catch { /* ignore */ }
          hlsRef.current = null;
      }
    });

    hls.loadSource(resolvedPlaylistUrl);
    hls.attachMedia(video);

    video.muted = true;
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play()?.catch(() => { /* autoplay blocked */ });
    });

    return () => {
      try { hls.destroy(); } catch { /* ignore */ }
      hlsRef.current = null;
    };
  }, [resolvedPlaylistUrl, playerNonce]);

  /* ── derived ────────────────────────────────────────────────── */
  const embedName = embedMeta?.name || "Live Stream";

  /* ── render ─────────────────────────────────────────────────── */
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-4 py-8">
      <div className="flex w-full max-w-4xl flex-col gap-4">
        {/* Header bar */}
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-3">
            <img src="/edu_logo.png" alt="StreamLine EDU" className="h-8 w-auto opacity-90" />
            <div className="hidden text-sm font-medium text-slate-300 sm:block">{embedName}</div>
          </div>
          <div className="flex items-center gap-2">
            {viewerState === "live" && viewerCount != null && viewerCount > 0 && (
              <span className="rounded-full bg-red-600/20 px-2.5 py-1 text-xs font-semibold text-red-300">
                {viewerCount} watching
              </span>
            )}
            <span
              className={
                "rounded-full px-2.5 py-1 text-xs font-semibold " +
                (viewerState === "live"
                  ? "bg-red-600/20 text-red-300"
                  : viewerState === "starting"
                    ? "bg-amber-600/20 text-amber-300"
                    : "bg-slate-800 text-slate-400")
              }
            >
              {viewerState === "live" ? "● LIVE" : viewerState === "starting" ? "Starting…" : "Offline"}
            </span>
          </div>
        </div>

        {/* Player area */}
        <div className="overflow-hidden rounded-2xl border border-slate-800/50 bg-black">
          {viewerState === "loading" ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 px-6 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              <div className="text-sm text-slate-400">Loading…</div>
            </div>
          ) : viewerState === "not_found" ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="text-xl font-semibold text-white">Link not found</div>
              <div className="text-sm text-slate-400">This embed link doesn't exist or has been removed.</div>
            </div>
          ) : viewerState === "embed_removed" ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="text-xl font-semibold text-white">Link removed</div>
              <div className="text-sm text-slate-400">This embed has been archived or deleted by the owner.</div>
            </div>
          ) : viewerState === "error" ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="text-xl font-semibold text-white">Something went wrong</div>
              <div className="text-sm text-slate-400">{errorMsg || "Please try again later."}</div>
            </div>
          ) : viewerState === "live" ? (
            <div className="relative">
              <video
                key={playerNonce}
                ref={videoRef}
                className="aspect-video w-full"
                controls
                playsInline
                muted
              />
              <div className="absolute right-3 top-3">
                <button
                  type="button"
                  onClick={() => setPlayerNonce((n) => n + 1)}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/20"
                  aria-label="Refresh stream"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </button>
              </div>
            </div>
          ) : viewerState === "starting" ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 px-6 text-center">
              <img src="/edu_logo.png" alt="StreamLine EDU" className="h-12 w-auto opacity-95" />
              <div className="text-xl font-semibold text-white">Stream starting…</div>
              <div className="text-sm text-slate-400">Preparing the video feed. This can take a few seconds.</div>
              <Loader2 className="mt-1 h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : (
            /* idle / offline */
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 px-6 text-center">
              <img src="/edu_logo.png" alt="StreamLine EDU" className="h-12 w-auto opacity-95" />
              <div className="text-xl font-semibold text-white">Stream is offline</div>
              <div className="text-sm text-slate-400">When the host goes live, playback will start automatically.</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center px-2">
          <div className="font-mono text-[9px] tracking-[0.15em] text-slate-600">
            Powered by StreamLine EDU
          </div>
        </div>
      </div>
    </div>
  );
}
