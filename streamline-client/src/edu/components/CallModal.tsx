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

interface Props {
  /** Function that returns the token — called on mount */
  getToken: () => Promise<CallTokenResult>;
  /** Display label (e.g. "Dr. Smith" or "Jane Doe") */
  label: string;
  /** Close the modal & disconnect */
  onClose: () => void;
}

interface ParticipantInfo {
  identity: string;
  name: string;
  isMuted: boolean;
  isCamOff: boolean;
}

export default function EduCallModal({ getToken, label, onClose }: Props) {
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
          console.error("[EduCallModal] connect error:", err);
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
        <div className="w-full max-w-[720px] rounded-2xl flex flex-col overflow-hidden animate-fade-in bg-slate-950 border border-slate-700" style={{ maxHeight: "85vh" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700">
            <div className="flex items-center gap-3 min-w-0">
              <Phone className="w-4 h-4 flex-shrink-0 text-green-400" />
              <span className="text-sm font-semibold truncate text-white">
                {label}
              </span>
              {phase === "connected" && (
                <span className="text-xs font-mono text-green-400">
                  {formatElapsed(elapsed)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {phase === "connected" && (
                <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400">
                  <Users className="w-3 h-3" /> {participants.length + 1}
                </span>
              )}
              <button
                onClick={handleLeave}
                className="p-1.5 rounded-lg transition-colors text-slate-400 hover:bg-slate-800"
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
                <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
                <span className="text-sm text-slate-400">Connecting to call…</span>
              </div>
            )}

            {/* Error */}
            {phase === "error" && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <PhoneOff className="w-6 h-6 text-red-400" />
                <span className="text-sm text-red-400">{error}</span>
                <button
                  onClick={handleLeave}
                  className="mt-2 text-xs px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white hover:bg-slate-700 transition-colors"
                >
                  Close
                </button>
              </div>
            )}

            {/* Connected — video grid */}
            {phase === "connected" && (
              <div className="grid gap-3" style={{ gridTemplateColumns: participants.length === 0 ? "1fr" : "1fr 1fr" }}>
                {/* Local tile */}
                <div className="relative rounded-xl overflow-hidden aspect-video flex items-center justify-center bg-slate-900 border border-slate-700">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ display: camOn ? "block" : "none" }}
                  />
                  {!camOn && (
                    <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold bg-gradient-to-br from-slate-700 to-slate-600 text-white">
                      You
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/50">
                    <span className="text-[11px] font-medium text-white">You</span>
                    {!micOn && <MicOff className="w-3 h-3 text-red-400" />}
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
            <div className="flex items-center justify-center gap-3 px-5 py-4 border-t border-slate-700">
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
                className="flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-semibold bg-red-600 text-white hover:bg-red-500 transition-colors"
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
    <div className="relative rounded-xl overflow-hidden aspect-video flex items-center justify-center bg-slate-900 border border-slate-700">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
        style={{ display: info.isCamOff ? "none" : "block" }}
      />
      {info.isCamOff && (
        <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold bg-gradient-to-br from-slate-700 to-slate-600 text-white">
          {initials}
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/50">
        <span className="text-[11px] font-medium text-white">{info.name}</span>
        {info.isMuted && <MicOff className="w-3 h-3 text-red-400" />}
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
      className={`flex items-center justify-center w-12 h-12 rounded-full transition-colors border ${
        active
          ? "bg-slate-800 border-slate-600 text-white hover:bg-slate-700"
          : "bg-red-500/20 border-red-500/40 text-red-400 hover:bg-red-500/30"
      }`}
    >
      {icon}
    </button>
  );
}
