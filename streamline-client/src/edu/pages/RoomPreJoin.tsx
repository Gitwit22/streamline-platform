import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useEduMe } from "../layout/EduProtectedRoute";
import { isEduBypassEnabled } from "../state/eduMode";
import { DEMO_ROOMS } from "../state/demoData";
import { apiFetchAuth } from "../../lib/api";

/* ── Types ─────────────────────────────────────────────────────── */

type Room = {
  id: string;
  name: string;
  description: string;
  roomType: "meeting" | "broadcast" | "hybrid";
  broadcastEnabled: boolean;
  recordingEnabled: boolean;
};

/* ── Component ─────────────────────────────────────────────────── */

export default function RoomPreJoin() {
  const { roomId } = useParams<{ roomId: string }>();
  const me = useEduMe();
  const nav = useNavigate();
  const isDemo = isEduBypassEnabled();

  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Device state
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState("");
  const [selectedMic, setSelectedMic] = useState("");
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [micLevel, setMicLevel] = useState(0);
  const [joining, setJoining] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);

  // ── Load room info ───────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;

    if (isDemo) {
      const found = DEMO_ROOMS.find((r) => r.id === roomId);
      if (found) {
        setRoom({
          id: found.id,
          name: found.name,
          description: found.description,
          roomType: found.roomType,
          broadcastEnabled: found.broadcastEnabled,
          recordingEnabled: found.recordingEnabled,
        });
      } else {
        setError("Room not found");
      }
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const res = await apiFetchAuth(`/api/edu/rooms/${roomId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setRoom(data.room);
      } catch (e: any) {
        setError(e?.message || "Failed to load room");
      } finally {
        setLoading(false);
      }
    })();
  }, [roomId, isDemo]);

  // ── Enumerate devices ────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        // Request permissions first so labels appear
        await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((s) => {
          s.getTracks().forEach((t) => t.stop());
        });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === "videoinput");
        const ms = devices.filter((d) => d.kind === "audioinput");
        setCameras(cams);
        setMics(ms);
        if (cams.length) setSelectedCamera((prev) => prev || cams[0].deviceId);
        if (ms.length) setSelectedMic((prev) => prev || ms[0].deviceId);
      } catch {
        // user may have denied — that's fine, they can still enter audio-only
      }
    })();
  }, []);

  // ── Camera preview stream ────────────────────────────────────
  useEffect(() => {
    if (!cameraOn || !selectedCamera) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: selectedCamera } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        // camera unavailable
      }
    })();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [cameraOn, selectedCamera]);

  // ── Mic level meter ──────────────────────────────────────────
  useEffect(() => {
    if (!micOn || !selectedMic) {
      setMicLevel(0);
      return;
    }

    let audioCtx: AudioContext | null = null;
    let micStream: MediaStream | null = null;
    let cancelled = false;

    (async () => {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: selectedMic } },
          video: false,
        });
        if (cancelled) { micStream.getTracks().forEach((t) => t.stop()); return; }

        audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(micStream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        const buf = new Uint8Array(analyser.frequencyBinCount);
        function tick() {
          if (cancelled) return;
          analyser.getByteFrequencyData(buf);
          const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
          setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
          rafRef.current = requestAnimationFrame(tick);
        }
        tick();
      } catch {
        // mic unavailable
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      if (micStream) micStream.getTracks().forEach((t) => t.stop());
      if (audioCtx) audioCtx.close().catch(() => {});
      analyserRef.current = null;
      setMicLevel(0);
    };
  }, [micOn, selectedMic]);

  // ── Cleanup on unmount ───────────────────────────────────────
  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ── Join room ────────────────────────────────────────────────
  const handleJoin = useCallback(() => {
    if (!roomId) return;
    setJoining(true);

    // Stop preview streams before entering
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Navigate to the room view with device preferences
    const params = new URLSearchParams();
    if (selectedCamera) params.set("cam", selectedCamera);
    if (selectedMic) params.set("mic", selectedMic);
    if (!cameraOn) params.set("camOff", "1");
    if (!micOn) params.set("micOff", "1");

    nav(`/streamline/edu/rooms/${roomId}?${params.toString()}`);
  }, [roomId, selectedCamera, selectedMic, cameraOn, micOn, nav]);

  // ── Render ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-orange-500" />
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <div className="text-4xl">😕</div>
        <div className="text-lg font-semibold text-white">{error || "Room not found"}</div>
        <button
          onClick={() => nav("/streamline/edu/rooms")}
          className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          ← Back to Rooms
        </button>
      </div>
    );
  }

  const typeMeta: Record<string, { icon: string; color: string }> = {
    meeting: { icon: "👥", color: "text-blue-400" },
    broadcast: { icon: "📡", color: "text-red-400" },
    hybrid: { icon: "⚡", color: "text-purple-400" },
  };

  const tm = typeMeta[room.roomType] || typeMeta.meeting;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center gap-8 py-8">
      {/* Room info */}
      <div className="text-center">
        <span className={`inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold ${tm.color}`}>
          {tm.icon} {room.roomType.charAt(0).toUpperCase() + room.roomType.slice(1)}
        </span>
        <h1 className="mt-3 text-2xl font-bold text-white">{room.name}</h1>
        {room.description && (
          <p className="mt-1 text-sm text-slate-400">{room.description}</p>
        )}
      </div>

      {/* Camera + Mic preview card */}
      <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-900 p-6">
        {/* Video preview */}
        <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
          {cameraOn ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-950">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-800 text-2xl font-bold text-white">
                {String(me?.displayName || "U")
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((p) => p[0]?.toUpperCase())
                  .join("") || "U"}
              </div>
              <span className="text-sm text-slate-400">Camera off</span>
            </div>
          )}

          {/* Overlay controls on video */}
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
            <button
              onClick={() => setCameraOn((v) => !v)}
              className={`rounded-full p-2.5 transition ${
                cameraOn
                  ? "bg-slate-800/80 text-white hover:bg-slate-700/80"
                  : "bg-red-600/80 text-white hover:bg-red-500/80"
              }`}
              title={cameraOn ? "Turn off camera" : "Turn on camera"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                {cameraOn ? (
                  <>
                    <path d="M23 7l-7 5 7 5V7z" />
                    <rect x="1" y="5" width="15" height="14" rx="2" />
                  </>
                ) : (
                  <>
                    <path d="M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 012 2v3.34l1 1L23 7v10" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </>
                )}
              </svg>
            </button>
            <button
              onClick={() => setMicOn((v) => !v)}
              className={`rounded-full p-2.5 transition ${
                micOn
                  ? "bg-slate-800/80 text-white hover:bg-slate-700/80"
                  : "bg-red-600/80 text-white hover:bg-red-500/80"
              }`}
              title={micOn ? "Mute mic" : "Unmute mic"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                {micOn ? (
                  <>
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                    <path d="M19 10v2a7 7 0 01-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </>
                ) : (
                  <>
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
                    <path d="M17 16.95A7 7 0 015 12v-2m14 0v2c0 .76-.12 1.49-.34 2.17" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mic level bar */}
        {micOn && (
          <div className="mt-3">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>🎙️ Mic Level</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700">
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-75"
                  style={{ width: `${micLevel}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Device selectors */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Camera</label>
            <select
              value={selectedCamera}
              onChange={(e) => setSelectedCamera(e.target.value)}
              disabled={!cameraOn}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white disabled:opacity-40"
            >
              {cameras.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${cameras.indexOf(d) + 1}`}
                </option>
              ))}
              {cameras.length === 0 && <option>No cameras found</option>}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Microphone</label>
            <select
              value={selectedMic}
              onChange={(e) => setSelectedMic(e.target.value)}
              disabled={!micOn}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white disabled:opacity-40"
            >
              {mics.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Mic ${mics.indexOf(d) + 1}`}
                </option>
              ))}
              {mics.length === 0 && <option>No microphones found</option>}
            </select>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => nav("/streamline/edu/rooms")}
          className="rounded-xl border border-slate-700 px-6 py-3 text-sm text-slate-300 transition hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          onClick={handleJoin}
          disabled={joining}
          className="rounded-xl bg-gradient-to-r from-orange-500 to-red-600 px-8 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {joining ? "Joining..." : "Enter Room"}
        </button>
      </div>
    </div>
  );
}
