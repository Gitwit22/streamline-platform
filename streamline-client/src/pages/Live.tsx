import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import Hls from "hls.js";
import { API_BASE } from "../lib/apiBase";
import { getPublicHls } from "../services/hls";
import {
  Radio,
  RefreshCw,
  Volume2,
  VolumeX,
  Maximize,
  Users,
  Signal,
  AlertCircle,
} from "lucide-react";

const DEFAULT_LOGO_URL = "/logosmaller.png";

type PublicHlsResponse = {
  status?: "idle" | "starting" | "live" | "error";
  playlistUrl?: string | null;
  viewerCount?: number;
  error?: string | null;
};

type StreamStatus = "loading" | "live" | "starting" | "offline" | "error";

type RoomHlsConfig = {
  enabled: boolean;
  title?: string;
  subtitle?: string;
  logoUrl?: string;
  offlineMessage?: string;
  theme?: "light" | "dark";
  updatedAt?: string;
};

type PublicRoomHlsConfigResponse = {
  roomId: string;
  hlsConfig: RoomHlsConfig;
};

type PublicSavedEmbedResponse = {
  savedEmbedId: string;
  name: string;
  description?: string;
  activeRoomId: string | null;
  viewerPath: string;
};

function looksLikeRoomName(value: string) {
  // Your “never treat roomName as roomId” invariant
  return value.includes(" ") || value.includes("–") || value.includes("#");
}

function canNativeHls(video: HTMLVideoElement) {
  return video.canPlayType("application/vnd.apple.mpegurl") !== "";
}

