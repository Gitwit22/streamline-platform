import { useCallback, useEffect, useRef, useState } from "react";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Loader2,
  X,
  Users,
} from "lucide-react";
import type { CallTokenResult } from "../api/callToken";

/* ── Lazy-loaded livekit-client types ────────────────────────── */
type LKRoom = import("livekit-client").Room;
type LKRemoteParticipant = import("livekit-client").RemoteParticipant;
type LKLocalParticipant = import("livekit-client").LocalParticipant;

interface Props {
  /** Function that returns the token — called on mount */
  getToken: () => Promise<CallTokenResult>;
  /** Display label (e.g. "Sarah Kim" or "#engineering") */
  label: string;
  /** Close the modal & disconnect */
  onClose: () => void;
}

interface ParticipantInfo {
  identity: string;
  name: string;
  isMuted: boolean;
  isCamOff: boolean;
  videoEl: HTMLVideoElement | null;
}

export default function CallModal({ getToken, label, onClose }: Props) {
  const roomRef = useRef<LKRoom | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  const [phase, setPhase] = useState<"connecting" | "connected" | "error">("connecting");
  const [error, setError] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);

  /* ── Disconnect helper ─────────────────────────────────────── */
  const disconnect = useCallback(() => {
    const room = roomRef.current;
    if (room) {
      try { room.disconnect(true); } catch {}
      roomRef.current = null;
    }
  }, []);

  /* ── Sync remote participants list ─────────────────────────── */
  const syncParticipants = useCallback((room: LKRoom) => {
    const list: ParticipantInfo[] = [];
    room.remoteParticipants.forEach((p: LKRemoteParticipant) => {
      list.push({
        identity: p.identity,
        name: p.name || p.identity,
        isMuted: !p.isMicrophoneEnabled,
        isCamOff: !p.isCameraEnabled,
        videoEl: null,
      });
    });
    setParticipants(list);
  }, []);

  /* ── Connect on mount ──────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { token, livekitUrl } = await getToken();
        if (cancelled) return;
        if (!livekitUrl) throw new Error("LiveKit URL not configured");

        const { Room, RoomEvent, Track } = await import("livekit-client");

        const room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;

        room.on(RoomEvent.ParticipantConnected, () => syncParticipants(room));
        room.on(RoomEvent.ParticipantDisconnected, () => syncParticipants(room));
        room.on(RoomEvent.TrackSubscribed, () => syncParticipants(room));
        room.on(RoomEvent.TrackUnsubscribed, () => syncParticipants(room));
        room.on(RoomEvent.TrackMuted, () => syncParticipants(room));
        room.on(RoomEvent.TrackUnmuted, () => syncParticipants(room));
        room.on(RoomEvent.Disconnected, () => {
          if (!cancelled) {
            setPhase("error");
            setError("Disconnected from call");
          }
        });

        await room.connect(livekitUrl, token);
        if (cancelled) { room.disconnect(true); return; }

        await room.localParticipant.enableCameraAndMicrophone();

        // Attach local camera preview
        const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camPub?.track && localVideoRef.current) {
          camPub.track.attach(localVideoRef.current);
        }

        startRef.current = Date.now();
        syncParticipants(room);
        setPhase("connected");
      } catch (err: any) {
        if (!cancelled) {
          console.error("[CallModal] connect error:", err);
          setError(err?.message || "Failed to connect");
          setPhase("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      disconnect();
    };
  }, [getToken, disconnect, syncParticipants]);

  /* ── Elapsed timer ─────────────────────────────────────────── */
  useEffect(() => {
    if (phase !== "connected") return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [phase]);

  /* ── Mic / cam toggles ─────────────────────────────────────── */
  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micOn;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  }, [micOn]);

  const toggleCam = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !camOn;
    await room.localParticipant.setCameraEnabled(next);
    setCamOn(next);
  }, [camOn]);

  /* ── Leave call ────────────────────────────────────────────── */
  const handleLeave = useCallback(() => {
    disconnect();
    onClose();
  }, [disconnect, onClose]);

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const initials = (name: string) =>
    (name || "?").split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[80] bg-black/70" />

      {/* Modal */}
      <div
        className="fixed inset-0 z-[81] flex items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && handleLeave()}
      >
        <div
          className="w-full max-w-[720px] rounded-2xl flex flex-col overflow-hidden animate-fade-in"
          style={{
            background: "hsl(218 35% 9%)",
            border: "1px solid hsl(215 35% 20%)",
            maxHeight: "85vh",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-3.5"
            style={{ borderBottom: "1px solid hsl(215 35% 20%)" }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Phone className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(142 60% 55%)" }} />
              <span className="text-sm font-semibold truncate" style={{ color: "#fff" }}>
                {label}
              </span>
              {phase === "connected" && (
                <span className="text-xs font-mono" style={{ color: "hsl(142 60% 55%)" }}>
                  {formatElapsed(elapsed)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {phase === "connected" && (
                <span
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                  style={{ background: "hsl(197 89% 66% / 0.12)", color: "hsl(197 89% 66%)" }}
                >
                  <Users className="w-3 h-3" /> {participants.length + 1}
                </span>
              )}
              <button
                onClick={handleLeave}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: "hsl(214 25% 55%)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "hsl(215 28% 18%)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5">
            {/* Connecting */}
            {phase === "connecting" && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(197 89% 66%)" }} />
                <span className="text-sm" style={{ color: "hsl(214 25% 60%)" }}>
                  Connecting to call…
                </span>
              </div>
            )}

            {/* Error */}
            {phase === "error" && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <PhoneOff className="w-6 h-6" style={{ color: "hsl(355 82% 65%)" }} />
                <span className="text-sm" style={{ color: "hsl(355 82% 65%)" }}>{error}</span>
                <button
                  onClick={handleLeave}
                  className="mt-2 text-xs px-4 py-2 rounded-lg"
                  style={{ background: "hsl(215 28% 18%)", border: "1px solid hsl(215 35% 20%)", color: "#fff" }}
                >
                  Close
                </button>
              </div>
            )}

            {/* Connected — video grid */}
            {phase === "connected" && (
              <div className="grid gap-3" style={{ gridTemplateColumns: participants.length === 0 ? "1fr" : "1fr 1fr" }}>
                {/* Local tile */}
                <div
                  className="relative rounded-xl overflow-hidden aspect-video flex items-center justify-center"
                  style={{ background: "hsl(218 35% 13%)", border: "1px solid hsl(215 35% 20%)" }}
                >
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ display: camOn ? "block" : "none" }}
                  />
                  {!camOn && (
                    <div
                      className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold"
                      style={{
                        background: "linear-gradient(135deg, hsl(215 35% 22%), hsl(215 28% 28%))",
                        color: "#fff",
                      }}
                    >
                      You
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/50">
                    <span className="text-[11px] font-medium" style={{ color: "#fff" }}>You</span>
                    {!micOn && <MicOff className="w-3 h-3" style={{ color: "hsl(355 82% 65%)" }} />}
                  </div>
                </div>

                {/* Remote tiles */}
                {participants.map((p) => (
                  <RemoteTile key={p.identity} info={p} roomRef={roomRef} />
                ))}
              </div>
            )}
          </div>

          {/* Controls bar */}
          {phase === "connected" && (
            <div
              className="flex items-center justify-center gap-3 px-5 py-4"
              style={{ borderTop: "1px solid hsl(215 35% 20%)" }}
            >
              <ControlBtn
                icon={micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                active={micOn}
                label={micOn ? "Mute" : "Unmute"}
                onClick={toggleMic}
              />
              <ControlBtn
                icon={camOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                active={camOn}
                label={camOn ? "Stop Video" : "Start Video"}
                onClick={toggleCam}
              />
              <button
                onClick={handleLeave}
                className="flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold transition-colors"
                style={{ background: "hsl(355 82% 50%)", color: "#fff" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "hsl(355 82% 58%)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "hsl(355 82% 50%)"; }}
              >
                <PhoneOff className="w-4 h-4" /> Leave
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Remote participant tile ─────────────────────────────────── */

function RemoteTile({
  info,
  roomRef,
}: {
  info: ParticipantInfo;
  roomRef: React.RefObject<LKRoom | null>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const room = roomRef.current;
    if (!room || !videoRef.current) return;
    const rp = room.remoteParticipants.get(info.identity);
    if (!rp) return;

    // Attach first video track
    for (const pub of rp.trackPublications.values()) {
      if (pub.track && pub.kind === "video" && videoRef.current) {
        pub.track.attach(videoRef.current);
        return;
      }
    }
  }, [info.identity, info.isCamOff, roomRef]);

  const initials = (info.name || "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

  return (
    <div
      className="relative rounded-xl overflow-hidden aspect-video flex items-center justify-center"
      style={{ background: "hsl(218 35% 13%)", border: "1px solid hsl(215 35% 20%)" }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
        style={{ display: info.isCamOff ? "none" : "block" }}
      />
      {info.isCamOff && (
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold"
          style={{
            background: "linear-gradient(135deg, hsl(215 35% 22%), hsl(215 28% 28%))",
            color: "#fff",
          }}
        >
          {initials}
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/50">
        <span className="text-[11px] font-medium" style={{ color: "#fff" }}>{info.name}</span>
        {info.isMuted && <MicOff className="w-3 h-3" style={{ color: "hsl(355 82% 65%)" }} />}
      </div>
    </div>
  );
}

/* ── Control button ──────────────────────────────────────────── */

function ControlBtn({
  icon,
  active,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex items-center justify-center w-12 h-12 rounded-full transition-colors"
      style={{
        background: active ? "hsl(215 28% 18%)" : "hsl(355 82% 50% / 0.2)",
        border: `1px solid ${active ? "hsl(215 35% 25%)" : "hsl(355 82% 50% / 0.4)"}`,
        color: active ? "#fff" : "hsl(355 82% 65%)",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = active ? "hsl(215 28% 22%)" : "hsl(355 82% 50% / 0.3)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = active ? "hsl(215 28% 18%)" : "hsl(355 82% 50% / 0.2)"; }}
    >
      {icon}
    </button>
  );
}
