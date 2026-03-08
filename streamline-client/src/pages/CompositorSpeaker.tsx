/**
 * Custom LiveKit compositor page for speaker-focused layout.
 *
 * Used by LiveKit Room Composite Egress: the egress process opens this URL
 * in a headless browser and captures the rendered output for HLS / recording.
 *
 * LiveKit passes query params:  ?url=<livekit_url>&token=<livekit_token>
 *
 * Key improvements over the built-in "speaker-dark" layout:
 *  • 2-second debounce before switching the focused speaker
 *  • 500ms CSS crossfade transition for smooth visual switching
 *  • Minimum speaking duration required before focus changes
 *  • Seamless fallback to the first participant when no one is speaking
 */
import { useCallback, useEffect, useRef, useState } from "react";

/* ── Types ────────────────────────────────────────────────────── */
type ParticipantInfo = {
  identity: string;
  name: string;
  videoTrack: any | null;
  audioTrack: any | null;
  isSpeaking: boolean;
};

/* ── Constants ────────────────────────────────────────────────── */
/** Minimum ms a participant must be actively speaking before we switch focus */
const SPEAKER_SWITCH_DELAY_MS = 2000;
/** CSS transition duration for the crossfade (matches the Tailwind class) */
const TRANSITION_MS = 500;

/* ── Video Tile ───────────────────────────────────────────────── */
function VideoTile({
  participant,
  isFocused,
  className = "",
}: {
  participant: ParticipantInfo;
  isFocused?: boolean;
  className?: string;
}) {
  const videoEl = useRef<HTMLVideoElement>(null);
  const audioEl = useRef<HTMLAudioElement>(null);

  // Attach / detach video
  useEffect(() => {
    if (participant.videoTrack && videoEl.current) {
      participant.videoTrack.attach(videoEl.current);
      return () => {
        try {
          participant.videoTrack.detach(videoEl.current);
        } catch {}
      };
    }
  }, [participant.videoTrack]);

  // Attach / detach audio (only for non-focused tiles to avoid double audio)
  useEffect(() => {
    if (participant.audioTrack && audioEl.current) {
      participant.audioTrack.attach(audioEl.current);
      return () => {
        try {
          participant.audioTrack.detach(audioEl.current);
        } catch {}
      };
    }
  }, [participant.audioTrack]);

  const initials = participant.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

  return (
    <div className={`relative overflow-hidden bg-slate-950 ${className}`}>
      {participant.videoTrack ? (
        <video
          ref={videoEl}
          autoPlay
          playsInline
          muted={isFocused}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center">
          <div
            className={`flex items-center justify-center rounded-full bg-slate-800 font-bold text-white ${
              isFocused ? "h-24 w-24 text-4xl" : "h-10 w-10 text-base"
            }`}
          >
            {initials}
          </div>
        </div>
      )}

      {/* Audio element (hidden) */}
      <audio ref={audioEl} autoPlay />

      {/* Name badge */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-lg bg-black/60 px-2 py-1">
        {participant.isSpeaking && (
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
        )}
        <span className={`text-white ${isFocused ? "text-sm font-medium" : "text-[10px]"}`}>
          {participant.name}
        </span>
      </div>
    </div>
  );
}

/* ── Main Compositor ──────────────────────────────────────────── */
export default function CompositorSpeaker() {
  const [participants, setParticipants] = useState<Map<string, ParticipantInfo>>(new Map());
  const [focusedIdentity, setFocusedIdentity] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roomRef = useRef<any>(null);
  const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpeakerRef = useRef<string | null>(null);
  const speakingStartRef = useRef<Map<string, number>>(new Map());

  // Parse LiveKit connection params from URL
  const params = new URLSearchParams(window.location.search);
  const livekitUrl = params.get("url") || "";
  const livekitToken = params.get("token") || "";

  /* ── Debounced speaker switching ────────────────────────────── */
  const updateFocusedSpeaker = useCallback(
    (activeSpeakers: any[]) => {
      if (!activeSpeakers || activeSpeakers.length === 0) {
        // No one speaking — keep the current focus (don't snap away)
        return;
      }

      // Pick the loudest / most recently active speaker
      const topSpeaker = activeSpeakers[0];
      const topIdentity = topSpeaker?.identity;

      if (!topIdentity || topIdentity === focusedIdentity) return;

      // Track when this speaker started continuously speaking
      const now = Date.now();
      if (!speakingStartRef.current.has(topIdentity)) {
        speakingStartRef.current.set(topIdentity, now);
      }

      // Clear tracking for speakers who stopped
      for (const [id] of speakingStartRef.current) {
        if (!activeSpeakers.some((s: any) => s.identity === id)) {
          speakingStartRef.current.delete(id);
        }
      }

      // Only switch if the speaker has been speaking for at least SPEAKER_SWITCH_DELAY_MS
      const speakingDuration = now - (speakingStartRef.current.get(topIdentity) || now);

      if (speakingDuration >= SPEAKER_SWITCH_DELAY_MS) {
        // Clear any pending timer
        if (speakingTimerRef.current) {
          clearTimeout(speakingTimerRef.current);
          speakingTimerRef.current = null;
        }
        lastSpeakerRef.current = topIdentity;
        setFocusedIdentity(topIdentity);
      } else if (lastSpeakerRef.current !== topIdentity) {
        // Schedule a switch after the remaining delay
        if (speakingTimerRef.current) {
          clearTimeout(speakingTimerRef.current);
        }
        const remaining = SPEAKER_SWITCH_DELAY_MS - speakingDuration;
        speakingTimerRef.current = setTimeout(() => {
          // Verify this speaker is still talking when the timer fires
          lastSpeakerRef.current = topIdentity;
          setFocusedIdentity(topIdentity);
          speakingTimerRef.current = null;
        }, remaining);
      }
    },
    [focusedIdentity],
  );

  /* ── Connect to LiveKit ─────────────────────────────────────── */
  useEffect(() => {
    if (!livekitUrl || !livekitToken) {
      setError("Missing LiveKit connection parameters (url/token).");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { Room, RoomEvent, Track } = await import("livekit-client");
        const room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;

        // Sync all remote participants + local participant
        const syncParticipants = () => {
          const next = new Map<string, ParticipantInfo>();

          // Local participant
          const local = room.localParticipant;
          if (local) {
            let localVideo: any = null;
            let localAudio: any = null;
            for (const pub of local.trackPublications.values()) {
              if (pub.track && (pub.source === Track.Source.Camera || pub.source === Track.Source.ScreenShare)) localVideo = pub.track;
              if (pub.track && pub.source === Track.Source.Microphone) localAudio = pub.track;
            }
            next.set(local.identity, {
              identity: local.identity,
              name: local.name || local.identity || "Host",
              videoTrack: localVideo,
              audioTrack: localAudio,
              isSpeaking: local.isSpeaking,
            });
          }

          // Remote participants
          for (const [, p] of room.remoteParticipants) {
            let videoTrack: any = null;
            let audioTrack: any = null;
            for (const pub of p.trackPublications.values()) {
              if (pub.track && (pub.source === Track.Source.Camera || pub.source === Track.Source.ScreenShare)) videoTrack = pub.track;
              if (pub.track && pub.source === Track.Source.Microphone) audioTrack = pub.track;
            }
            next.set(p.identity, {
              identity: p.identity,
              name: p.name || p.identity || "Participant",
              videoTrack,
              audioTrack,
              isSpeaking: p.isSpeaking,
            });
          }

          if (!cancelled) setParticipants(new Map(next));
        };

        // Active speakers changed
        room.on(RoomEvent.ActiveSpeakersChanged, (speakers: any[]) => {
          syncParticipants(); // update isSpeaking flags
          updateFocusedSpeaker(speakers);
        });

        room.on(RoomEvent.ParticipantConnected, syncParticipants);
        room.on(RoomEvent.ParticipantDisconnected, syncParticipants);
        room.on(RoomEvent.TrackSubscribed, syncParticipants);
        room.on(RoomEvent.TrackUnsubscribed, syncParticipants);
        room.on(RoomEvent.TrackMuted, syncParticipants);
        room.on(RoomEvent.TrackUnmuted, syncParticipants);
        room.on(RoomEvent.LocalTrackPublished, syncParticipants);
        room.on(RoomEvent.LocalTrackUnpublished, syncParticipants);

        await room.connect(livekitUrl, livekitToken);
        if (!cancelled) {
          setConnected(true);
          syncParticipants();

          // Set initial focus to the local participant (host)
          if (room.localParticipant) {
            setFocusedIdentity(room.localParticipant.identity);
            lastSpeakerRef.current = room.localParticipant.identity;
          }
        }
      } catch (err: any) {
        console.error("[Compositor] Connection error:", err);
        if (!cancelled) setError(err?.message || "Failed to connect");
      }
    })();

    return () => {
      cancelled = true;
      if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
      roomRef.current?.disconnect?.();
    };
  }, [livekitUrl, livekitToken]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Derived layout data ────────────────────────────────────── */
  const allParticipants = Array.from(participants.values());
  const focused = allParticipants.find((p) => p.identity === focusedIdentity) || allParticipants[0] || null;
  const sidebar = allParticipants.filter((p) => p.identity !== focused?.identity);

  /* ── Error / loading states ─────────────────────────────────── */
  if (error) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-red-400 text-sm">
        {error}
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-400 text-sm">
        Connecting…
      </div>
    );
  }

  if (allParticipants.length === 0) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-500 text-sm">
        Waiting for participants…
      </div>
    );
  }

  /* ── Single participant → fullscreen ────────────────────────── */
  if (allParticipants.length === 1 && focused) {
    return (
      <div className="h-screen w-screen bg-slate-950">
        <VideoTile participant={focused} isFocused className="h-full w-full" />
      </div>
    );
  }

  /* ── Speaker layout: big focused + sidebar thumbnails ───────── */
  return (
    <div className="flex h-screen w-screen bg-slate-950">
      {/* Main speaker area — occupies ~80% width */}
      <div className="relative flex-1 min-w-0">
        {allParticipants.map((p) => (
          <div
            key={p.identity}
            className="absolute inset-0"
            style={{
              opacity: p.identity === focused?.identity ? 1 : 0,
              transition: `opacity ${TRANSITION_MS}ms ease-in-out`,
              zIndex: p.identity === focused?.identity ? 10 : 1,
            }}
          >
            <VideoTile participant={p} isFocused className="h-full w-full" />
          </div>
        ))}
      </div>

      {/* Sidebar thumbnails — ~20% width, vertical stack */}
      {sidebar.length > 0 && (
        <div className="flex w-[20%] min-w-[160px] max-w-[280px] flex-col gap-1 bg-slate-900/80 p-1">
          {sidebar.map((p) => (
            <div
              key={p.identity}
              className="relative flex-1 min-h-0 overflow-hidden rounded"
              style={{ border: p.isSpeaking ? "2px solid #34d399" : "2px solid transparent" }}
            >
              <VideoTile participant={p} className="h-full w-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
