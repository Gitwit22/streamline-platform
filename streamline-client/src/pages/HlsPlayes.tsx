import React, { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";

type Props = {
  playlistUrl: string;
  // optional: lets you show a friendly message when stream is starting
  status?: string;
  className?: string;
  autoPlay?: boolean; // default true (muted)
};

export function HlsPlayer({
  playlistUrl,
  status,
  className,
  autoPlay = true,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const isNativeHls = useMemo(() => {
    const v = document.createElement("video");
    return v.canPlayType("application/vnd.apple.mpegurl") !== "";
  }, []);

  useEffect(() => {
    setPlayerError(null);

    const video = videoRef.current;
    if (!video) return;

    // Reset any previous instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Always clear src before reattaching
    video.pause();
    video.removeAttribute("src");
    video.load();

    // Safari/iOS native HLS
    if (isNativeHls) {
      video.src = playlistUrl;
      if (autoPlay) {
        // autoplay usually requires muted
        video.muted = true;
        const p = video.play();
        p?.catch(() => {
          // Autoplay blocked: user needs to click play
        });
      }
      return;
    }

    // Non-Safari: hls.js
    if (!Hls.isSupported()) {
      setPlayerError("HLS playback is not supported in this browser.");
      return;
    }

    const hls = new Hls({
      // These defaults are safe; you can tune later
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
    });

    hlsRef.current = hls;

    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data?.fatal) return;

      // Try to recover from common fatal errors
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          // Retry loading
          try {
            hls.startLoad();
          } catch {
            setPlayerError("Network error while loading the stream.");
          }
          break;

        case Hls.ErrorTypes.MEDIA_ERROR:
          try {
            hls.recoverMediaError();
          } catch {
            setPlayerError("Media error while playing the stream.");
          }
          break;

        default:
          setPlayerError("Playback error. Please refresh and try again.");
          try {
            hls.destroy();
          } catch {}
          hlsRef.current = null;
      }
    });

    hls.loadSource(playlistUrl);
    hls.attachMedia(video);

    if (autoPlay) {
      video.muted = true;
      const p = video.play();
      p?.catch(() => {
        // Autoplay blocked, user interaction required
      });
    }

    return () => {
      try {
        hls.destroy();
      } catch {}
      hlsRef.current = null;
    };
  }, [playlistUrl, isNativeHls, autoPlay]);

  return (
    <div className={className}>
      <video
        ref={videoRef}
        controls
        playsInline
        // recommended defaults for autoplay friendliness
        muted={autoPlay}
        style={{ width: "100%", borderRadius: 12, background: "black" }}
      />
      {playerError && (
        <div style={{ marginTop: 8, fontSize: 14 }}>
          <strong>Playback issue:</strong> {playerError}
        </div>
      )}
      {/* Optional: show status message */}
      {!playerError && status && status !== "live" && status !== "active" ? (
        <div style={{ marginTop: 8, fontSize: 14 }}>
          Preparing stream…
        </div>
      ) : null}
    </div>
  );
}
