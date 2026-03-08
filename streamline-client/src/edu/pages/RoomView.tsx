import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useEduMe } from "../layout/EduProtectedRoute";
import { apiFetchAuth } from "../../lib/api";
import { goLiveEduBroadcast, stopEduBroadcast, connectToEduRoom, type EduBroadcast, type GoLiveResponse } from "../api/broadcasts";
import { apiStartRecording, apiStopRecording } from "../../lib/api";
import type { Room as LkRoom, RemoteParticipant, RemoteTrackPublication, RemoteTrack } from "livekit-client";

/* ── Types ─────────────────────────────────────────────────────── */

type RoomType = "meeting" | "broadcast" | "hybrid";
type DefaultLayout = "grid" | "speaker" | "single" | "custom";

type Room = {
  id: string;
  name: string;
  description: string;
  roomType: RoomType;
  broadcastEnabled: boolean;
  recordingEnabled: boolean;
  defaultLayout: DefaultLayout;
};

type Participant = {
  id: string;
  name: string;
  isSelf: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  role: "host" | "producer" | "talent" | "participant";
};

/** State tracked per remote LiveKit participant */
type RemotePartState = {
  identity: string;
  name: string;
  videoTrack: RemoteTrack | null;
  audioTrack: RemoteTrack | null;
};

/** Renders a remote participant's video + audio, attaching tracks via refs */
function RemoteParticipantTile({ rp }: { rp: RemotePartState }) {
  const videoEl = useRef<HTMLVideoElement>(null);
  const audioEl = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (rp.videoTrack && videoEl.current) {
      (rp.videoTrack as any).attach(videoEl.current);
      return () => { try { (rp.videoTrack as any).detach(videoEl.current); } catch {} };
    }
  }, [rp.videoTrack]);

  useEffect(() => {
    if (rp.audioTrack && audioEl.current) {
      (rp.audioTrack as any).attach(audioEl.current);
      return () => { try { (rp.audioTrack as any).detach(audioEl.current); } catch {} };
    }
  }, [rp.audioTrack]);

  const initials = rp.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
      {rp.videoTrack ? (
        <video ref={videoEl} autoPlay playsInline className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-800 text-2xl font-bold text-white">
            {initials}
          </div>
        </div>
      )}
      {/* Hidden audio element for the remote participant */}
      <audio ref={audioEl} autoPlay />
      {/* Name badge */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-lg bg-black/60 px-2 py-1">
        {!rp.audioTrack && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 text-red-400">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
          </svg>
        )}
        <span className="text-xs text-white">{rp.name}</span>
      </div>
    </div>
  );
}

/* ── Component ─────────────────────────────────────────────────── */

