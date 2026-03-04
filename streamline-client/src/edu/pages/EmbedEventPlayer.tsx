import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Hls from "hls.js";
import { Loader2, RefreshCw } from "lucide-react";
import {
  authPublicEduEmbedPassword,
  fetchPublicEduEmbed,
  fetchPublicEduEmbedMeta,
  type PublicEduBroadcast,
  type PublicEduEvent,
} from "../api/publicEmbed";
import { setEduLane } from "../state/eduMode";
import { useHlsReadiness } from "../../hooks/useHlsReadiness";

type PlayerState = "scheduled" | "live" | "offair";

function canNativeHls(video: HTMLVideoElement) {
  return video.canPlayType("application/vnd.apple.mpegurl") !== "";
}

function formatTime(d: Date) {
  try {
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return d.toISOString();
  }
}

function computeCountdown(targetMs: number) {
  const diff = Math.max(0, targetMs - Date.now());
  const totalSeconds = Math.floor(diff / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return { diff, h, m, s };
}

export default function EmbedEventPlayer() {
  useEffect(() => {
    setEduLane();
  }, []);

  const [sp] = useSearchParams();
  const embedId = String(sp.get("embedId") || "").trim();
  const token = String(sp.get("t") || "").trim();
  const previewStateRaw = String(sp.get("previewState") || "").trim().toLowerCase();

  const previewState =
    previewStateRaw === "scheduled" || previewStateRaw === "live" || previewStateRaw === "offair"
      ? (previewStateRaw as PlayerState)
      : null;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<PublicEduEvent | null>(null);
  const [broadcast, setBroadcast] = useState<PublicEduBroadcast | null>(null);

  const [requiresPassword, setRequiresPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [tick, setTick] = useState(0);

  const [playerNonce, setPlayerNonce] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const grantStorageKey = useMemo(() => {
    if (!embedId) return null;
    return `sl_edu_embed_grant_${embedId}`;
  }, [embedId]);

  const [savedGrant, setSavedGrant] = useState("");

  useEffect(() => {
    if (!grantStorageKey) {
      setSavedGrant("");
      return;
    }
    try {
      setSavedGrant(sessionStorage.getItem(grantStorageKey) || "");
    } catch {
      setSavedGrant("");
    }
  }, [grantStorageKey]);

  // Data load (meta first, then gated payload)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!embedId) {
        setError("Missing embedId");
        setEvent(null);
        setBroadcast(null);
        return;
      }

      setLoading(true);
      setError(null);
      setPasswordError(null);
      try {
        const meta = await fetchPublicEduEmbedMeta({ embedId, token });
        if (cancelled) return;

        setEvent(meta.event);
        setBroadcast((meta.broadcast as any) || null);
        setRequiresPassword(meta.embed.requiresPassword);

        // If no password required, or we already have a saved grant, fetch full payload.
        if (!meta.embed.requiresPassword) {
          const data = await fetchPublicEduEmbed({ embedId, token });
          if (cancelled) return;
          setEvent(data.event);
          setBroadcast(data.broadcast);
        } else if (savedGrant) {
          const data = await fetchPublicEduEmbed({ embedId, token, grant: savedGrant });
          if (cancelled) return;
          setEvent(data.event);
          setBroadcast(data.broadcast);
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || "Failed to load event");
        setEvent(null);
        setBroadcast(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [embedId, token, savedGrant]);

  // Countdown tick
  useEffect(() => {
    const i = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(i);
  }, []);

  const computedState = useMemo<PlayerState>(() => {
    if (previewState) return previewState;

    const evStatus = String(event?.status || "").toLowerCase();
    const bStatus = String(broadcast?.status || "").toLowerCase();

    if (evStatus === "live" || bStatus === "live") return "live";
    if (evStatus === "ended" || bStatus === "ended") return "offair";

    // Default: scheduled
    return "scheduled";
  }, [previewState, event?.status, broadcast?.status]);

  const scheduledMs = useMemo(() => {
    const raw = event?.scheduledStartAt;
    if (!raw) return null;
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : null;
  }, [event?.scheduledStartAt]);

  const countdown = useMemo(() => {
    void tick;
    if (!scheduledMs) return null;
    return computeCountdown(scheduledMs);
  }, [scheduledMs, tick]);

  const hlsUrl = (broadcast?.hlsPlaybackUrl || "").trim();

  const manifestReadiness = useHlsReadiness(hlsUrl || null, playerNonce);

  // HLS attach when live
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Clean up any previous instance
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {
        // ignore
      }
      hlsRef.current = null;
    }

    if (computedState !== "live") {
      try {
        video.pause();
      } catch {
        // ignore
      }
      video.removeAttribute("src");
      video.load();
      return;
    }

    if (!hlsUrl) return;
    if (manifestReadiness !== "ready") return;

    if (canNativeHls(video)) {
      video.src = hlsUrl;
      video.play().catch(() => void 0);
      return () => {
        try {
          video.pause();
        } catch {
          // ignore
        }
        try {
          video.removeAttribute("src");
          video.load();
        } catch {
          // ignore
        }
      };
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => void 0);
      });
    }

    return () => {
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {
          // ignore
        }
        hlsRef.current = null;
      }

      try {
        video.pause();
      } catch {
        // ignore
      }
      try {
        video.removeAttribute("src");
        video.load();
      } catch {
        // ignore
      }
    };
  }, [computedState, hlsUrl, manifestReadiness, playerNonce]);

  const title = (event?.title || "Live Event").trim() || "Live Event";

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
        <div className="rounded-2xl border border-slate-800/50 bg-slate-900/40 p-4">
          <div className="text-lg font-semibold tracking-tight">{title}</div>
          <div className="mt-1 text-sm text-slate-400">
            {loading ? "Loading…" : error ? error : computedState === "live" ? "Live" : computedState === "offair" ? "Off-air" : "Scheduled"}
            {embedId ? <span className="text-slate-600"> · {embedId}</span> : null}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-800/50 bg-black">
          {requiresPassword && !savedGrant ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="text-xl font-semibold">Password required</div>
              <div className="text-sm text-slate-400">Enter the embed password to watch.</div>

              <div className="mt-2 w-full max-w-sm">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-800/60 bg-slate-950/40 px-4 py-3 text-sm text-white outline-none focus:border-orange-500/40"
                  placeholder="Password"
                />

                <button
                  type="button"
                  disabled={passwordBusy || password.trim().length < 1}
                  onClick={async () => {
                    if (!grantStorageKey) return;
                    setPasswordBusy(true);
                    setPasswordError(null);
                    try {
                      const auth = await authPublicEduEmbedPassword({ embedId, token, password });
                      try {
                        sessionStorage.setItem(grantStorageKey, auth.grant);
                      } catch {
                        // ignore
                      }

                      setSavedGrant(auth.grant);
                      setPassword("");
                    } catch (e: any) {
                      setPasswordError(e?.message || "Invalid password");
                    } finally {
                      setPasswordBusy(false);
                    }
                  }}
                  className={
                    "mt-3 w-full rounded-xl px-4 py-3 text-sm font-semibold " +
                    (passwordBusy || password.trim().length < 1
                      ? "cursor-not-allowed bg-slate-800 text-slate-500"
                      : "bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 text-white")
                  }
                >
                  {passwordBusy ? "Checking…" : "Unlock"}
                </button>

                {passwordError ? (
                  <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {passwordError}
                  </div>
                ) : null}
              </div>
            </div>
          ) : computedState === "live" ? (
            <div className="relative">
              {manifestReadiness === "ready" ? (
                <video
                  key={playerNonce}
                  ref={videoRef}
                  className="aspect-video w-full"
                  controls
                  playsInline
                  muted
                />
              ) : (
                <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <img src="/logo.png" alt="StreamLine" className="h-12 w-auto opacity-95" />

                  {hlsUrl ? (
                    <>
                      <div className="text-xl font-semibold">Stream will begin soon…</div>
                      <div className="text-sm text-slate-400">Preparing video feed (this can take a few seconds).</div>
                      <div className="mt-1 flex items-center gap-2 text-sm text-slate-300">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Stand by…</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-xl font-semibold">Stream is offline</div>
                      <div className="text-sm text-slate-400">When the host goes live, playback will start automatically.</div>
                    </>
                  )}
                </div>
              )}

              <div className="absolute right-3 top-3">
                <button
                  type="button"
                  onClick={() => setPlayerNonce((n) => n + 1)}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/20"
                  aria-label="Refresh stream"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh stream
                </button>
              </div>
            </div>
          ) : computedState === "scheduled" ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="text-xl font-semibold">Scheduled</div>
              {scheduledMs ? (
                <div className="text-sm text-slate-300">
                  {formatTime(new Date(scheduledMs))}
                </div>
              ) : (
                <div className="text-sm text-slate-400">Start time not set</div>
              )}
              {countdown ? (
                <div className="mt-1 rounded-xl border border-slate-800/60 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
                  Starts in {countdown.h}h {String(countdown.m).padStart(2, "0")}m {String(countdown.s).padStart(2, "0")}s
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="text-xl font-semibold">Off-air</div>
              <div className="text-sm text-slate-400">This broadcast is not live.</div>
              {broadcast?.replayUrl ? (
                <a
                  className="mt-2 rounded-xl border border-slate-800/60 bg-slate-900/50 px-4 py-2 text-sm text-white hover:bg-slate-800/60"
                  href={broadcast.replayUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Watch replay
                </a>
              ) : null}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800/50 bg-slate-900/30 p-4 text-xs text-slate-400">
          This page is the stable embed target for events: <span className="text-slate-200">/streamline/edu/embed/event?embedId=…&amp;t=…</span>
        </div>
      </div>
    </div>
  );
}
