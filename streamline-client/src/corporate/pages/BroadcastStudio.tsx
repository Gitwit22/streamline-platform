import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, Radio, Users, Loader2, Copy, Check, Square, Film,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { goLiveBroadcast, stopBroadcast, watchBroadcast, type GoLiveResponse } from "../api/broadcasts";
import { useCorporateMe } from "../layout/CorporateProtectedRoute";
import { isCorporateBypassEnabled } from "../state/corporateMode";

/**
 * BroadcastStudio — the host view for a live corporate broadcast.
 *
 * Flow:
 * 1. Calls go-live API → gets LiveKit token + HLS playlist URL
 * 2. Connects to LiveKit room and publishes camera/mic
 * 3. Shows live controls (mic, camera, screen share, stop)
 * 4. Displays share link for viewers
 */
export default function BroadcastStudio() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const bypass = isCorporateBypassEnabled();
  const me = useCorporateMe();
  const isAdmin = me?.orgRole === "owner" || me?.orgRole === "admin";

  // Employees cannot access the studio — redirect to watch page
  if (!bypass && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <Radio className="w-10 h-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold text-foreground">Access Restricted</h2>
        <p className="text-sm text-muted-foreground max-w-md">Only admins and owners can start or manage broadcasts. You can watch scheduled broadcasts from the Broadcasts page.</p>
        <button onClick={() => navigate("/streamline/corporate/broadcasts")} className="px-4 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold">Back to Broadcasts</button>
      </div>
    );
  }

  const [phase, setPhase] = useState<"init" | "connecting" | "live" | "ended" | "error">("init");
  const [error, setError] = useState<string | null>(null);
  const [goLiveData, setGoLiveData] = useState<GoLiveResponse | null>(null);

  // Media state
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenOn, setScreenOn] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Demo mode: 5-minute max broadcast
  const DEMO_MAX_BROADCAST_MS = 5 * 60 * 1000;

  // Pre-recorded media playback state
  const [mediaPlaying, setMediaPlaying] = useState(false);
  const [mediaFileName, setMediaFileName] = useState<string | null>(null);
  const [mediaProgress, setMediaProgress] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);

  // Refs for LiveKit
  const videoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const roomRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaTracksRef = useRef<any[]>([]);
  const mediaCleanupRef = useRef<(() => void) | null>(null);

  // Go live
  const handleGoLive = useCallback(async () => {
    if (!id) return;
    setPhase("connecting");
    setError(null);

    try {
      if (bypass) {
        // Demo mode: just show the studio UI with local camera
        setGoLiveData({
          broadcast: { id, title: "Demo Broadcast", description: "", team: "Demo", scope: "company-wide", status: "live", required: false, scheduledAt: null, startedAt: Date.now(), endedAt: null, viewers: 42, createdAt: Date.now(), createdBy: "" },
          lkToken: "demo",
          roomAccessToken: "demo",
          livekitUrl: "wss://demo.livekit.cloud",
          playlistUrl: null,
        });
        // Get local camera for preview
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          localStreamRef.current = stream;
          if (videoRef.current) videoRef.current.srcObject = stream;
        } catch {}
        startTimeRef.current = Date.now();
        setPhase("live");
        // Auto-stop after 5 minutes in demo mode
        demoTimerRef.current = setTimeout(() => handleStop(), DEMO_MAX_BROADCAST_MS);
        return;
      }

      const data = await goLiveBroadcast(id);
      setGoLiveData(data);

      // Connect to LiveKit room
      const { Room, RoomEvent, Track } = await import("livekit-client");
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;

      room.on(RoomEvent.ParticipantConnected, () => {
        setViewerCount(room.remoteParticipants.size);
      });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        setViewerCount(room.remoteParticipants.size);
      });

      await room.connect(data.livekitUrl, data.lkToken);

      // Publish local tracks
      await room.localParticipant.enableCameraAndMicrophone();

      // Attach local video to preview
      const camTrack = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (camTrack?.track && videoRef.current) {
        camTrack.track.attach(videoRef.current);
      }

      startTimeRef.current = Date.now();
      setPhase("live");
    } catch (err: any) {
      console.error("[BroadcastStudio] go-live error:", err);
      setError(err?.message || "Failed to go live");
      setPhase("error");
    }
  }, [id, bypass]);

  // Auto-go-live on mount
  useEffect(() => { handleGoLive(); }, [handleGoLive]);

  // Elapsed timer
  useEffect(() => {
    if (phase !== "live") return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  // Poll viewer count
  useEffect(() => {
    if (phase !== "live" || !id) return;
    if (bypass) {
      setViewerCount(42 + Math.floor(Math.random() * 20));
      return;
    }
    const interval = setInterval(async () => {
      try {
        const w = await watchBroadcast(id);
        setViewerCount(w.viewerCount);
      } catch {}
    }, 10_000);
    return () => clearInterval(interval);
  }, [phase, id, bypass]);

  // Stop broadcast
  const handleStop = useCallback(async () => {
    try {
      // Clean up any media playback
      mediaCleanupRef.current?.();
      mediaCleanupRef.current = null;
      if (mediaVideoRef.current) { mediaVideoRef.current.pause(); mediaVideoRef.current.removeAttribute("src"); }
      // Clear demo auto-stop timer
      if (demoTimerRef.current) { clearTimeout(demoTimerRef.current); demoTimerRef.current = null; }
      // Stop local media
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      // Disconnect from LiveKit
      if (roomRef.current) {
        try { roomRef.current.disconnect(); } catch {}
      }
      // Stop server-side
      if (id && !bypass) await stopBroadcast(id);
      setPhase("ended");
    } catch (err: any) {
      console.error("[BroadcastStudio] stop error:", err);
      setPhase("ended");
    }
  }, [id, bypass]);

  // Toggle mic
  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (room?.localParticipant) {
      await room.localParticipant.setMicrophoneEnabled(!micOn);
    }
    // Also toggle local stream tracks for bypass
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !micOn; });
    setMicOn(p => !p);
  }, [micOn]);

  // Toggle camera
  const toggleCam = useCallback(async () => {
    const room = roomRef.current;
    if (room?.localParticipant) {
      await room.localParticipant.setCameraEnabled(!camOn);
    }
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !camOn; });
    setCamOn(p => !p);
  }, [camOn]);

  // Toggle screen share
  const toggleScreen = useCallback(async () => {
    const room = roomRef.current;
    if (!room?.localParticipant) return;
    try {
      if (!screenOn) {
        await room.localParticipant.setScreenShareEnabled(true);
      } else {
        await room.localParticipant.setScreenShareEnabled(false);
      }
      setScreenOn(p => !p);
    } catch {}
  }, [screenOn]);

  // ── Pre-recorded media playback ──────────────────────────────────────

  const handlePlayMedia = () => fileInputRef.current?.click();

  const stopMedia = useCallback(async () => {
    mediaCleanupRef.current?.();
    mediaCleanupRef.current = null;
    const mediaEl = mediaVideoRef.current;
    if (mediaEl) { mediaEl.pause(); mediaEl.removeAttribute("src"); mediaEl.load(); }

    // Unpublish media tracks and restore camera/mic
    const room = roomRef.current;
    if (room?.localParticipant && !bypass) {
      for (const t of mediaTracksRef.current) {
        try { room.localParticipant.unpublishTrack(t, true); } catch {}
      }
      mediaTracksRef.current = [];
      await room.localParticipant.setCameraEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(true);
      try {
        const lk = await import("livekit-client");
        const camPub = room.localParticipant.getTrackPublication(lk.Track.Source.Camera);
        if (camPub?.track && videoRef.current) camPub.track.attach(videoRef.current);
      } catch {}
    }

    // Bypass: restore local stream
    if (bypass && localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = true; });
      localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = true; });
      if (videoRef.current) videoRef.current.srcObject = localStreamRef.current;
    }

    setMediaPlaying(false);
    setMediaFileName(null);
    setMediaProgress(0);
    setMediaDuration(0);
    setMicOn(true);
    setCamOn(true);
  }, [bypass]);

  const onFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || phase !== "live") return;
    e.target.value = "";

    const url = URL.createObjectURL(file);
    const mediaEl = mediaVideoRef.current;
    if (!mediaEl) { URL.revokeObjectURL(url); return; }

    setMediaFileName(file.name);
    mediaEl.src = url;

    try {
      await new Promise<void>((resolve, reject) => {
        mediaEl.onloadedmetadata = () => { setMediaDuration(mediaEl.duration); resolve(); };
        mediaEl.onerror = () => reject(new Error("Cannot load media file"));
      });
      await mediaEl.play();
    } catch (err) {
      console.error("[BroadcastStudio] media load error:", err);
      URL.revokeObjectURL(url);
      setMediaFileName(null);
      return;
    }

    // Register event listeners
    const onProgress = () => setMediaProgress(mediaEl.currentTime);
    const onEnded = () => { stopMedia(); };
    mediaEl.addEventListener("timeupdate", onProgress);
    mediaEl.addEventListener("ended", onEnded);
    mediaCleanupRef.current = () => {
      mediaEl.removeEventListener("timeupdate", onProgress);
      mediaEl.removeEventListener("ended", onEnded);
      URL.revokeObjectURL(url);
    };

    setMediaPlaying(true);

    // Publish media tracks to LiveKit room
    const room = roomRef.current;
    if (room?.localParticipant && !bypass) {
      try {
        await room.localParticipant.setCameraEnabled(false);
        await room.localParticipant.setMicrophoneEnabled(false);

        const stream: MediaStream | null =
          ("captureStream" in mediaEl) ? (mediaEl as any).captureStream() :
          ("mozCaptureStream" in mediaEl) ? (mediaEl as any).mozCaptureStream() : null;

        if (stream) {
          const lk = await import("livekit-client");
          const published: any[] = [];
          const vt = stream.getVideoTracks()[0];
          if (vt) {
            const lvt = new lk.LocalVideoTrack(vt);
            await room.localParticipant.publishTrack(lvt, { source: lk.Track.Source.Camera });
            published.push(lvt);
          }
          const at = stream.getAudioTracks()[0];
          if (at) {
            const lat = new lk.LocalAudioTrack(at);
            await room.localParticipant.publishTrack(lat, { source: lk.Track.Source.Microphone });
            published.push(lat);
          }
          mediaTracksRef.current = published;
        }
      } catch (err) { console.error("[BroadcastStudio] media publish error:", err); }
    }

    // Bypass: mute local stream so preview shows the media video
    if (bypass && localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = false; });
      localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
    }
  }, [phase, bypass, stopMedia]);

  // Copy watch link
  const viewerLink = id ? `${window.location.origin}/streamline/corporate/broadcasts/${id}/watch` : "";
  const handleCopy = () => {
    navigator.clipboard.writeText(viewerLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Format elapsed
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${m}:${String(sec).padStart(2, "0")}`;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mediaCleanupRef.current?.();
      if (mediaVideoRef.current) { mediaVideoRef.current.pause(); }
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      if (roomRef.current) { try { roomRef.current.disconnect(); } catch {} }
    };
  }, []);

  return (
    <div className="flex flex-col h-full animate-fade-in bg-surface">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/streamline/corporate/broadcasts")} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← Broadcasts
          </button>
          <div className="w-px h-5 bg-border" />
          <Radio className="w-4 h-4 text-sl-red" />
          <span className="text-sm font-semibold text-foreground">
            {goLiveData?.broadcast.title || "Broadcast Studio"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {phase === "live" && (
            <>
              <span className="flex items-center gap-1.5 text-[11px] font-semibold bg-sl-red-dim text-sl-red border border-sl-red/20 px-2.5 py-1 rounded-full">
                <span className="w-2 h-2 rounded-full bg-sl-red animate-pulse" /> LIVE
              </span>
              <span className="font-mono text-xs text-muted-foreground">{fmt(elapsed)}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="w-3.5 h-3.5" /> {viewerCount}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
        {/* Connecting */}
        {phase === "connecting" && (
          <div className="flex flex-col items-center gap-4 py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <div className="text-sm text-muted-foreground">Starting broadcast…</div>
          </div>
        )}

        {/* Error */}
        {phase === "error" && (
          <div className="flex flex-col items-center gap-4 py-20">
            <div className="text-sm text-sl-red">{error || "Failed to start broadcast"}</div>
            <button onClick={() => navigate("/streamline/corporate/broadcasts")} className="px-4 py-2 rounded-lg bg-surface-2 border border-border text-sm text-muted-foreground hover:text-foreground">
              Back to Broadcasts
            </button>
          </div>
        )}

        {/* Live Studio */}
        {phase === "live" && (
          <>
            {/* Video preview */}
            <div className="relative w-full max-w-3xl aspect-video bg-black rounded-2xl overflow-hidden border border-border shadow-lg">
              {/* Camera preview */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={cn("w-full h-full object-cover", mediaPlaying && "hidden")}
              />
              {/* Pre-recorded media preview */}
              <video
                ref={mediaVideoRef}
                playsInline
                className={cn("w-full h-full object-contain bg-black", !mediaPlaying && "hidden")}
              />
              {!camOn && !mediaPlaying && (
                <div className="absolute inset-0 flex items-center justify-center bg-surface-3">
                  <VideoOff className="w-10 h-10 text-muted-foreground/50" />
                </div>
              )}
              {/* Media progress overlay */}
              {mediaPlaying && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8">
                  <div className="flex items-center gap-2 text-white/90 text-xs">
                    <Film className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{mediaFileName}</span>
                    <span className="ml-auto font-mono whitespace-nowrap">{fmt(Math.floor(mediaProgress))} / {fmt(Math.floor(mediaDuration))}</span>
                  </div>
                  <div className="mt-1.5 h-1 bg-white/20 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-[width] duration-300" style={{ width: `${mediaDuration > 0 ? (mediaProgress / mediaDuration) * 100 : 0}%` }} />
                  </div>
                </div>
              )}
              {/* Live badge overlay */}
              <div className="absolute top-3 left-3 flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider bg-sl-red text-white px-2 py-0.5 rounded">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE
                </span>
                {mediaPlaying && (
                  <span className="text-[10px] font-bold tracking-wider bg-primary text-primary-foreground px-2 py-0.5 rounded">
                    MEDIA
                  </span>
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3">
              <button onClick={toggleMic} disabled={mediaPlaying} className={cn("w-11 h-11 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 disabled:pointer-events-none", micOn ? "bg-surface-2 border border-border text-foreground hover:bg-surface-3" : "bg-sl-red text-white")}>
                {micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </button>
              <button onClick={toggleCam} disabled={mediaPlaying} className={cn("w-11 h-11 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 disabled:pointer-events-none", camOn ? "bg-surface-2 border border-border text-foreground hover:bg-surface-3" : "bg-sl-red text-white")}>
                {camOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </button>
              <button onClick={toggleScreen} disabled={mediaPlaying} className={cn("w-11 h-11 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 disabled:pointer-events-none", screenOn ? "bg-primary text-primary-foreground" : "bg-surface-2 border border-border text-foreground hover:bg-surface-3")}>
                <MonitorUp className="w-5 h-5" />
              </button>
              {!mediaPlaying ? (
                <button onClick={handlePlayMedia} title="Play pre-recorded media" className="w-11 h-11 rounded-full flex items-center justify-center bg-surface-2 border border-border text-foreground hover:bg-surface-3 transition-colors">
                  <Film className="w-5 h-5" />
                </button>
              ) : (
                <button onClick={stopMedia} className="inline-flex items-center gap-1.5 px-4 h-11 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
                  <Square className="w-3.5 h-3.5 fill-current" /> Stop Media
                </button>
              )}
              <div className="w-px h-8 bg-border mx-2" />
              <button onClick={handleStop} className="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-sl-red text-white text-sm font-semibold hover:bg-sl-red/90 transition-colors">
                <Square className="w-4 h-4 fill-current" /> End Broadcast
              </button>
            </div>

            {/* Share link */}
            <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-lg px-4 py-2.5 max-w-lg">
              <span className="text-xs text-muted-foreground truncate flex-1">{viewerLink}</span>
              <button onClick={handleCopy} className="flex items-center gap-1 text-xs text-primary font-semibold hover:underline">
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </>
        )}

        {/* Ended */}
        {phase === "ended" && (
          <div className="flex flex-col items-center gap-4 py-20">
            <div className="w-14 h-14 rounded-full bg-surface-2 border border-border flex items-center justify-center">
              <Radio className="w-6 h-6 text-muted-foreground" />
            </div>
            <div className="text-lg font-semibold text-foreground">Broadcast Ended</div>
            <div className="text-sm text-muted-foreground">
              Duration: {fmt(elapsed)} · {viewerCount} viewer{viewerCount !== 1 ? "s" : ""}
            </div>
            <button onClick={() => navigate("/streamline/corporate/broadcasts")} className="px-5 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold mt-2">
              Back to Broadcasts
            </button>
          </div>
        )}

        {/* Init (shouldn't stay here long) */}
        {phase === "init" && (
          <div className="flex flex-col items-center gap-4 py-20">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <div className="text-sm text-muted-foreground">Preparing…</div>
          </div>
        )}
      </div>

      {/* Hidden file input for pre-recorded media */}
      <input ref={fileInputRef} type="file" accept="video/*,audio/*" onChange={onFileSelected} className="hidden" />
    </div>
  );
}