function clampVolume(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function snapToLiveEdge(video: HTMLVideoElement) {
  try {
    const s = video.seekable;
    if (s && s.length) {
      const end = s.end(s.length - 1);
      video.currentTime = Math.max(0, end - 0.5);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export default function Live() {
  const params = useParams<{ savedEmbedId?: string }>();
  const location = useLocation();

  const savedEmbedId = (params.savedEmbedId || "").trim();
  const isIgMode = location.pathname.startsWith("/ig/");

  const [roomId, setRoomId] = useState<string>("");
  const [roomName, setRoomName] = useState<string>("");

  const [hlsStatus, setHlsStatus] = useState<PublicHlsResponse["status"]>("idle");
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);

  const [viewerConfig, setViewerConfig] = useState<RoomHlsConfig | null>(null);

  const [savedEmbedMeta, setSavedEmbedMeta] = useState<PublicSavedEmbedResponse | null>(null);

  // UI state
  const [status, setStatus] = useState<StreamStatus>("loading");
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(0.6);
  const [isRetrying, setIsRetrying] = useState(false);
  const [viewerCount, setViewerCount] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Resolve savedEmbedId -> activeRoomId and basic viewer metadata
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setError(null);

        if (!savedEmbedId) return;

        const res = await fetch(`${API_BASE}/api/saved-embeds/public/${encodeURIComponent(savedEmbedId)}`);

        if (!res.ok) {
          // Try to read a structured error so we can distinguish
          // between a removed embed vs other failures.
          let errCode: string | undefined;
          try {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            if (body && typeof body.error === "string") {
              errCode = body.error;
            }
          } catch {
            // ignore JSON parse failure
          }

          setStatus("error");
          if (res.status === 404 && errCode === "embed_removed") {
            setError("This viewer link was removed by the host.");
          } else if (res.status === 404) {
            setError("This viewer link is no longer valid.");
          } else {
            setError("Failed to load viewer page.");
          }
          return;
        }

        const data = (await res.json().catch(() => null)) as PublicSavedEmbedResponse | null;
        if (!data || cancelled) return;

        const nextRoomId = String(data.activeRoomId || "").trim();
        setSavedEmbedMeta(data);
        if (nextRoomId) setRoomId(nextRoomId);
      } catch {
        setStatus("error");
        setError("Failed to load viewer page.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [savedEmbedId]);

  // Fetch public viewer configuration (title/subtitle/logo/theme/offline message)
  const reloadViewerConfig = useCallback(async () => {
    const currentRoomId = (roomId || "").trim();
    if (!currentRoomId) return;

    if (looksLikeRoomName(currentRoomId)) {
      setViewerConfig(null);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/public/rooms/${encodeURIComponent(currentRoomId)}/hls-config`);

      if (!res.ok) {
        setViewerConfig(null);
        return;
      }

      const data = (await res.json().catch(() => null)) as PublicRoomHlsConfigResponse | null;
      if (!data?.hlsConfig) {
        setViewerConfig(null);
        return;
      }

      setViewerConfig(data.hlsConfig);
    } catch {
      // ignore
    }
  }, [roomId]);

  useEffect(() => {
    void reloadViewerConfig();
  }, [reloadViewerConfig]);

  // Fetch HLS status + playlist URL by roomId using the public viewer-safe endpoint.
  const fetchHlsStatus = useCallback(async () => {
    const currentRoomId = (roomId || "").trim();
    if (!currentRoomId) return;

    if (looksLikeRoomName(currentRoomId)) {
      setError("HLS must use Firestore roomId, not roomName.");
      setStatus("error");
      return;
    }

    setIsRetrying(true);
    try {
      const data = (await getPublicHls(currentRoomId).catch(() => null)) as PublicHlsResponse | null;
      if (!data) return;

      const nextStatus = (data.status || "idle") as PublicHlsResponse["status"];
      setHlsStatus(nextStatus);
      setPlaylistUrl(data.playlistUrl ?? null);
      setViewerCount(typeof data.viewerCount === "number" && Number.isFinite(data.viewerCount) ? data.viewerCount : 0);

      if (nextStatus === "live") {
        setStatus("live");
        setEnded(false);
      } else if (nextStatus === "starting") {
        setStatus("starting");
      } else if (nextStatus === "error") {
        setStatus("error");
        if (data.error) setError(String(data.error));
      } else {
        // idle
        setStatus("offline");
        if (playlistUrl) setEnded(true);
      }
    } catch {
      // ignore
    } finally {
      setIsRetrying(false);
    }
  }, [roomId, playlistUrl]);

  // Poll loop
  useEffect(() => {
    const currentRoomId = (roomId || "").trim();
    if (!currentRoomId) return;

    if (looksLikeRoomName(currentRoomId)) {
      setError("HLS must use Firestore roomId, not roomName.");
      setStatus("error");
      return;
    }

    fetchHlsStatus();
    const t = window.setInterval(fetchHlsStatus, 3000);
    return () => window.clearInterval(t);
  }, [roomId, fetchHlsStatus]);

  const handleRefreshGoLive = useCallback(() => {
    void reloadViewerConfig();
    void fetchHlsStatus();

    const v = videoRef.current;
    if (v) {
      snapToLiveEdge(v);

      // If we are using hls.js, nudge it to (re)load from the live edge.
      // This is intentionally lightweight (no destroy/recreate) to avoid
      // visible resets during playback.
      const hls = hlsRef.current;
      if (hls) {
        try {
          hls.startLoad(-1);
        } catch {
          // ignore
        }
      }

      if (v.paused) {
        void v.play().catch(() => {});
      }
    }
  }, [reloadViewerConfig, fetchHlsStatus]);

  if (isIgMode) {
    return (
      <div className="fixed inset-0 bg-black">
        {playlistUrl && status === "live" ? (
          <>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              autoPlay
              muted={isMuted}
              playsInline
              controls={false}
              onClick={() => {
                // Minimal UX: tap to unmute/mute
                setIsMuted((m) => !m);
              }}
            />

            <div className="absolute top-4 right-4 flex items-center gap-2">
              <button
                onClick={handleRefreshGoLive}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-sm transition-colors border border-white/10 text-xs font-medium text-white"
                aria-label="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${isRetrying ? "animate-spin" : ""}`} />
                <span>Refresh</span>
              </button>
            </div>

            <div className="absolute top-4 left-4">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-600/95 backdrop-blur-sm shadow-lg shadow-red-500/30">
                <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                <span className="text-xs font-bold text-white tracking-wider">LIVE</span>
              </div>
            </div>

            <div className="absolute bottom-4 right-4">
              <button
                onClick={toggleMute}
                className="p-3 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm transition-colors border border-white/10"
                aria-label="Toggle mute"
              >
                {isMuted ? <VolumeX className="w-5 h-5 text-white" /> : <Volume2 className="w-5 h-5 text-white" />}
              </button>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <div className="text-lg font-semibold text-white mb-2">
              {status === "loading" && "Connecting..."}
              {status === "starting" && "Starting..."}
              {status === "offline" && (ended ? "Stream ended" : "Offline")}
              {status === "error" && "Connection Error"}
            </div>

            {error && <div className="text-sm text-red-300 mb-4 max-w-md">{error}</div>}

            <button
              onClick={() => {
                void fetchHlsStatus();
                const v = videoRef.current;
                if (v) snapToLiveEdge(v);
              }}
              disabled={isRetrying}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-white/10"
            >
              <RefreshCw className={`w-4 h-4 ${isRetrying ? "animate-spin" : ""}`} />
              {isRetrying ? "Retrying..." : "Retry"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Attach HLS playback (source + player wiring) once per playlist URL.
  // Mute/volume are applied in a separate effect so toggling audio does
  // NOT recreate the player or reset the stream.
  // - Safari/iOS: native HLS via video.src
  // - Chrome/Firefox/Edge: hls.js
  useEffect(() => {
    const video = videoRef.current;
    if (!playlistUrl || !video) return;

    // reset state for a fresh attach
    setError(null);

    if (canNativeHls(video)) {
      video.src = playlistUrl;
      video.muted = isMuted;
      video.volume = clampVolume(volume);

      const onMeta = () => {
        snapToLiveEdge(video);
        void video.play().catch(() => {
          // autoplay might be blocked until user interacts
        });
      };

      video.addEventListener("loadedmetadata", onMeta, { once: true });
      return;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        // Keep playback near the live edge with a slightly larger safety buffer.
        // This helps hide small delivery jitters.
        liveSyncDurationCount: 6,
        liveMaxLatencyDurationCount: 12,

        // Increase forward buffer so brief network blips don't immediately stall playback.
        maxBufferLength: 30,

        // Avoid aggressive flushing of already-played content.
        backBufferLength: 30,

        // Make fragment loading a bit more tolerant of transient failures.
        fragLoadingRetryDelay: 1000,
        fragLoadingMaxRetry: 6,
        levelLoadingMaxRetry: 6,

        enableWorker: true,
        lowLatencyMode: true,
      });

      hlsRef.current = hls;

      hls.loadSource(playlistUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.muted = isMuted;
        video.volume = clampVolume(volume);

        const onMeta = () => {
          snapToLiveEdge(video);
          void video.play().catch(() => {
            // autoplay blocked until user interacts
          });
        };

        video.addEventListener("loadedmetadata", onMeta, { once: true });
      });

      hls.on(Hls.Events.ERROR, (evt, data) => {
        // Basic diagnostics to understand "choppy" behavior buckets.
        try {
          const currentTime = video.currentTime;
          const bufferedEnd = video.buffered && video.buffered.length ? video.buffered.end(video.buffered.length - 1) : currentTime;
          const bufferHealth = bufferedEnd - currentTime;
          // eslint-disable-next-line no-console
          console.warn("[hls] ERROR", {
            event: evt,
            details: data?.details,
            fatal: data?.fatal,
            reason: data?.reason,
            bufferHealth,
          });
        } catch {
          // ignore diagnostics errors
        }

        if (data?.fatal) {
          setStatus("error");
          setError("Stream playback error");
          try {
            hls.destroy();
          } catch {
            // ignore
          }
        }
      });

      // Fragment-level diagnostics: track buffer health as segments are appended.
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        try {
          const currentTime = video.currentTime;
          const bufferedEnd = video.buffered && video.buffered.length ? video.buffered.end(video.buffered.length - 1) : currentTime;
          const bufferHealth = bufferedEnd - currentTime;
          // eslint-disable-next-line no-console
          console.debug("[hls] FRAG_BUFFERED", { bufferHealth });
        } catch {
          // ignore
        }
      });

      // Level switch diagnostics (if ABR is active in the future).
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        try {
          // eslint-disable-next-line no-console
          console.info("[hls] LEVEL_SWITCHED", { level: data?.level });
        } catch {
          // ignore
        }
      });

      return () => {
        try {
          hls.destroy();
        } catch {
          // ignore
        }

        if (hlsRef.current === hls) {
          hlsRef.current = null;
        }
      };
    } else {
      setStatus("error");
      setError("HLS not supported in this browser.");
    }
  }, [playlistUrl]);

  // Apply audio settings ONLY (no src/hls work here). This ensures mute/volume
  // changes never recreate the player or reload the stream.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = isMuted;
    v.volume = Math.min(1, Math.max(0, volume));
  }, [isMuted, volume]);

  const toggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  const toggleFullscreen = () => {
    const v = videoRef.current;
    if (!v) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void v.requestFullscreen();
    }
  };

  const StatusBadge = () => {
    const map: Record<StreamStatus, { label: string; dot: string; ring: string; text: string }> = {
      live: { label: "LIVE", dot: "bg-red-500", ring: "border-red-500/60", text: "text-red-300" },
      starting: { label: "STARTING", dot: "bg-amber-500", ring: "border-amber-500/50", text: "text-amber-300" },
      offline: { label: ended ? "ENDED" : "OFFLINE", dot: "bg-neutral-500", ring: "border-neutral-600/50", text: "text-neutral-300" },
      loading: { label: "CONNECTING", dot: "bg-red-500", ring: "border-red-500/40", text: "text-red-300" },
      error: { label: "ERROR", dot: "bg-red-600", ring: "border-red-700/50", text: "text-red-300" },
    };

    const cfg = map[status];

    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/30 border ${cfg.ring} backdrop-blur-sm`}>
        <div className={`w-2 h-2 rounded-full ${cfg.dot} ${status === "live" || status === "starting" || status === "loading" ? "animate-pulse" : ""}`} />
        <span className={`text-xs font-bold tracking-wider ${cfg.text}`}>{cfg.label}</span>
      </div>
    );
  };

  const displayTitle = (viewerConfig?.title || "").trim() || (savedEmbedMeta?.name || roomName || "").trim() || "StreamLine";
  const displaySubtitle = (viewerConfig?.subtitle || "").trim() || (savedEmbedMeta?.description || "Live Viewer");
  const displayLogoUrl = (viewerConfig?.logoUrl || "").trim();
  const isLightTheme = (viewerConfig?.theme || "dark") === "light";

  return (
    <div className={["min-h-screen relative overflow-hidden", isLightTheme ? "bg-white" : "bg-black"].join(" ")}>
      {/* Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-red-900/20 via-transparent to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDuration: "8s" }} />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-red-950/30 via-transparent to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDuration: "10s", animationDelay: "2s" }} />
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-gradient-to-br from-red-800/10 to-transparent rounded-full blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
            backgroundSize: "50px 50px",
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="p-6">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                {displayLogoUrl ? (
                  <>
                    <div className="w-10 h-10 rounded-xl bg-white/90 flex items-center justify-center shadow-lg shadow-red-500/20 border border-white/30 overflow-hidden">
                      <img src={displayLogoUrl} alt="Logo" className="w-full h-full object-contain" />
                    </div>
                    <div className="absolute -inset-1 bg-red-500/20 rounded-xl blur-md -z-10" />
                  </>
                ) : (
                  <>
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shadow-lg shadow-red-500/30 overflow-hidden">
                      <img src={DEFAULT_LOGO_URL} alt="Logo" className="w-7 h-7 object-contain" />
                    </div>
                    <div className="absolute -inset-1 bg-red-500/30 rounded-xl blur-md -z-10" />
                  </>
                )}
              </div>
              <div>
                <div className={["text-xl font-bold tracking-tight", isLightTheme ? "text-neutral-900" : "text-white"].join(" ")}>{displayTitle}</div>
                <div className={["text-xs font-medium", isLightTheme ? "text-neutral-600" : "text-neutral-500"].join(" ")}>{displaySubtitle}</div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Placeholder viewer count (wire later) */}
              {status === "live" && (
                <div className="flex items-center gap-2 text-neutral-400">
                  <Users className="w-4 h-4" />
                  <span className="text-sm font-medium">{viewerCount.toLocaleString()}</span>
                </div>
              )}
              <StatusBadge />
            </div>
          </div>
        </header>

        {/* Main */}
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-5xl">
            {/* Info strip */}
            <div className="mb-4 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className={["font-semibold", isLightTheme ? "text-neutral-900" : "text-white"].join(" ")}>{displayTitle}</div>
                <div className={["text-xs", isLightTheme ? "text-neutral-600" : "text-neutral-500"].join(" ")}>
                  {status === "live" ? "Watching live" : ended ? "Stream ended." : "Starting soon"}
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200">
                  <AlertCircle className="w-4 h-4 mt-0.5" />
                  <div className="text-sm">{error}</div>
                </div>
              )}
            </div>

            {/* Video frame */}
            <div className="relative rounded-2xl overflow-hidden">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-red-500/20 via-transparent to-red-500/10 p-px">
                <div className="w-full h-full rounded-2xl bg-neutral-950/90 backdrop-blur-xl" />
              </div>

              <div className="relative aspect-video bg-black/80 rounded-2xl overflow-hidden border border-neutral-800/50">
                {playlistUrl && status === "live" ? (
                  <>
                    <video ref={videoRef} className="w-full h-full object-contain" autoPlay muted={isMuted} playsInline controls={false} />

                    {/* overlay controls */}
                    <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 via-black/50 to-transparent opacity-100 md:opacity-0 md:hover:opacity-100 transition-opacity duration-300">
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                          <button
                            onClick={toggleMute}
                            className="p-2 rounded-lg bg-white/10 hover:bg-red-500/30 backdrop-blur-sm transition-colors border border-white/10 hover:border-red-500/50"
                            aria-label="Toggle mute"
                          >
                            {isMuted ? <VolumeX className="w-5 h-5 text-white" /> : <Volume2 className="w-5 h-5 text-white" />}
                          </button>

                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={isMuted ? 0 : volume}
                            onChange={(e) => {
                              const raw = Number(e.target.value);
                              const next = Math.min(1, Math.max(0, Number.isFinite(raw) ? raw : 0));
                              setVolume(next);
                              if (next > 0) setIsMuted(false);
                              if (next === 0) setIsMuted(true);
                            }}
                            className="w-32 h-1 rounded-full bg-neutral-700 accent-red-500 cursor-pointer"
                            aria-label="Volume"
                          />

                          {isMuted && (
                            <span className="text-xs text-neutral-300 bg-black/60 px-2 py-1 rounded border border-neutral-700/50">
                              Click to unmute
                            </span>
                          )}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleRefreshGoLive}
                              className="flex items-center gap-1 px-3 py-2 rounded-lg bg-white/10 hover:bg-red-500/30 backdrop-blur-sm transition-colors border border-white/10 hover:border-red-500/50 text-xs font-medium text-white"
                            >
                              <RefreshCw className="w-3 h-3" />
                              <span>Live View</span>
                            </button>

                            <button
                              onClick={toggleFullscreen}
                              className="p-2 rounded-lg bg-white/10 hover:bg-red-500/30 backdrop-blur-sm transition-colors border border-white/10 hover:border-red-500/50"
                              aria-label="Fullscreen"
                            >
                              <Maximize className="w-5 h-5 text-white" />
                            </button>
                          </div>
                        </div>

                      </div>
                    </div>

                    {/* Live pill */}
                    <div className="absolute top-4 left-4">
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-600/95 backdrop-blur-sm shadow-lg shadow-red-500/30">
                        <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                        <span className="text-xs font-bold text-white tracking-wider">LIVE</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                    <div className="relative mb-5">
                      <div
                        className={[
                          "w-20 h-20 rounded-2xl flex items-center justify-center border",
                          status === "loading" || status === "starting"
                            ? "bg-gradient-to-br from-red-600/30 to-red-900/30 border-red-500/40"
                            : status === "error"
                            ? "bg-gradient-to-br from-red-900/40 to-red-950/40 border-red-700/40"
                            : "bg-gradient-to-br from-neutral-800/50 to-neutral-900/50 border-neutral-700/30",
                        ].join(" ")}
                      >
                        {status === "loading" || status === "starting" ? (
                          <Signal className={`w-8 h-8 text-red-400 ${isRetrying ? "animate-pulse" : ""}`} />
                        ) : status === "error" ? (
                          <AlertCircle className="w-8 h-8 text-red-500" />
                        ) : (
                          <Radio className="w-8 h-8 text-neutral-500" />
                        )}
                      </div>

                      {(status === "loading" || status === "starting") && (
                        <div className="absolute -inset-2 rounded-2xl border-2 border-red-500/30 animate-ping" />
                      )}
                    </div>

                    <div className="text-xl font-semibold text-white mb-2">
                      {status === "loading" && "Connecting to stream..."}
                      {status === "starting" && "Stream is starting..."}
                      {status === "offline" && (ended ? "Stream ended" : "Stream is offline")}
                      {status === "error" && "Connection Error"}
                    </div>

                    <div className="text-sm text-neutral-500 mb-6 max-w-md">
                      {status === "loading" && "Please wait while we establish a connection."}
                      {status === "starting" && "The broadcaster is preparing to go live."}
                      {status === "offline" &&
                        (ended
                          ? "This broadcast has ended."
                          : (viewerConfig?.offlineMessage || "").trim() || "This stream isn’t live yet. Check back in a moment.")}
                      {status === "error" && (error || "Unable to connect to the stream.")}
                    </div>

                    <button
                      onClick={() => {
                        void fetchHlsStatus();
                        const v = videoRef.current;
                        if (v) snapToLiveEdge(v);
                      }}
                      disabled={isRetrying}
                      className="group flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-medium text-sm transition-all duration-300 shadow-lg shadow-red-500/30 hover:shadow-red-500/50 disabled:opacity-50 disabled:cursor-not-allowed border border-red-500/30"
                    >
                      <RefreshCw className={`w-4 h-4 ${isRetrying ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-500"}`} />
                      {isRetrying ? "Retrying..." : "Retry Connection"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 text-center text-lg text-neutral-700">
              Powered by <span className="text-red-500 font-medium">StreamLine</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