export default function RoomView() {
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const me = useEduMe();
  const nav = useNavigate();

  const role = String(me?.orgRole || me?.role || "");
  const isProducer = role === "faculty_admin" || role === "faculty_teacher" || role === "student_producer" || role === "student_producer_assigned";

  // Device preferences from PreJoin
  const prefCam = searchParams.get("cam") || "";
  const prefMic = searchParams.get("mic") || "";
  const camOffPref = searchParams.get("camOff") === "1";
  const micOffPref = searchParams.get("micOff") === "1";

  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Local media state
  const [cameraOn, setCameraOn] = useState(!camOffPref);
  const [micOn, setMicOn] = useState(!micOffPref);
  const [screenSharing, setScreenSharing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [showStudio, setShowStudio] = useState(false);

  // Demo participants
  const [participants, setParticipants] = useState<Participant[]>([]);

  // Remote participants from LiveKit
  const [remoteParticipants, setRemoteParticipants] = useState<Map<string, RemotePartState>>(new Map());

  // Broadcast state
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [activeBroadcast, setActiveBroadcast] = useState<EduBroadcast | null>(null);
  const [roomAccessToken, setRoomAccessToken] = useState<string | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);

  // LiveKit connection state (established on room entry, before any broadcast)
  const [connectedRoomId, setConnectedRoomId] = useState<string | null>(null);
  const [livekitRoomName, setLivekitRoomName] = useState<string | null>(null);
  const [lkConnected, setLkConnected] = useState(false);

  // Recording state
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [activeRecordingId, setActiveRecordingId] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  // Local video
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // LiveKit room ref (created when connecting to the room)
  const lkRoomRef = useRef<LkRoom | null>(null);
  const intentionalDisconnectRef = useRef(false);

  // ── Load room ────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;

    (async () => {
      try {
        const res = await apiFetchAuth(`/api/edu/rooms/${roomId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setRoom(data.room);
        setParticipants([
          {
            id: "self",
            name: String(me?.displayName || "You"),
            isSelf: true,
            hasVideo: !camOffPref,
            hasAudio: !micOffPref,
            role: isProducer ? "producer" : "participant",
          },
        ]);
      } catch (e: any) {
        setError(e?.message || "Failed to load room");
      } finally {
        setLoading(false);
      }
    })();
  }, [roomId]);

  // ── Connect to LiveKit on room entry ─────────────────────────
  // Once the room metadata is loaded, call the connect endpoint to
  // get a LiveKit token and room-access token, then join the room.
  // This happens before any broadcast or recording is started.
  useEffect(() => {
    if (!room || !roomId || lkConnected || lkRoomRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        const conn = await connectToEduRoom(roomId);
        if (cancelled) return;
        setRoomAccessToken(conn.roomAccessToken);
        setConnectedRoomId(conn.roomId);
        setLivekitRoomName(conn.livekitRoomName);

        const { Room: LkRoomClass, RoomEvent, Track } = await import("livekit-client");
        if (cancelled) return;

        const lkRoom = new LkRoomClass({ adaptiveStream: true, dynacast: true });
        lkRoomRef.current = lkRoom;

        lkRoom.on(RoomEvent.Disconnected, () => {
          if (intentionalDisconnectRef.current) {
            intentionalDisconnectRef.current = false;
            return;
          }
          console.warn("[RoomView] LiveKit disconnected unexpectedly");
          lkRoomRef.current = null;
          setLkConnected(false);
          setBroadcastError("Connection lost — disconnected from room.");
        });

        await lkRoom.connect(conn.livekitUrl, conn.lkToken);
        if (cancelled) {
          lkRoom.disconnect();
          lkRoomRef.current = null;
          return;
        }

        // Stop local getUserMedia stream — LiveKit owns the devices now
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        if (localVideoRef.current) localVideoRef.current.srcObject = null;

        // Publish camera + mic via LiveKit
        const camOpts = prefCam ? { deviceId: prefCam } : {};
        const micOpts = prefMic ? { deviceId: prefMic } : {};
        if (cameraOn) await lkRoom.localParticipant.setCameraEnabled(true, camOpts);
        if (micOn) await lkRoom.localParticipant.setMicrophoneEnabled(true, micOpts);

        // Attach local video track to the preview element
        const camPub = lkRoom.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camPub?.track && localVideoRef.current) {
          camPub.track.attach(localVideoRef.current);
        }

        // ─── Remote participant handling ────────────────────────
        const buildState = (p: RemoteParticipant): RemotePartState => {
          let videoTrack: RemoteTrack | null = null;
          let audioTrack: RemoteTrack | null = null;
          for (const pub of p.trackPublications.values()) {
            if (pub.track && pub.source === Track.Source.Camera) videoTrack = pub.track as RemoteTrack;
            if (pub.track && pub.source === Track.Source.Microphone) audioTrack = pub.track as RemoteTrack;
            if (pub.track && pub.source === Track.Source.ScreenShare) videoTrack = pub.track as RemoteTrack;
          }
          return {
            identity: p.identity,
            name: p.name || p.identity || "Participant",
            videoTrack,
            audioTrack,
          };
        };

        const syncRemotes = () => {
          const next = new Map<string, RemotePartState>();
          for (const [, p] of lkRoom.remoteParticipants) {
            next.set(p.identity, buildState(p));
          }
          setRemoteParticipants(new Map(next));
          // Keep legacy participants list in sync
          setParticipants((prev) => {
            const self = prev.find((p) => p.isSelf);
            const remotes: Participant[] = [];
            for (const [, rp] of next) {
              remotes.push({
                id: rp.identity,
                name: rp.name,
                isSelf: false,
                hasVideo: !!rp.videoTrack,
                hasAudio: !!rp.audioTrack,
                role: "participant",
              });
            }
            return self ? [self, ...remotes] : remotes;
          });
        };

        lkRoom.on(RoomEvent.ParticipantConnected, syncRemotes);
        lkRoom.on(RoomEvent.ParticipantDisconnected, syncRemotes);
        lkRoom.on(RoomEvent.TrackSubscribed, syncRemotes);
        lkRoom.on(RoomEvent.TrackUnsubscribed, syncRemotes);
        lkRoom.on(RoomEvent.TrackMuted, syncRemotes);
        lkRoom.on(RoomEvent.TrackUnmuted, syncRemotes);

        // Sync any participants already in the room
        syncRemotes();

        setLkConnected(true);
      } catch (e: any) {
        console.error("[RoomView] LiveKit connect failed:", e?.message || e);
        // Non-fatal: local preview continues working via getUserMedia
      }
    })();

    return () => { cancelled = true; };
  }, [room, roomId]);

  // ── Start local camera (only when LiveKit is NOT connected) ──
  useEffect(() => {
    // Once LiveKit is connected, it owns camera/mic.
    // The toggle handlers use lkRoom.localParticipant directly.
    if (lkRoomRef.current) return;

    if (!cameraOn) {
      if (streamRef.current) {
        streamRef.current.getVideoTracks().forEach((t) => t.stop());
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const constraints: MediaStreamConstraints = {
          video: prefCam ? { deviceId: { exact: prefCam } } : true,
          audio: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch {
        // camera unavailable
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cameraOn, prefCam, lkConnected]);

  // ── Cleanup ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (lkRoomRef.current) {
        intentionalDisconnectRef.current = true;
        try { lkRoomRef.current.disconnect(); } catch {}
        lkRoomRef.current = null;
      }
    };
  }, []);

  // ── Leave room ───────────────────────────────────────────────
  const handleLeave = useCallback(async () => {
    // Stop recording first, then broadcast
    if (activeRecordingId && roomAccessToken) {
      try { await apiStopRecording(activeRecordingId, roomAccessToken); } catch { /* best effort */ }
    }
    // Disconnect LiveKit
    intentionalDisconnectRef.current = true;
    if (lkRoomRef.current) {
      try { lkRoomRef.current.disconnect(); } catch {}
      lkRoomRef.current = null;
    }
    if (activeBroadcast) {
      try { await stopEduBroadcast(activeBroadcast.id); } catch { /* best effort */ }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    nav("/streamline/edu/rooms");
  }, [nav, activeRecordingId, roomAccessToken, activeBroadcast]);

  // ── Camera / Mic toggle (LiveKit-aware) ──────────────────────
  const toggleCamera = useCallback(async () => {
    const next = !cameraOn;
    setCameraOn(next);
    if (lkRoomRef.current) {
      try {
        await lkRoomRef.current.localParticipant.setCameraEnabled(next);
      } catch { /* swallow */ }
    }
  }, [cameraOn]);

  const toggleMic = useCallback(async () => {
    const next = !micOn;
    setMicOn(next);
    if (lkRoomRef.current) {
      try {
        await lkRoomRef.current.localParticipant.setMicrophoneEnabled(next);
      } catch { /* swallow */ }
    }
  }, [micOn]);

  // ── Screen share toggle ──────────────────────────────────────
  const toggleScreenShare = useCallback(async () => {
    if (screenSharing) {
      setScreenSharing(false);
      return;
    }
    try {
      await navigator.mediaDevices.getDisplayMedia({ video: true });
      setScreenSharing(true);
    } catch {
      // user cancelled
    }
  }, [screenSharing]);

  // ── Start / Stop Broadcast ───────────────────────────────────
  // LiveKit connection is already established via the connect endpoint.
  // Go-live just starts HLS egress on the existing room.
  const handleStartBroadcast = useCallback(async () => {
    if (!room || broadcastBusy || activeBroadcast) return;
    setBroadcastBusy(true);
    setBroadcastError(null);
    try {
      const res = await goLiveEduBroadcast({
        title: room.name,
        templateId: "room",
        layout: room.defaultLayout === "grid" ? "grid" : "speaker",
        publishHls: true,
        recordMp4: room.recordingEnabled,
        assignedRoomId: room.id,
        existingRoomId: connectedRoomId,
        existingLivekitRoomName: livekitRoomName,
      });
      setActiveBroadcast(res.broadcast);
      // Update room access token with the one from go-live (same room, fresh token)
      if (res.roomAccessToken) setRoomAccessToken(res.roomAccessToken);
    } catch (e: any) {
      setBroadcastError(e?.message || "Failed to start broadcast");
    } finally {
      setBroadcastBusy(false);
    }
  }, [room, broadcastBusy, activeBroadcast, connectedRoomId, livekitRoomName]);

  const handleStopBroadcast = useCallback(async () => {
    if (!activeBroadcast || broadcastBusy) return;
    setBroadcastBusy(true);
    setBroadcastError(null);
    try {
      // Only stop HLS — keep the LiveKit connection alive for recording / future broadcasts
      await stopEduBroadcast(activeBroadcast.id);
      setActiveBroadcast(null);
    } catch (e: any) {
      setBroadcastError(e?.message || "Failed to stop broadcast");
    } finally {
      setBroadcastBusy(false);
    }
  }, [activeBroadcast, broadcastBusy]);

  // ── Start / Stop Recording ───────────────────────────────────
  // Recording is independent of broadcast. It only requires an active
  // LiveKit connection (established on room entry via /connect).
  const handleStartRecording = useCallback(async () => {
    if (recordingBusy || activeRecordingId) return;
    if (!connectedRoomId || !roomAccessToken) {
      setRecordingError("Not connected to room — please wait or refresh");
      return;
    }
    setRecordingBusy(true);
    setRecordingError(null);
    try {
      const data = await apiStartRecording(connectedRoomId, "cloud", undefined, roomAccessToken);
      setActiveRecordingId(data.recordingId || data.id || null);
    } catch (e: any) {
      setRecordingError(e?.message || "Failed to start recording");
    } finally {
      setRecordingBusy(false);
    }
  }, [recordingBusy, activeRecordingId, connectedRoomId, roomAccessToken]);

  const handleStopRecording = useCallback(async () => {
    if (!activeRecordingId || recordingBusy) return;
    setRecordingBusy(true);
    setRecordingError(null);
    try {
      await apiStopRecording(activeRecordingId, roomAccessToken);
      setActiveRecordingId(null);
    } catch (e: any) {
      setRecordingError(e?.message || "Failed to stop recording");
    } finally {
      setRecordingBusy(false);
    }
  }, [activeRecordingId, recordingBusy, roomAccessToken]);

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

  return (
    <div className="flex h-full flex-col">
      {/* ── Top Bar ──────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-900 px-4 py-2">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-white">{room.name}</h2>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
            {room.roomType.charAt(0).toUpperCase() + room.roomType.slice(1)}
          </span>
          <span className="text-xs text-slate-500">
            {participants.length} participant{participants.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {activeBroadcast && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> LIVE
            </span>
          )}
          {isProducer && room.broadcastEnabled && (
            <button
              onClick={() => setShowStudio((v) => !v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                showStudio
                  ? "bg-orange-500/20 text-orange-300"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              🎬 Studio Controls
            </button>
          )}
          <button
            onClick={handleLeave}
            className="rounded-lg bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-600/30"
          >
            Leave Room
          </button>
        </div>
      </div>

      {/* ── Main Area ────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Video grid area */}
        <div className="flex flex-1 flex-col min-h-0">
          {/* Participant video grid */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            <div className={`grid h-full gap-3 ${
              (1 + remoteParticipants.size) <= 1 ? "grid-cols-1" :
              (1 + remoteParticipants.size) <= 4 ? "grid-cols-2" :
              "grid-cols-3"
            }`}>
              {/* Self tile */}
              <div className="relative overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
                {cameraOn ? (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-800 text-2xl font-bold text-white">
                      {String(me?.displayName || "U")
                        .split(" ")
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((p) => p[0]?.toUpperCase())
                        .join("") || "U"}
                    </div>
                  </div>
                )}
                {/* Name badge */}
                <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-lg bg-black/60 px-2 py-1">
                  {!micOn && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 text-red-400">
                      <line x1="1" y1="1" x2="23" y2="23" />
                      <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
                    </svg>
                  )}
                  <span className="text-xs text-white">{me?.displayName || "You"} (You)</span>
                </div>
              </div>

              {/* Remote participants — real LiveKit tracks */}
              {Array.from(remoteParticipants.values()).map((rp) => (
                <RemoteParticipantTile key={rp.identity} rp={rp} />
              ))}
            </div>
          </div>

          {/* ── Bottom Control Bar ──────────────────────── */}
          <div className="flex items-center justify-center gap-3 border-t border-slate-700 bg-slate-900 px-4 py-3">
            {/* Camera toggle */}
            <button
              onClick={toggleCamera}
              className={`rounded-full p-3 transition ${
                cameraOn
                  ? "bg-slate-800 text-white hover:bg-slate-700"
                  : "bg-red-600 text-white hover:bg-red-500"
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

            {/* Mic toggle */}
            <button
              onClick={toggleMic}
              className={`rounded-full p-3 transition ${
                micOn
                  ? "bg-slate-800 text-white hover:bg-slate-700"
                  : "bg-red-600 text-white hover:bg-red-500"
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

            {/* Screen share */}
            <button
              onClick={toggleScreenShare}
              className={`rounded-full p-3 transition ${
                screenSharing
                  ? "bg-green-600 text-white hover:bg-green-500"
                  : "bg-slate-800 text-white hover:bg-slate-700"
              }`}
              title={screenSharing ? "Stop sharing" : "Share screen"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </button>

            {/* Chat */}
            <button
              onClick={() => setChatOpen((v) => !v)}
              className={`rounded-full p-3 transition ${
                chatOpen
                  ? "bg-orange-500/20 text-orange-300"
                  : "bg-slate-800 text-white hover:bg-slate-700"
              }`}
              title="Chat"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
            </button>

            {/* Separator */}
            <div className="mx-2 h-8 w-px bg-slate-700" />

            {/* Leave */}
            <button
              onClick={handleLeave}
              className="rounded-full bg-red-600 p-3 text-white transition hover:bg-red-500"
              title="Leave room"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Chat sidebar ───────────────────────────────── */}
        {chatOpen && (
          <div className="flex w-80 flex-col border-l border-slate-700 bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">Room Chat</h3>
              <button
                onClick={() => setChatOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="text-2xl">💬</div>
                <p className="mt-2 text-sm text-slate-400">
                  Chat messages will appear here.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  LiveKit data channels will power real-time chat.
                </p>
              </div>
            </div>
            <div className="border-t border-slate-700 p-3">
              <input
                placeholder="Type a message..."
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500"
              />
            </div>
          </div>
        )}

        {/* ── Studio Controls sidebar (producers only) ─── */}
        {showStudio && isProducer && (
          <div className="flex w-80 flex-col border-l border-slate-700 bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">🎬 Studio Controls</h3>
              <button
                onClick={() => setShowStudio(false)}
                className="text-slate-400 hover:text-white"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {/* Broadcast Controls */}
              <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Broadcast</h4>
                <div className="mt-3 space-y-2">
                  {activeBroadcast ? (
                    <button
                      onClick={handleStopBroadcast}
                      disabled={broadcastBusy}
                      className="w-full rounded-xl border border-red-500/30 bg-red-600/20 px-4 py-3 text-sm font-semibold text-red-300 transition hover:bg-red-600/30 disabled:opacity-50"
                    >
                      {broadcastBusy ? "Stopping…" : "⏹ Stop Broadcast"}
                    </button>
                  ) : (
                    <button
                      onClick={handleStartBroadcast}
                      disabled={broadcastBusy}
                      className="w-full rounded-xl bg-gradient-to-r from-red-600 to-red-700 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      {broadcastBusy ? "Starting…" : "📡 Start Broadcast"}
                    </button>
                  )}
                  {activeBroadcast && (
                    <div className="flex items-center justify-center gap-1.5 text-[11px] text-emerald-400">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                      HLS is live
                    </div>
                  )}
                  {!activeBroadcast && (
                    <p className="text-center text-[11px] text-slate-500">
                      Viewers will see the broadcast output
                    </p>
                  )}
                  {broadcastError && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
                      {broadcastError}
                    </div>
                  )}
                </div>
              </div>

              {/* Layout Switcher */}
              <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Layout</h4>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(["grid", "speaker", "single", "custom"] as const).map((l) => (
                    <button
                      key={l}
                      className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                        room.defaultLayout === l
                          ? "border-orange-500 bg-orange-500/10 text-orange-300"
                          : "border-slate-700 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {l === "grid" && "⊞ "}
                      {l === "speaker" && "👤 "}
                      {l === "single" && "🖥️ "}
                      {l === "custom" && "✨ "}
                      {l.charAt(0).toUpperCase() + l.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recording */}
              {room.recordingEnabled && (
                <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Recording</h4>
                  <div className="mt-3 space-y-2">
                    {activeRecordingId ? (
                      <button
                        onClick={handleStopRecording}
                        disabled={recordingBusy}
                        className="w-full rounded-xl border border-red-500/30 bg-red-600/20 px-4 py-2.5 text-sm font-semibold text-red-300 transition hover:bg-red-600/30 disabled:opacity-50"
                      >
                        {recordingBusy ? "Stopping…" : "⏹ Stop Recording"}
                      </button>
                    ) : (
                      <button
                        onClick={handleStartRecording}
                        disabled={recordingBusy || !lkConnected}
                        className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-slate-700 disabled:opacity-50"
                      >
                        {recordingBusy ? "Starting…" : "🔴 Start Recording"}
                      </button>
                    )}
                    {activeRecordingId && (
                      <div className="flex items-center justify-center gap-1.5 text-[11px] text-red-400">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                        Recording in progress
                      </div>
                    )}
                    {!lkConnected && !activeRecordingId && (
                      <p className="text-center text-[11px] text-slate-500">
                        Connecting to room…
                      </p>
                    )}
                    {recordingError && (
                      <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
                        {recordingError}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Participants management */}
              <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Participants ({participants.length})
                </h4>
                <div className="mt-3 space-y-2">
                  {participants.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg bg-slate-800/60 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-slate-700 text-[10px] font-bold leading-6 text-center text-white">
                          {p.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-xs text-white">
                          {p.name} {p.isSelf && "(You)"}
                        </span>
                      </div>
                      <span className="rounded-full bg-slate-700/60 px-1.5 py-0.5 text-[9px] text-slate-400">
                        {p.role}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* RTMP Outputs */}
              <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Outputs</h4>
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between rounded-lg bg-slate-800/60 px-3 py-2 text-xs text-slate-400">
                    <span>HLS Stream</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${activeBroadcast ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700/60"}`}>
                      {activeBroadcast ? "Live" : "Idle"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-slate-800/60 px-3 py-2 text-xs text-slate-400">
                    <span>YouTube RTMP</span>
                    <span className="rounded-full bg-slate-700/60 px-1.5 py-0.5 text-[9px]">Not configured</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
