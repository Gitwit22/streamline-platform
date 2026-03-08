import React from "react";
import { getFeatureErrorMessage } from "../lib/featureErrors";
import { useEffect, useState, useRef, useMemo } from "react";
import { logAuthDebugContext } from "../lib/logAuthDebug";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { API_BASE } from "../lib/apiBase";
import { APP_BASE } from "../lib/appBase";
import {
  LiveKitRoom,
  useRoomContext,
  useLocalParticipant,
  useLocalParticipantPermissions,
  useParticipants,
} from "@livekit/components-react";
import { RoomEvent, Track, ConnectionState } from "livekit-client";
import {
  apiStartRecording,
  apiStopRecording,
  apiFetch,
  apiFetchAuth,
  getAuthToken,
} from "../lib/api";
import { logTelemetry, markTiming, measureTiming } from "../lib/telemetry";
import RoleOverlay from "../components/RoleOverlay";
import StreamSetupModalV2 from "../components/StreamSetupModal";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { RoleChangeToast } from "../components/RoleChangeToast";
import SafeVideoConference from "../components/SafeVideoConference";
import { useEffectiveEntitlements } from "../hooks/useEffectiveEntitlements";
import { useFeatureAccess } from "../hooks/useFeatureAccess";
import { useHlsStatus } from "../hooks/useHlsStatus";
import { normalizeStartLivePayloadFromDestinationsKeys } from "../hooks/useDestinationsStartPayload";
import {
  RECONNECT_MEDIA_MESSAGE_TYPE,
  reconnectMedia,
  tryParseLiveKitDataMessage,
} from "../lib/mediaRecovery";
import { setPlatformFlagsValue } from "../lib/platformFlagsStore";
import { fetchDestinations, preflight, type DestinationItem } from "../services/destinations";

const DEV_CONTROLS = import.meta.env.VITE_DEV_CONTROLS === "1";

// Telemetry tracker for measuring guest invite flow performance
function GuestTelemetryTracker({ roomId, isViewer }: { roomId: string | null; isViewer: boolean }) {
  const room = useRoomContext();
  const [guestSessionToken] = useState(() => getGuestSessionToken(roomId));
  const [hasLoggedJoinSuccess, setHasLoggedJoinSuccess] = useState(false);
  const [hasLoggedFirstVideo, setHasLoggedFirstVideo] = useState(false);

  // Track when viewer lands in room (mark timing start)
  useEffect(() => {
    if (!isViewer || !roomId || !guestSessionToken) return;
    
    const timingKey = `viewer_first_video:${roomId}`;
    markTiming(timingKey);
    console.log('[Telemetry] Marking timing start for viewer join:', roomId);

    return () => {
      // Cleanup timing mark if component unmounts without video
      measureTiming(timingKey);
    };
  }, [isViewer, roomId, guestSessionToken]);

  // Track viewer_join_success when connected to LiveKit
  useEffect(() => {
    if (!room || !isViewer || !roomId || !guestSessionToken || hasLoggedJoinSuccess) return;

    const onConnected = () => {
      console.log('[Telemetry] Viewer connected successfully');
      logTelemetry({
        event: "viewer_join_success",
        roomId,
        guestSessionToken,
      });
      setHasLoggedJoinSuccess(true);
    };

    if (room.state === 'connected') {
      onConnected();
    }

    room.on(RoomEvent.Connected, onConnected);

    return () => {
      room.off(RoomEvent.Connected, onConnected);
    };
  }, [room, isViewer, roomId, guestSessionToken, hasLoggedJoinSuccess]);

  // Track viewer_first_video_track_ms when first video track is subscribed
  useEffect(() => {
    if (!room || !isViewer || !roomId || !guestSessionToken || hasLoggedFirstVideo) return;

    const timingKey = `viewer_first_video:${roomId}`;

    const onTrackSubscribed = (track: any, publication: any, participant: any) => {
      // Only care about video tracks
      if (track.kind !== 'video') return;

      const durationMs = measureTiming(timingKey);
      if (durationMs === null) {
        console.warn('[Telemetry] No timing mark found for first video track');
        return;
      }

      console.log('[Telemetry] First video track subscribed', {
        durationMs,
        participantIdentity: participant.identity,
      });

      logTelemetry({
        event: "viewer_first_video_track_ms",
        roomId,
        durationMs,
        guestSessionToken,
      });

      setHasLoggedFirstVideo(true);
    };

    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);

    return () => {
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
    };
  }, [room, isViewer, roomId, guestSessionToken, hasLoggedFirstVideo]);

  return null;
}

// Comprehensive LiveKit video debugging logger
function LiveKitDebugLogger() {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    if (!room) return;

    console.log('[LiveKit] Room context initialized', {
      roomName: room.name,
      state: room.state,
      numParticipants: room.remoteParticipants.size,
    });

    const onStateChanged = (state: ConnectionState) => {
      console.log('[LiveKit] Room state changed:', state, {
        roomName: room.name,
        localIdentity: localParticipant?.identity,
        numRemoteParticipants: room.remoteParticipants.size,
      });
    };

    const onConnected = () => {
      console.log('[LiveKit] ✅ Room connected successfully', {
        roomName: room.name,
        serverUrl: room.engine?.client?.url,
        localIdentity: localParticipant?.identity,
      });
    };

    const onDisconnected = () => {
      console.log('[LiveKit] ❌ Room disconnected', {
        roomName: room.name,
      });
    };

    const onLocalTrackPublished = (publication: any) => {
      console.log('[LiveKit] 🎥 Local track published', {
        kind: publication.kind,
        source: publication.source,
        trackSid: publication.trackSid,
        muted: publication.isMuted,
        enabled: publication.track?.isEnabled,
      });
    };

    const onLocalTrackUnpublished = (publication: any) => {
      console.log('[LiveKit] Local track unpublished', {
        kind: publication.kind,
        source: publication.source,
      });
    };

    const onParticipantConnected = (participant: any) => {
      console.log('[LiveKit] 👤 Remote participant connected', {
        identity: participant.identity,
        sid: participant.sid,
        totalRemote: room.remoteParticipants.size,
      });
    };

    const onParticipantDisconnected = (participant: any) => {
      console.log('[LiveKit] 👤 Remote participant disconnected', {
        identity: participant.identity,
        totalRemote: room.remoteParticipants.size,
      });
    };

    const onTrackSubscribed = (track: any, publication: any, participant: any) => {
      console.log('[LiveKit] 📹 Track subscribed', {
        kind: track.kind,
        source: publication.source,
        trackSid: track.sid,
        participantIdentity: participant.identity,
        muted: track.isMuted,
        enabled: track.isEnabled,
      });
    };

    const onTrackUnsubscribed = (track: any, publication: any, participant: any) => {
      console.log('[LiveKit] Track unsubscribed', {
        kind: track.kind,
        participantIdentity: participant.identity,
      });
    };

    const onTrackMuted = (publication: any, participant: any) => {
      console.log('[LiveKit] Track muted', {
        kind: publication.kind,
        participantIdentity: participant.identity,
      });
    };

    const onTrackUnmuted = (publication: any, participant: any) => {
      console.log('[LiveKit] Track unmuted', {
        kind: publication.kind,
        participantIdentity: participant.identity,
      });
    };

    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.ConnectionStateChanged, onStateChanged);
    room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.on(RoomEvent.TrackMuted, onTrackMuted);
    room.on(RoomEvent.TrackUnmuted, onTrackUnmuted);

    // Periodic state summary (every 5 seconds)
    const summaryInterval = setInterval(() => {
      const localTracks = Array.from(localParticipant?.trackPublications?.values() || []);
      const remoteParts = Array.from(room.remoteParticipants.values());
      
      console.log('[LiveKit] 📊 State Summary:', {
        roomState: room.state,
        localIdentity: localParticipant?.identity,
        localPublishedTracks: localTracks.length,
        localVideoPublished: localTracks.some((t: any) => t.kind === 'video'),
        localAudioPublished: localTracks.some((t: any) => t.kind === 'audio'),
        remoteParticipants: remoteParts.length,
        remoteParticipantsWithVideo: remoteParts.filter(p => 
          Array.from(p.videoTracks.values()).some((t: any) => t.isSubscribed)
        ).length,
        videoElementsInDOM: document.querySelectorAll('video').length,
      });
    }, 5000);

    return () => {
      clearInterval(summaryInterval);
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.ConnectionStateChanged, onStateChanged);
      room.off(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
      room.off(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.off(RoomEvent.TrackMuted, onTrackMuted);
      room.off(RoomEvent.TrackUnmuted, onTrackUnmuted);
    };
  }, [room, localParticipant]);

  return null;
}

// Monitor video elements to track when they're attached and playing
function VideoElementMonitor() {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;

    const observer = new MutationObserver(() => {
      const videoElements = document.querySelectorAll('video');
      
      if (videoElements.length > 0) {
        console.log('[Video] 📺 Video elements found:', videoElements.length);
        
        videoElements.forEach((video, idx) => {
          const hasStream = !!video.srcObject;
          const isPlaying = !video.paused && video.currentTime > 0 && !video.ended && video.readyState > 2;
          
          console.log(`[Video] Element ${idx}:`, {
            hasStream,
            paused: video.paused,
            muted: video.muted,
            playsInline: video.playsInline,
            readyState: video.readyState, // 0=nothing, 1=metadata, 2=current, 3=future, 4=enough
            networkState: video.networkState, // 0=empty, 1=idle, 2=loading, 3=no_source
            width: video.videoWidth,
            height: video.videoHeight,
            isPlaying,
          });

          // Add event listeners to track playback
          if (!video.hasAttribute('data-monitored')) {
            video.setAttribute('data-monitored', 'true');
            
            video.addEventListener('loadedmetadata', () => {
              console.log(`[Video] ${idx} metadata loaded:`, {
                width: video.videoWidth,
                height: video.videoHeight,
                duration: video.duration,
              });
            });

            video.addEventListener('play', () => {
              console.log(`[Video] ${idx} ▶️ started playing`);
            });

            video.addEventListener('pause', () => {
              console.log(`[Video] ${idx} ⏸️ paused`);
            });

            video.addEventListener('error', (e) => {
              console.error(`[Video] ${idx} ❌ error:`, {
                error: video.error,
                code: video.error?.code,
                message: video.error?.message,
              });
            });
          }
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Initial check
    setTimeout(() => {
      const videos = document.querySelectorAll('video');
      if (videos.length > 0) {
        console.log('[Video] Initial scan found', videos.length, 'video elements');
      } else {
        console.log('[Video] ⚠️ No video elements found yet');
      }
    }, 1000);

    return () => {
      observer.disconnect();
    };
  }, [room]);

  return null;
}

// Shows banner when guest is connected to LiveKit but waiting for host to join
function WaitingForHostBanner({ isViewer }: { isViewer: boolean }) {
  const room = useRoomContext();
  const participants = useParticipants();
  const [isConnected, setIsConnected] = useState(false);
  const [hasRemoteVideoTrack, setHasRemoteVideoTrack] = useState(false);

  useEffect(() => {
    if (!room) return;

    const onConnected = () => setIsConnected(true);
    const onDisconnected = () => setIsConnected(false);

    if (room.state === 'connected') {
      setIsConnected(true);
    }

    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Disconnected, onDisconnected);

    return () => {
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room]);

  // Track-driven: Check for actual video/screen tracks, not just participants
  useEffect(() => {
    if (!room) return;

    const checkRemoteTracks = () => {
      const remoteParticipants = Array.from(room.remoteParticipants.values());
      const hasVideo = remoteParticipants.some(p => {
        // Check for camera video tracks
        const videoTracks = Array.from(p.videoTrackPublications.values());
        const hasVideoTrack = videoTracks.some(pub => pub.isSubscribed && pub.track);
        
        // Check for screen share tracks
        const screenTracks = Array.from(p.videoTrackPublications.values());
        const hasScreenTrack = screenTracks.some(pub => 
          pub.isSubscribed && pub.track && pub.source === 'screen_share'
        );
        
        return hasVideoTrack || hasScreenTrack;
      });
      
      setHasRemoteVideoTrack(hasVideo);
    };

    // Initial check
    checkRemoteTracks();

    // Listen for track subscriptions
    const onTrackSubscribed = () => checkRemoteTracks();
    const onTrackUnsubscribed = () => checkRemoteTracks();
    const onParticipantConnected = () => checkRemoteTracks();
    const onParticipantDisconnected = () => checkRemoteTracks();

    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

    return () => {
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    };
  }, [room]);

  // Show banner when:
  // 1. User is a viewer
  // 2. Connected to LiveKit
  // 3. No remote video tracks (host not sharing video yet)
  const shouldShow = isViewer && isConnected && !hasRemoteVideoTrack;

  if (!shouldShow) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '10px 20px',
        borderRadius: 999,
        background: 'rgba(15,23,42,0.95)',
        border: '1px solid rgba(251,191,36,0.6)',
        fontSize: 14,
        color: '#fbbf24',
        zIndex: 20,
        pointerEvents: 'none',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span style={{ fontSize: 16 }}>⏳</span>
      <span>Connected — waiting for host to join...</span>
    </div>
  );
}

function MediaPermissionErrorBanner({ 
  error,
  onDismiss
}: { 
  error: { type: 'denied' | 'notFound' | 'notReadable' | 'notSupported' | 'inAppBrowser' | null; message: string } | null;
  onDismiss: () => void;
}) {
  if (!error) return null;

  const handleOpenInBrowser = () => {
    const currentUrl = window.location.href;
    // For Android: try to open in Chrome via intent
    if (/Android/i.test(navigator.userAgent)) {
      // Try Chrome intent URL
      window.location.href = `googlechrome://navigate?url=${encodeURIComponent(currentUrl)}`;
      // Fallback after delay if Chrome not installed
      setTimeout(() => {
        window.open(currentUrl, '_blank');
      }, 1500);
    } else {
      // For iOS: copy URL and show instructions (can't force open in Safari)
      navigator.clipboard.writeText(currentUrl).then(() => {
        alert('Link copied! Open Safari and paste this link to continue.');
      }).catch(() => {
        alert(`Copy this link and open in Safari:\n\n${currentUrl}`);
      });
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: '90%',
        width: 420,
        padding: '14px 18px',
        borderRadius: 12,
        background: error.type === 'denied' ? 'rgba(220, 38, 38, 0.95)' : 'rgba(245, 158, 11, 0.95)',
        border: `1px solid ${error.type === 'denied' ? 'rgba(220, 38, 38, 0.8)' : 'rgba(245, 158, 11, 0.8)'}`,
        color: '#fff',
        zIndex: 999,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
          {error.message}
        </div>
        <button
          onClick={onDismiss}
          style={{
            background: 'rgba(255,255,255,0.2)',
            border: 'none',
            borderRadius: 4,
            color: '#fff',
            cursor: 'pointer',
            padding: '4px 8px',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          ✕
        </button>
      </div>
      {error.type === 'inAppBrowser' && (
        <button
          onClick={handleOpenInBrowser}
          style={{
            background: '#fff',
            border: 'none',
            borderRadius: 8,
            color: error.type === 'denied' ? '#dc2626' : '#d97706',
            cursor: 'pointer',
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            width: '100%',
          }}
        >
          Open in Browser
        </button>
      )}
      {error.type === 'denied' && (
        <button
          onClick={() => window.location.reload()}
          style={{
            background: 'rgba(255,255,255,0.9)',
            border: 'none',
            borderRadius: 8,
            color: '#dc2626',
            cursor: 'pointer',
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            width: '100%',
          }}
        >
          Reload Page
        </button>
      )}
    </div>
  );
}

function MediaDeviceErrorHandler({ onError }: { onError: (error: any) => void }) {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;

    const handleError = (error: any) => {
      console.error('[MediaDeviceError]', error);
      onError(error);
    };

    room.on(RoomEvent.MediaDevicesError, handleError);

    return () => {
      room.off(RoomEvent.MediaDevicesError, handleError);
    };
  }, [room, onError]);

  return null;
}

function ReconnectCommandListener() {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;

    const onData = (payload: Uint8Array) => {
      try {
        const msg = tryParseLiveKitDataMessage(payload);
        if (msg?.type !== RECONNECT_MEDIA_MESSAGE_TYPE) return;
        reconnectMedia(room);
      } catch {
        // ignore
      }
    };

    room.on(RoomEvent.DataReceived, onData as any);
    return () => {
      room.off(RoomEvent.DataReceived, onData as any);
    };
  }, [room]);

  return null;
}

// Use relative paths - Vite proxy forwards /api/* to http://localhost:5137
type StreamStatus = "idle" | "starting" | "live" | "stopping";
type RecordingStatus = "idle" | "recording" | "stopping" | "stopped" | "error";

type GuestStatus = "viewing_join" | "entered_room" | null;

function pendingDownloadBannerKey(roomId: string) {
  return `sl_pending_download_banner:${roomId}`;
}

function recordingBannerDismissedKey(recordingId: string) {
  return `sl_banner_dismissed:${recordingId}`;
}

function extractApiErrorCode(payload: any): string | null {
  const code = payload?.error ?? payload?.code ?? payload?.data?.error ?? payload?.data?.code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

function mapJoinErrorMessage(code: string | null): string | null {
  if (!code) return null;

  if (code === "login_required") {
    return "This room requires an account to join. Please sign in or ask the host to enable guest access.";
  }

  if (code === "room_not_live") {
    return "Host hasn’t started the room yet.";
  }

  if (
    code === "invite_invalid" ||
    code === "invalid_invite" ||
    code === "invite_expired" ||
    code === "invite_revoked" ||
    code === "invite_max_used"
  ) {
    return "Invite invalid or expired.";
  }

  return null;
}

function getGuestSessionToken(roomId: string | null): string | null {
  if (!roomId) return null;

  // 1. Try query param (highest priority, works in FB/IG in-app browsers)
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("gst");
    if (fromQuery) return fromQuery.trim();
  } catch {
    // ignore
  }

  // 2. Try sessionStorage (preferred, per-room)
  try {
    const fromSession = sessionStorage.getItem(`sl_guest_session:${roomId}`);
    if (fromSession) return fromSession.trim();
  } catch {
    // sessionStorage may fail in private browsing
  }

  // 3. Try localStorage (fallback, check if token matches roomId)
  try {
    const storedRoomId = localStorage.getItem("sl_guestSessionRoomId");
    if (storedRoomId === roomId) {
      const fromLocal = localStorage.getItem("sl_guestSessionToken");
      if (fromLocal) return fromLocal.trim();
    }
  } catch {
    // localStorage may fail in private browsing
  }

  return null;
}

type RoomPermissions = {
  canStream: boolean;
  canRecord: boolean;
  canDestinations: boolean;
  canModerate: boolean;
  canLayout: boolean;
  canScreenShare: boolean;
  canInvite: boolean;
  canAnalytics: boolean;
};
type EffectiveControls = {
  // Media/presence controls
  canPublishAudio: boolean;
  tileVisible: boolean;
  canPublishVideo?: boolean;
  canScreenShare?: boolean;

  // In-room capability scopes
  canMuteGuests?: boolean;
  canRemoveGuests?: boolean;
  canInviteLinks?: boolean;
  canManageDestinations?: boolean;
  canStartStopStream?: boolean;
  canStartStopRecording?: boolean;
  rolePresetId?: "participant" | "cohost";
};

function ThankYouScreen({ showHomeButton = false, onHome }: { showHomeButton?: boolean; onHome?: () => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        window.close();
      } catch (e) {}
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000000",
        color: "#ffffff",
        flexDirection: "column",
        textAlign: "center",
        padding: "1.5rem",
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Animated Background Orbs */}
      <div style={{
        position: 'absolute',
        top: '10%',
        left: '10%',
        width: '200px',
        height: '200px',
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #dc2626, #ef4444)',
        opacity: 0.1,
        filter: 'blur(30px)',
        animation: 'float 6s ease-in-out infinite'
      }} />
      <div style={{
        position: 'absolute',
        bottom: '15%',
        right: '15%',
        width: '150px',
        height: '150px',
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #ef4444, #dc2626)',
        opacity: 0.08,
        filter: 'blur(25px)',
        animation: 'float 8s ease-in-out infinite reverse'
      }} />

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-20px) rotate(180deg); }
        }
      `}</style>

      <div style={{
        background: 'rgba(39, 39, 42, 0.5)',
        borderRadius: '1rem',
        padding: '2.5rem',
        border: '1px solid rgba(63, 63, 70, 0.8)',
        backdropFilter: 'blur(20px)',
        position: 'relative',
        zIndex: 1,
        maxWidth: '500px'
      }}>
        <h1 style={{ fontSize: "1.875rem", marginBottom: "1rem", fontWeight: '600' }}>
          Thank you for joining StreamLine
        </h1>
        <p style={{ maxWidth: 400, opacity: 0.9, fontSize: '1.125rem', lineHeight: 1.6, marginBottom: showHomeButton ? '1.5rem' : '0' }}>
          Your session has ended. You can now close this app or tab.
        </p>
        {showHomeButton && onHome && (
          <button
            onClick={onHome}
            style={{
              padding: '12px 24px',
              background: 'linear-gradient(to right, #dc2626, #ef4444)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.background = 'linear-gradient(to right, #ef4444, #f87171)';
              target.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.background = 'linear-gradient(to right, #dc2626, #ef4444)';
              target.style.transform = 'translateY(0)';
            }}
          >
            🏠 Back to Home
          </button>
        )}
      </div>
    </div>
  );
}

function PermissionsDebugOverlay({ dashboardRole }: { dashboardRole: "host" | "participant" }) {
  const { localParticipant } = useLocalParticipant();
  const perms = useLocalParticipantPermissions();
  const localPermissions: any = perms || (localParticipant as any)?.permissions || (localParticipant as any)?.participant?.permissions;
  const rawRolePresetId = ((localParticipant as any)?.identityMetadata as any)?.rolePresetId;
  const normalizedRolePresetId = normalizeUiRolePresetId(rawRolePresetId);

  useEffect(() => {
    // Fastest “why are controls missing” signal.
    // If canPublish is false, LiveKit Components will hide mic/cam controls.
    console.log("[Room] LiveKit local permissions:", perms);
  }, [perms]);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 12,
        left: 12,
        padding: "8px 10px",
        borderRadius: 8,
        background: "rgba(15,23,42,0.9)",
        border: "1px solid rgba(148,163,184,0.6)",
        color: "#e5e7eb",
        fontSize: 11,
        maxWidth: 260,
        zIndex: 40,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Permissions Debug</div>
      <div>identity: {(localParticipant as any)?.identity || "(none)"}</div>
      <div>
        canPublish: {String(localPermissions?.canPublish ?? "n/a")} · canPublishData: {String(localPermissions?.canPublishData ?? "n/a")}
      </div>
      <div>
        sources: {
          Array.isArray(localPermissions?.canPublishSources)
            ? (localPermissions.canPublishSources as any[]).map(String).join(", ") || "(none)"
            : "n/a"
        }
      </div>
      <div>
        effectiveRole: {normalizedRolePresetId || dashboardRole}
      </div>
    </div>
  );
}

function StreamEndedModal({
  recordingId,
  processing,
  ready,
  onExitRoom,
  onStayInRoom,
}: {
  recordingId: string;
  processing: boolean;
  ready: boolean;
  onExitRoom: () => void;
  onStayInRoom: () => void;
}) {
  const nav = useNavigate();
  const { effectiveEntitlements } = useEffectiveEntitlements();
  const { access } = useFeatureAccess(effectiveEntitlements);
  const canMyContentRecordings = !!access?.myContentRecordings?.allowed;
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);

  const handleDownload = async () => {
    try {
      const res = await apiFetchAuth(`${API_BASE}/api/recordings/${recordingId}/download-link`, {}, { allowNonOk: true });
      if (res.status === 410) {
        alert("This recording link expired. Use Settings → Usage → Latest video.");
        return;
      }
      if (res.status === 402) {
        alert("Upgrade required to download this recording.");
        return;
      }
      if (!res.ok) throw new Error("Failed to get download link");

      const data = await res.json();
      const url = data?.data?.url;
      if (!data?.success || !url) {
        throw new Error(data?.error || "Invalid download link response");
      }

      window.open(url, "_blank");
      setConfirmMessage(null);
      setShowConfirmModal(true);
    } catch (err) {
      console.error(err);
      alert("Failed to download recording. Use Settings → Usage → Latest video.");
    }
  };

  const handleConfirmYes = async () => {
    try {
      await apiFetchAuth(`${API_BASE}/api/recordings/${recordingId}/download-link?confirm=true`, {}, { allowNonOk: true });
      setConfirmMessage("Great — you're all set. Save the file somewhere safe.");
    } catch (e) {
      setConfirmMessage("Noted. Thanks for confirming.");
    } finally {
      setShowConfirmModal(false);
    }
  };

  const handleConfirmNo = async () => {
    try {
      await apiFetchAuth(
        `${API_BASE}/api/recordings/${recordingId}/report-download-issue`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "user_reported_issue" }),
        },
        { allowNonOk: true }
      );
    } catch {}
    setConfirmMessage("Use Settings → Usage → Latest video if you're having trouble.");
    setShowConfirmModal(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        backdropFilter: "blur(4px)",
      }}
    >
      <div style={{
        background: 'linear-gradient(135deg, #1a1a1a 0%, #2d1a1a 100%)',
        border: '2px solid rgba(220, 38, 38, 0.3)',
        borderRadius: '1rem',
        padding: '2rem',
        maxWidth: '500px',
        width: '90%',
        textAlign: 'center',
        color: '#ffffff',
      }}>
        {processing && (
          <div style={{ marginBottom: '1rem', fontWeight: 600, color: '#fbbf24', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
            <div>Processing recording…</div>
            <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: '0.5rem' }}>
              This usually takes 1-2 minutes. {canMyContentRecordings ? 'It will appear in My Content when ready.' : 'The download button will activate when ready.'}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {canMyContentRecordings ? (
            <>
              <button
                onClick={() => nav('/content', { replace: true })}
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  borderRadius: "8px",
                  border: "none",
                  fontSize: "14px",
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "all 0.3s ease",
                  background: "#16a34a",
                  color: "#fff",
                }}
              >
                📁 View in My Content
              </button>
              <button
                onClick={handleDownload}
                disabled={!ready}
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  borderRadius: "8px",
                  border: "none",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: !ready ? "not-allowed" : "pointer",
                  opacity: !ready ? 0.6 : 1,
                  transition: "all 0.3s ease",
                  background: ready ? "rgba(255,255,255,0.12)" : "#374151",
                  color: "#fff",
                }}
              >
                {ready ? "⬇️ Download Recording" : "⏳ Processing..."}
              </button>
            </>
          ) : (
            <button
              onClick={handleDownload}
              disabled={!ready}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: "8px",
                border: "none",
                fontSize: "14px",
                fontWeight: 600,
                cursor: !ready ? "not-allowed" : "pointer",
                opacity: !ready ? 0.6 : 1,
                transition: "all 0.3s ease",
                background: ready ? "#16a34a" : "#374151",
                color: "#fff",
              }}
            >
              {ready ? "⬇️ Download Recording" : "⏳ Processing..."}
            </button>
          )}
          {confirmMessage && (
            <div
              style={{
                marginTop: 4,
                color: "#d1d5db",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              {confirmMessage}
            </div>
          )}
          <button
            onClick={onExitRoom}
            style={{
              width: '100%',
              padding: '1rem',
              background: 'rgba(255, 255, 255, 0.1)',
              border: '2px solid rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              borderRadius: '0.5rem',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
            }}
          >
            🚪 Back to Join
          </button>
          <button
            onClick={onStayInRoom}
            style={{
              width: '100%',
              padding: '0.85rem',
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.25)',
              color: '#bbf7d0',
              borderRadius: '0.5rem',
              fontSize: '0.95rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
            }}
          >
            Stay in Room
          </button>
        </div>
      </div>
      {showConfirmModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20 }}>
          <div style={{ background: "#111", border: "1px solid #333", borderRadius: 12, padding: 20, width: 320 }}>
            <h4 style={{ margin: 0, marginBottom: 10, color: "#fff" }}>Did your download start?</h4>
            <p style={{ margin: 0, marginBottom: 16, color: "#d1d5db", fontSize: 14 }}>If not, retry via Settings → Usage → Latest video.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={handleConfirmNo} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #444", background: "#1f2937", color: "#fff", cursor: "pointer" }}>No</button>
              <button onClick={handleConfirmYes} style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#dc2626,#ef4444)", color: "#fff", cursor: "pointer" }}>Yes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getOrCreateUid() {
  let uid = localStorage.getItem("sl_userId");
  if (!uid) {
    uid = localStorage.getItem("sl_guestId") || null;
  }
  if (!uid) {
    const rand = Math.random().toString(36).slice(2, 10);
    uid = `guest_${rand}`;
    localStorage.setItem("sl_guestId", uid);
  }
  return uid;
}
 
type LiveKitShellProps = {
  token: string;
  serverUrl: string;
  isHost: boolean;
  isViewer: boolean;
  roomId: string | null;
  subjectToControls: boolean;
  controlsAllowPublishAudio: boolean;
  controlsTileVisible: boolean;
  controlsAllowScreenShare: boolean;
  watermarkEnabled: boolean;
  dashboardOpen: boolean;
  onCloseDashboard: () => void;
  roomName: string;
  roomAccessToken: string | null;
  canMuteGuests: boolean;
  canRemoveGuests: boolean;
  canModerate: boolean;
  effectivePermissionsMode: "simple" | "advanced";
  dashboardGreenroomEnabled: boolean;
  dashboardOverlaysEnabled: boolean;
  dashboardRole: "host" | "moderator" | "participant";
  onLeaveRequested?: () => void;
  onDisconnected: () => void;
};

function LiveKitShell({
  token,
  serverUrl,
  isHost,
  isViewer,
  roomId,
  subjectToControls,
  controlsAllowPublishAudio,
  controlsTileVisible,
   controlsAllowScreenShare,
  watermarkEnabled,
  dashboardOpen,
  onCloseDashboard,
  roomName,
  roomAccessToken,
  canMuteGuests,
  canRemoveGuests,
  canModerate,
  effectivePermissionsMode,
  dashboardGreenroomEnabled,
  dashboardOverlaysEnabled,
  dashboardRole,
  onLeaveRequested,
  onDisconnected,
}: LiveKitShellProps) {
  const [guestStatus, setGuestStatus] = useState<GuestStatus>(null);
  const statusRef = useRef<GuestStatus>(null);
  const mediaRootRef = useRef<HTMLDivElement | null>(null);

  // Media permission error state and handlers
  const [mediaPermissionError, setMediaPermissionError] = useState<{
    type: 'denied' | 'notFound' | 'notReadable' | 'notSupported' | 'inAppBrowser' | null;
    message: string;
  } | null>(null);

  // Detect in-app browsers that may block camera/mic access
  const detectInAppBrowser = (): boolean => {
    const ua = navigator.userAgent || "";
    // Facebook, Instagram, TikTok, Twitter, LinkedIn in-app browsers
    const patterns = /FBAN|FBAV|Instagram|TikTok|Twitter|LinkedInApp/i;
    return patterns.test(ua);
  };

  // Handle media device errors and show appropriate messaging
  const handleMediaDeviceError = (error: any) => {
    console.error('[Room] MediaDevicesError:', error);

    const errorName = error?.name || String(error);
    
    if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
      setMediaPermissionError({
        type: 'denied',
        message: '🔒 Camera/mic blocked. Tap the lock icon → allow → reload.',
      });
    } else if (errorName === 'NotFoundError') {
      setMediaPermissionError({
        type: 'notFound',
        message: '⚠️ No camera/mic found. Check if devices are connected.',
      });
    } else if (errorName === 'NotReadableError') {
      setMediaPermissionError({
        type: 'notReadable',
        message: '⚠️ Camera/mic in use by another app. Close other apps and reload.',
      });
    } else if (errorName === 'NotSupportedError' || errorName === 'OverconstrainedError') {
      setMediaPermissionError({
        type: 'notSupported',
        message: '⚠️ Browser or device limitation. Try a different browser.',
      });
    } else {
      setMediaPermissionError({
        type: 'notSupported',
        message: `⚠️ Unable to access camera/mic: ${errorName}`,
      });
    }
  };

  // Check for in-app browser on mount
  React.useEffect(() => {
    if (detectInAppBrowser()) {
      setMediaPermissionError({
        type: 'inAppBrowser',
        message: '⚠️ This in-app browser may block camera/mic. Open in Chrome/Safari.',
      });
    }
  }, []);

  useEffect(() => {
    if (!isHost || !roomId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/invites/room-status?roomId=${encodeURIComponent(roomId)}`,
          {
            credentials: "include",
          },
        );
        if (!res.ok) return;
        const data = await res.json();
        let nextStatus: GuestStatus = null;
        if (data?.hasEnteredRoom) {
          nextStatus = "entered_room";
        } else if (data?.hasJoinPageView) {
          nextStatus = "viewing_join";
        }
        if (!cancelled && statusRef.current !== nextStatus) {
          statusRef.current = nextStatus;
          setGuestStatus(nextStatus);
        }
      } catch {
        // ignore
      }
    };

    poll();
    const id = setInterval(poll, 7000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isHost, roomId]);

  // Prevent double-audio playback from LiveKit DOM:
  // in some browser/component combinations, audio can play via both an <audio>
  // element and an unmuted <video> tile, boosting perceived volume (often noticed
  // with screen share audio).
  useEffect(() => {
    const root = mediaRootRef.current;
    if (!root) return;

    const applyMute = () => {
      const videos = root.querySelectorAll("video");
      videos.forEach((el) => {
        try {
          const video = el as HTMLVideoElement;
          const stream = video.srcObject as MediaStream | null;
          const hasAudio =
            !!stream && typeof stream.getAudioTracks === "function" && stream.getAudioTracks().length > 0;
          if (hasAudio) {
            video.muted = true;
          }
        } catch {
          // ignore
        }
      });
    };

    applyMute();
    const obs = new MutationObserver(() => applyMute());
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  return (
    <LiveKitRoom
      data-lk-theme="default"
      className={`sl-layout${isViewer ? " sl-viewer" : ""}${
        subjectToControls && !controlsAllowPublishAudio ? " sl-controls-no-audio" : ""
      }${subjectToControls && !controlsTileVisible ? " sl-controls-hide-self" : ""}${
        subjectToControls && !controlsAllowScreenShare ? " sl-controls-no-screen" : ""
      }`}
      token={token}
      serverUrl={serverUrl}
      connect={true}
      audio={true}
      video={true}
      connectOptions={undefined}
      onConnected={() => {
        console.log('[Room] 🔗 LiveKit onConnected callback fired', { 
          isViewer, 
          isHost,
          roomId,
          wantsAudio: true,
          wantsVideo: true,
        });
      }}
      onDisconnected={onDisconnected}
      onError={(error) => {
        console.error('[Room] ❌ LiveKit error:', {
          error,
          message: error?.message,
          isViewer,
          isHost,
        });
      }}
      style={{
        width: "100%",
        height: "calc(100vh - 60px)",
        position: "relative",
      }}
    >
      <div ref={mediaRootRef} style={{ width: "100%", height: "100%", position: "relative" }}>
        <LiveKitDebugLogger />
        <VideoElementMonitor />
        {DEV_CONTROLS && <PermissionsDebugOverlay dashboardRole={dashboardRole === "host" ? "host" : "participant"} />}
        <GuestTelemetryTracker roomId={roomId} isViewer={isViewer} />
        <MediaDeviceErrorHandler onError={handleMediaDeviceError} />
        <WaitingForHostBanner isViewer={isViewer} />
        <MediaPermissionErrorBanner 
          error={mediaPermissionError} 
          onDismiss={() => setMediaPermissionError(null)}
        />
        <ReconnectCommandListener />
        {isHost && !isViewer && (
          <div
            style={{
              position: "absolute",
              top: 10,
              left: "50%",
              transform:
                guestStatus === "viewing_join"
                  ? "translateX(-50%) translateY(0)"
                  : "translateX(-50%) translateY(-6px)",
              padding: "6px 12px",
              borderRadius: 999,
              background: "rgba(15,23,42,0.9)",
              border: "1px solid rgba(59,130,246,0.7)",
              fontSize: 12,
              color: "#bfdbfe",
              zIndex: 20,
              opacity: guestStatus === "viewing_join" ? 1 : 0,
              pointerEvents: "none",
              transition: "opacity 0.35s ease-in-out, transform 0.35s ease-in-out",
            }}
          >
            Guest is viewing the join page.
          </div>
        )}
        {isViewer && (
          <div
            style={{
              position: "absolute",
              top: 10,
              left: "50%",
              transform: "translateX(-50%)",
              padding: "8px 16px",
              borderRadius: 999,
              background: "rgba(15,23,42,0.95)",
              border: "1px solid rgba(59,130,246,0.6)",
              fontSize: 13,
              color: "#93c5fd",
              zIndex: 20,
              pointerEvents: "none",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            🎥 Connected as guest — you can enable mic/cam below
          </div>
        )}
        <div
          style={{ width: "100%", height: "100%" }}
          onClickCapture={(e) => {
            // LiveKit prefab renders a DisconnectButton ("Leave") inside the ControlBar.
            // We intercept it so it runs the same exit flow as our app-level "Exit Room" button,
            // preventing inconsistent/legacy exit routing.
            const target = e.target as unknown as HTMLElement | null;
            const disconnectEl = target?.closest?.('.lk-disconnect-button');
            if (!disconnectEl) return;

            e.preventDefault();
            e.stopPropagation();
            const native: any = e.nativeEvent as any;
            if (native?.stopImmediatePropagation) native.stopImmediatePropagation();

            if (typeof onLeaveRequested === 'function') {
              onLeaveRequested();
            }
          }}
        >
          <ErrorBoundary
            fallback={
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "24px",
                  textAlign: "center",
                  color: "#fff",
                  background: "#000",
                }}
              >
                <div style={{ maxWidth: 520 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                    Live room failed to load
                  </div>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", marginBottom: 14, lineHeight: 1.5 }}>
                    Refresh the page. If it keeps happening, open the browser console and send the error.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        window.location.reload();
                      } catch {
                        // ignore
                      }
                    }}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.18)",
                      background: "rgba(255,255,255,0.06)",
                      color: "#fff",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Refresh
                  </button>
                </div>
              </div>
            }
          >
            <SafeVideoConference />
          </ErrorBoundary>
        </div>
        {watermarkEnabled && (
          <img
            src="/logo.png"
            alt="StreamLine watermark"
            className="sl-watermark"
            style={{
              top: "12px",
              right: "12px",
              width: "96px",
            }}
          />
        )}
        {dashboardOpen && !isViewer && (
          <RoleOverlay
            open={dashboardOpen}
            onClose={onCloseDashboard}
            role={dashboardRole}
            roomName={roomName}
            roomId={roomId || ""}
            roomAccessToken={roomAccessToken || ""}
            canMuteGuests={canMuteGuests}
            canRemoveGuests={canRemoveGuests}
            canModerate={canModerate}
            advancedRolesEnabled={effectivePermissionsMode === "advanced"}
            greenroomEnabled={dashboardGreenroomEnabled}
            overlaysEnabled={dashboardOverlaysEnabled}
          />
        )}
      </div>
    </LiveKitRoom>
  );
}

function RoomPage() {
  const location = useLocation();
  const nav = useNavigate();
  const { roomName: routeRoomNameParam } = useParams();
  const routeRoomId = routeRoomNameParam ? decodeURIComponent(routeRoomNameParam) : null;
  const [searchParams] = useSearchParams();

  const { effectiveEntitlements: myEffectiveEntitlements } = useEffectiveEntitlements();

  const [displayName, setDisplayName] = useState(() => {
    // Prefer profile displayName if available, then fall back to cached value
    try {
      const rawUser = localStorage.getItem("sl_user");
      if (rawUser && rawUser !== "undefined") {
        const parsed = JSON.parse(rawUser);
        if (parsed?.displayName) return parsed.displayName as string;
      }
    } catch {
      // ignore parse errors and fall back
    }
    const cachedName = localStorage.getItem("sl_displayName") ?? "";

    // Do NOT auto-generate names for guests. If a visitor arrives via an invite
    // link (even with a guest session token), require them to pick a name once
    // on entry unless they already have a cached/profile name.
    return cachedName;
  });
  const [pendingName, setPendingName] = useState(displayName);
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [showStreamSetup, setShowStreamSetup] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [egressId, setEgressId] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [showGoodbye, setShowGoodbye] = useState(false);
  const [showStreamEndedModal, setShowStreamEndedModal] = useState(false);
  const currentUserId = getOrCreateUid();
  const [isHost, setIsHost] = useState(false);
  const [hostCheckReady, setHostCheckReady] = useState(false);
  const [userRole, setUserRole] = useState<string>(() => {
    try {
      return localStorage.getItem("sl_current_role") || "guest";
    } catch {
      return "guest";
    }
  });
  const [inviteToken, setInviteToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem("sl_invite_token") || null;
    } catch {
      return null;
    }
  });
  const [isViewer, setIsViewer] = useState(false);
  const [roomPermissions, setRoomPermissions] = useState<RoomPermissions | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [reauthBannerText, setReauthBannerText] = useState<string>(
    "Session expired — re-auth to enable host tools."
  );
  const [roomTokenMode, setRoomTokenMode] = useState<"unknown" | "auth" | "guest">("unknown");
  const roomTokenMintInFlightRef = useRef(false);
  const [roomGateStatus, setRoomGateStatus] = useState<"unknown" | "idle" | "live" | "blocked">("unknown");
  const roomGatePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hostToolsHydratedKeyRef = useRef<string | null>(null);
  const [controlsPanelOpen, setControlsPanelOpen] = useState(false);
  const [effectiveControls, setEffectiveControls] = useState<EffectiveControls>(() => ({
    canPublishAudio: true,
    tileVisible: true,
    canPublishVideo: true,
    canScreenShare: false,
    canMuteGuests: false,
    canRemoveGuests: false,
    canInviteLinks: false,
    canManageDestinations: false,
    canStartStopStream: false,
    canStartStopRecording: false,
  }));
  const [roleChangeMessage, setRoleChangeMessage] = useState<string | null>(null);
  const roleToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recordingCountdown, setRecordingCountdown] = useState<string | null>(null);
  const [isRecordingCountdown, setIsRecordingCountdown] = useState(false);
  const recordingCountdownTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const [liveCountdown, setLiveCountdown] = useState<string | null>(null);
  const [isLiveCountdown, setIsLiveCountdown] = useState(false);
  const liveCountdownTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const currentRole = userRole;
  const isGuestRole = currentRole === "guest";
  const can = (key: keyof RoomPermissions) => !needsReauth && (isHost || !!roomPermissions?.[key]);
  const canInviteLinks = !needsReauth && !isViewer && (isHost || !!effectiveControls.canInviteLinks || can("canInvite"));
  const canManageStream =
    !needsReauth &&
    !isViewer &&
    (isHost ||
      !!effectiveControls.canStartStopStream ||
      !!effectiveControls.canStartStopRecording ||
      !!effectiveControls.canManageDestinations ||
      can("canStream") ||
      can("canRecord") ||
      can("canDestinations"));
  const canMuteGuestsUi =
    !needsReauth &&
    !isViewer &&
    isHost &&
    (!!effectiveControls.canMuteGuests || can("canModerate"));

  const canRemoveGuestsUi =
    !needsReauth &&
    !isViewer &&
    isHost &&
    (!!effectiveControls.canRemoveGuests || can("canModerate"));

  const canModerateUi =
    !needsReauth &&
    !isViewer &&
    isHost &&
    (can("canModerate") ||
      !!effectiveControls.canRemoveGuests ||
      !!effectiveControls.canMuteGuests);

  const subjectToControls = !isHost && !isViewer;
  const controlsAllowPublishAudio = !subjectToControls || effectiveControls.canPublishAudio !== false;
  const controlsTileVisible = !subjectToControls || effectiveControls.tileVisible !== false;
  const controlsAllowScreenShare = !subjectToControls || effectiveControls.canScreenShare !== false;

  const openReauthInNewTab = () => {
    try {
      const next = `${window.location.pathname}${window.location.search}`;
      const params = new URLSearchParams();
      params.set("next", next);
      window.open(`/login?${params.toString()}`, "_blank", "noopener,noreferrer");
    } catch {
      window.open("/login", "_blank", "noopener,noreferrer");
    }
  };

  const confirmReauthed = async () => {
    try {
      const res = await apiFetchAuth("/api/account/me", undefined, { allowNonOk: true });
      if (res.ok) {
        setAuthStatus("authed");
        setNeedsReauth(false);
        setReauthBannerText("Session expired — re-auth to enable host tools.");
        return;
      }
      if (res.status === 401 || res.status === 403) {
        setAuthStatus("guest");
        setNeedsReauth(true);
      }
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403) {
        setAuthStatus("guest");
        setNeedsReauth(true);
      }
    }
  };

  const updateRoomControls = async (patch: Partial<EffectiveControls>) => {
    if (!roomId || !roomAccessToken) return;
    if (needsReauth) {
      setNeedsReauth(true);
      return;
    }

    try {
      const res = await apiFetch(
        `/api/rooms/${encodeURIComponent(roomId)}/controls`,
        {
          method: "PATCH",
          headers: { "x-room-access-token": roomAccessToken },
          body: JSON.stringify(patch),
        },
        { allowNonOk: true },
      );

      if (res.ok) {
        const data = await res.json().catch(() => null);
        const c = data?.controls;
        if (c && typeof c === "object") {
          setEffectiveControls({
            canPublishAudio: typeof c.canPublishAudio === "boolean" ? c.canPublishAudio : true,
            tileVisible: typeof c.tileVisible === "boolean" ? c.tileVisible : true,
            canPublishVideo: typeof c.canPublishVideo === "boolean" ? c.canPublishVideo : true,
            canScreenShare: typeof c.canScreenShare === "boolean" ? c.canScreenShare : false,
            canMuteGuests: typeof c.canMuteGuests === "boolean" ? c.canMuteGuests : false,
                canRemoveGuests: typeof c.canRemoveGuests === "boolean" ? c.canRemoveGuests : false,
            canInviteLinks: typeof c.canInviteLinks === "boolean" ? c.canInviteLinks : false,
            canManageDestinations: typeof c.canManageDestinations === "boolean" ? c.canManageDestinations : false,
            canStartStopStream: typeof c.canStartStopStream === "boolean" ? c.canStartStopStream : false,
            canStartStopRecording: typeof c.canStartStopRecording === "boolean" ? c.canStartStopRecording : false,
            rolePresetId:
              c.role === "cohost" || c.role === "participant"
                ? normalizeUiRolePresetId(c.role)
                : undefined,
          });
        }
      } else if (res.status === 401 || res.status === 403) {
        setNeedsReauth(true);
      }
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403) {
        setNeedsReauth(true);
      }
    }
  };

  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>("idle");
  const recordingRef = useRef<string | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const lastRecordingStatusRef = useRef<RecordingStatus>("idle");
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [recordingPlanId, setRecordingPlanId] = useState<string | null>(null);
  const [maxRecordingMinutesPerClip, setMaxRecordingMinutesPerClip] = useState<number | null>(null);
  const [recordingToast, setRecordingToast] = useState<string | null>(null);
  const [recordingBackgroundNotice, setRecordingBackgroundNotice] = useState<null | {
    kind: "processing" | "ready";
    recordingId: string;
    downloadUrl?: string | null;
  }>(null);
  const [postStopDownloadUrl, setPostStopDownloadUrl] = useState<string | null>(null);
  const [postStopProcessing, setPostStopProcessing] = useState(false);
  const [postStopReady, setPostStopReady] = useState(false);
  const [postStopStatus, setPostStopStatus] = useState<string | null>(null);
  const [stayedInRoomDuringProcessing, setStayedInRoomDuringProcessing] = useState(false);
  const postStopIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const postStopPollCountRef = useRef(0);
  const [copiedInviteLabel, setCopiedInviteLabel] = useState<string | null>(null);
  const copiedInviteTimeoutRef = useRef<number | null>(null);
  const lastStopWasAutoRef = useRef<boolean>(false);
  const autoStopTriggeredRef = useRef(false);
  const [viewerCount] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const streamStartTimeRef = useRef<number | null>(null);
  const streamEgressRef = useRef<string | null>(null);
  const lastElapsedRef = useRef(0);
  const usagePostedRef = useRef(false);
  const [didStreamThisSession, setDidStreamThisSession] = useState(false);
  // Plan/entitlement flags are informational only; in-room gating is driven by roomPermissions.
  const [planMultistreamEnabled, setPlanMultistreamEnabled] = useState<boolean>(false);
  const [planRtmpDestinationsMax, setPlanRtmpDestinationsMax] = useState<number | null>(null);
  const [planRecordingEnabled, setPlanRecordingEnabled] = useState<boolean>(false);
  const [planHlsEnabled, setPlanHlsEnabled] = useState<boolean>(false);
  const [planHlsCustomizationEnabled, setPlanHlsCustomizationEnabled] = useState<boolean>(false);
  const [platformHlsEnabled, setPlatformHlsEnabled] = useState<boolean>(true);
  const [platformRecordingEnabled, setPlatformRecordingEnabled] = useState<boolean>(true);
  const [entitlementsReady, setEntitlementsReady] = useState(false);
  const [dashboardGreenroomEnabled, setDashboardGreenroomEnabled] = useState<boolean>(false);
  const [dashboardOverlaysEnabled, setDashboardOverlaysEnabled] = useState<boolean>(false);
  const [dualRecordingAllowed, setDualRecordingAllowed] = useState<boolean>(false);
  const [watermarkEnabled, setWatermarkEnabled] = useState<boolean>(false);
  const [maxGuestsAllowed, setMaxGuestsAllowed] = useState<number | null>(null);
  const [destinations, setDestinations] = useState<DestinationItem[]>([]);
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [destinationsReady, setDestinationsReady] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightResult, setPreflightResult] = useState<any>(null);
  const [canGoLive, setCanGoLive] = useState(false);
  const [mediaPresets, setMediaPresets] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("standard_720p30");
  const [effectivePresetId, setEffectivePresetId] = useState<string | null>(null);
  const [presetClamped, setPresetClamped] = useState(false);
  const [defaultRecordingModePref, setDefaultRecordingModePref] = useState<"cloud" | "dual">("cloud");
  const [firestoreRoomId, setFirestoreRoomId] = useState<string | null>(null);
  const [roomAccessToken, setRoomAccessToken] = useState<string | null>(null);
  const [participantIdentity, setParticipantIdentity] = useState<string | null>(null);
  const [adminOverride, setAdminOverride] = useState<boolean>(false);
  const [, setAuthStatus] = useState<"unknown" | "authed" | "guest">("unknown");
    const [effectivePermissionsMode, setEffectivePermissionsMode] = useState<"simple" | "advanced">("simple");
  const roomId = firestoreRoomId ?? routeRoomId ?? null;

  const { data: hlsStatusData } = useHlsStatus({
    apiBase: API_BASE,
    roomId: roomId || "",
    roomAccessToken: roomAccessToken || "",
  });

  useEffect(() => {
    // New room => allow fresh host tools hydration
    hostToolsHydratedKeyRef.current = null;
  }, [roomId]);

  useEffect(() => {
    // If all host tools are closed, allow a future open to hydrate again.
    if (!showStreamSetup && !dashboardOpen) {
      hostToolsHydratedKeyRef.current = null;
    }
  }, [showStreamSetup, dashboardOpen]);
  const [roomName, setRoomName] = useState<string>(() => {
    const fromState = (location.state as any)?.livekitRoomName;
    if (typeof fromState === "string" && fromState.trim()) return fromState.trim();
    const cached = localStorage.getItem("sl_last_room");
    return cached || "";
  });
  const effectiveRoomName = roomName;

  const rtmpCap = planRtmpDestinationsMax ?? 0;
  const roomEffectiveEntitlementsForAccess = useMemo(
    () => ({
      features: {
        hls: planHlsEnabled,
        hlsCustomizationEnabled: planHlsCustomizationEnabled,
      },
      limits: {
        rtmpDestinationsMax: rtmpCap,
      },
    }),
    [planHlsEnabled, planHlsCustomizationEnabled, rtmpCap],
  );
  const { access: featureAccess } = useFeatureAccess(roomEffectiveEntitlementsForAccess);

  useEffect(() => {
    // When navigating between rooms in a single SPA session, always
    // require a fresh entitlements snapshot and clear plan-derived
    // flags so we never briefly show stale caps.
    setEntitlementsReady(false);
    setPlanRecordingEnabled(false);
    setPlanHlsEnabled(false);
    setPlanRtmpDestinationsMax(null);
    setPlanHlsCustomizationEnabled(false);
    setPlanMultistreamEnabled(false);
    setDualRecordingAllowed(false);
    setWatermarkEnabled(false);
    setMaxGuestsAllowed(null);
    setMaxRecordingMinutesPerClip(null);
  }, [roomId]);

  useEffect(() => {
    setHostCheckReady(true);
    const candidateKey = roomId;
    if (!candidateKey) return;
    const createdRooms = JSON.parse(localStorage.getItem("sl_created_rooms") || "[]");
    const localIsAdmin = (() => {
      try {
        const raw = localStorage.getItem("sl_user");
        if (!raw || raw === "undefined") return false;
        const parsed = JSON.parse(raw);
        return !!(parsed?.isAdmin || parsed?.admin?.isAdmin);
      } catch {
        return false;
      }
    })();

    const willBeHost = createdRooms.includes(candidateKey) || localIsAdmin;
    setIsHost(willBeHost);
    const storedRole = (() => {
      try {
        return localStorage.getItem("sl_current_role") || "guest";
      } catch {
        return "guest";
      }
    })();
    const nextRole = willBeHost ? "host" : storedRole;
    setUserRole(nextRole);
    try {
      if (willBeHost) localStorage.setItem("sl_current_role", "host");
      setInviteToken(localStorage.getItem("sl_invite_token") || null);
    } catch {
      // ignore
    }
    console.log("🏠 Host Check:", { roomKey: candidateKey, roomId, createdRooms, isHost: willBeHost, role: nextRole });
  }, [currentUserId, roomId]);

  // Realtime controls subscription (SSE over the roomAccessToken).
  // This must NOT trigger LiveKit token refresh/reconnect.
  useEffect(() => {
    if (!roomId || !roomAccessToken) return;

    const base = API_BASE || "";

    const qs = new URLSearchParams();
    qs.set("t", roomAccessToken);
    if (participantIdentity) qs.set("identity", participantIdentity);
    const url = `${base}/api/rooms/${encodeURIComponent(roomId)}/controls/stream?${qs.toString()}`;

    console.log("[Room controls SSE] identity from roomToken:", participantIdentity, "url:", url);

    let closed = false;
    const es = new EventSource(url, { withCredentials: true } as any);

    let lastRole: "cohost" | "participant" | undefined = undefined;

    es.onmessage = (ev) => {
      if (closed) return;
      try {
        const data = JSON.parse(ev.data);

        const rawRole = data?.role;
        const nextRole = rawRole === "cohost" || rawRole === "participant" ? normalizeUiRolePresetId(rawRole) : undefined;

        if (nextRole && lastRole && nextRole !== lastRole) {
          const roleName = nextRole === "cohost" ? "Co-host" : "Participant";

          const msg = `You're now a ${roleName}`;
          setRoleChangeMessage(msg);

          if (roleToastTimeoutRef.current) {
            clearTimeout(roleToastTimeoutRef.current);
          }
          roleToastTimeoutRef.current = setTimeout(() => {
            setRoleChangeMessage(null);
            roleToastTimeoutRef.current = null;
          }, 2800);
        }

        if (!lastRole && nextRole) {
          lastRole = nextRole;
        } else if (nextRole && nextRole !== lastRole) {
          lastRole = nextRole;
        }

        const normalizedRolePresetId = nextRole ? normalizeUiRolePresetId(nextRole) : undefined;

        setEffectiveControls({
          canPublishAudio: typeof data?.canPublishAudio === "boolean" ? data.canPublishAudio : true,
          tileVisible: typeof data?.tileVisible === "boolean" ? data.tileVisible : true,
          canPublishVideo: typeof data?.canPublishVideo === "boolean" ? data.canPublishVideo : true,
          canScreenShare: typeof data?.canScreenShare === "boolean" ? data.canScreenShare : false,
          canMuteGuests: typeof data?.canMuteGuests === "boolean" ? data.canMuteGuests : false,
          canRemoveGuests: typeof data?.canRemoveGuests === "boolean" ? data.canRemoveGuests : false,
          canInviteLinks: typeof data?.canInviteLinks === "boolean" ? data.canInviteLinks : false,
          canManageDestinations: typeof data?.canManageDestinations === "boolean" ? data.canManageDestinations : false,
          canStartStopStream: typeof data?.canStartStopStream === "boolean" ? data.canStartStopStream : false,
          canStartStopRecording: typeof data?.canStartStopRecording === "boolean" ? data.canStartStopRecording : false,
          rolePresetId: normalizedRolePresetId,
        });
      } catch {
        // ignore
      }
    };

    es.onerror = () => {
      // Keep last-known controls; EventSource will retry.
    };

    return () => {
      closed = true;
      if (roleToastTimeoutRef.current) {
        clearTimeout(roleToastTimeoutRef.current);
        roleToastTimeoutRef.current = null;
      }
      try {
        es.close();
      } catch {
        // ignore
      }
    };
  }, [API_BASE, roomId, roomAccessToken, participantIdentity]);

  // If we have an inviteToken but the role isn't set (or got reset), resolve it here
  // so we mint the correct room token and permissions.
  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/invites/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inviteToken }),
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (!data || cancelled) return;

        const resolvedId = String(data.roomId || "");
        const resolvedName = String(data.roomName || "");
        const rawResolvedRole = String(data.role || "guest");
        const resolvedRole = rawResolvedRole === "cohost" ? "guest" : rawResolvedRole;
        const expectedId = roomId || "";
        const expectedName = effectiveRoomName || "";
        const clearStaleInvite = () => {
          setInviteToken(null);
          try {
            localStorage.removeItem("sl_invite_token");
          } catch {
            // ignore
          }
        };
        if (expectedId && resolvedId && resolvedId !== expectedId) {
          clearStaleInvite();
          return;
        }
        if (!expectedId && expectedName && resolvedName && resolvedName !== expectedName) {
          clearStaleInvite();
          return;
        }

        // Only override when we're not host and our role is low-trust.
        if (!isHost && (userRole === "guest" || userRole === "participant")) {
          setUserRole(resolvedRole);
          try {
            localStorage.setItem("sl_current_role", resolvedRole);
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [API_BASE, roomId, effectiveRoomName, inviteToken, isHost, userRole]);

  // Token-only routing support: /room?t=<token>
  // Prefer treating `t` as a room access/share token and resolving it via
  // /api/rooms/resolve using x-room-access-token. If resolution fails,
  // fall back to treating it as an invite token for older links.
  useEffect(() => {
    const t = String(searchParams.get("t") || "").trim();
    if (!t) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/rooms/resolve`, {
          method: "GET",
          headers: {
            "x-room-access-token": t,
          },
          credentials: "include",
        });

        if (cancelled) return;

        if (res.ok) {
          const data = await res.json().catch(() => null as any);
          if (!data || cancelled) return;

          const resolvedRoomId = String(data.roomId || "").trim();
          const resolvedRoomName = String(data.roomName || "").trim();
          const resolvedRole = String(data.role || "").trim();
          const tokenType = String((data as any).tokenType || "").trim();

          if (resolvedRoomId) setFirestoreRoomId(resolvedRoomId);
          if (resolvedRoomName) setRoomName(resolvedRoomName);

          if (resolvedRole && !isHost) {
            setUserRole(resolvedRole);
            try {
              localStorage.setItem("sl_current_role", resolvedRole);
            } catch {
              // ignore
            }
          }

          // If this is an invite token, route it through the canonical invite flow
          // (/invite/:inviteId -> redeem -> sl_guest cookie) instead of persisting query tokens.
          if (tokenType === "invite") {
            try {
              const legacyRes = await fetch(`${API_BASE}/api/invites/legacy/resolve`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ inviteToken: t }),
              });
              if (legacyRes.ok) {
                const legacy = await legacyRes.json().catch(() => null as any);
                const inviteId = String(legacy?.inviteId || "").trim();
                if (inviteId) {
                  window.location.replace(`/invite/${encodeURIComponent(inviteId)}`);
                  return;
                }
              }
            } catch (e) {
              console.warn("[Room] legacy invite resolve failed; keeping as inviteToken", e);
            }
            // Fallback: if legacy resolve failed, keep it as inviteToken (not roomAccessToken)
            // to avoid 401 loops on HLS/status APIs. User will need to redeem via invite flow.
            setInviteToken(t);
            try {
              localStorage.setItem("sl_invite_token", t);
            } catch {
              // ignore
            }
            return;
          }

          if (tokenType !== "invite") {
            // Treat the incoming token as a roomAccessToken for downstream
            // APIs (HLS, status, etc.). /api/rooms/:roomId/token will return a refreshed
            // token which will overwrite this state when available.
            setRoomAccessToken(t);
          }
          return;
        }

        // If resolve fails, treat it as a legacy invite and route through /invite/:inviteId.
        console.warn("[Room] /api/rooms/resolve failed for token route", res.status);
        try {
          const legacyRes = await fetch(`${API_BASE}/api/invites/legacy/resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ inviteToken: t }),
          });
          if (legacyRes.ok) {
            const legacy = await legacyRes.json().catch(() => null as any);
            const inviteId = String(legacy?.inviteId || "").trim();
            if (inviteId) {
              window.location.replace(`/invite/${encodeURIComponent(inviteId)}`);
              return;
            }
          }
        } catch {
          // ignore
        }

        // Final fallback: preserve legacy behavior if resolve endpoint is unreachable.
        setInviteToken(t);
        try {
          localStorage.setItem("sl_invite_token", t);
        } catch {
          // ignore
        }
      } catch (err) {
        if (cancelled) return;
        console.warn("[Room] /api/rooms/resolve error; treating t as invite", err);
        try {
          const legacyRes = await fetch(`${API_BASE}/api/invites/legacy/resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ inviteToken: t }),
          });
          if (legacyRes.ok) {
            const legacy = await legacyRes.json().catch(() => null as any);
            const inviteId = String(legacy?.inviteId || "").trim();
            if (inviteId) {
              window.location.replace(`/invite/${encodeURIComponent(inviteId)}`);
              return;
            }
          }
        } catch {
          // ignore
        }

        // Final fallback: preserve legacy behavior.
        setInviteToken(t);
        try {
          localStorage.setItem("sl_invite_token", t);
        } catch {
          // ignore
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [API_BASE, searchParams, isHost]);

  const presetLabelFor = (id?: string | null) => {
    if (!id) return "Standard 720p30";
    const match = mediaPresets.find((p) => p.id === id);
    return match?.label || id;
  };

  const handlePresetChange = (id: string) => {
    setSelectedPresetId(id);
    setEffectivePresetId(id);
    setPresetClamped(false);
  };

  const applyEntitlementsAndPlatform = (eff: any, platformFlags: any) => {
    const platform = platformFlags && typeof platformFlags === "object" ? platformFlags : {};

    // Publish roomToken-provided flags to the shared store (most recent fetch wins).
    setPlatformFlagsValue(platform as any);

    if (platform && Object.prototype.hasOwnProperty.call(platform, "hlsEnabled")) {
      if (typeof (platform as any).hlsEnabled === "boolean") {
        setPlatformHlsEnabled((platform as any).hlsEnabled);
      }
    }

    if (platform && Object.prototype.hasOwnProperty.call(platform, "recordingEnabled")) {
      if (typeof (platform as any).recordingEnabled === "boolean") {
        setPlatformRecordingEnabled((platform as any).recordingEnabled);
      }
    }

    const dashboardGreenroomFlag =
      (platform as any).dashboardGreenroomEnabled ?? (platform as any).greenroomDashboard;
    if (typeof dashboardGreenroomFlag === "boolean") {
      setDashboardGreenroomEnabled(dashboardGreenroomFlag);
    }

    const dashboardOverlaysFlag =
      (platform as any).dashboardOverlaysEnabled ?? (platform as any).overlaysDashboard;
    if (typeof dashboardOverlaysFlag === "boolean") {
      setDashboardOverlaysEnabled(dashboardOverlaysFlag);
    }

    let appliedEff = false;

    if (eff && typeof eff === "object") {
      const features = eff.features || {};
      const limits = eff.limits || {};

      if (typeof eff.planId === "string") {
        setRecordingPlanId(eff.planId);
      }

      if (Object.prototype.hasOwnProperty.call(features, "recording")) {
        if (typeof (features as any).recording === "boolean") {
          setPlanRecordingEnabled((features as any).recording);
        }
      }

      if (Object.prototype.hasOwnProperty.call(features, "dualRecording")) {
        if (typeof (features as any).dualRecording === "boolean") {
          setDualRecordingAllowed((features as any).dualRecording);
        }
      }

      if (Object.prototype.hasOwnProperty.call(features, "watermark")) {
        if (typeof (features as any).watermark === "boolean") {
          setWatermarkEnabled((features as any).watermark);
        }
      }

      const hasRtmpLimit =
        Object.prototype.hasOwnProperty.call(limits, "rtmpDestinationsMax") ||
        Object.prototype.hasOwnProperty.call(limits as any, "maxDestinations");
      if (hasRtmpLimit) {
        const maxRtmpFromLimits =
          typeof limits.rtmpDestinationsMax === "number"
            ? limits.rtmpDestinationsMax
            : typeof (limits as any).maxDestinations === "number"
            ? (limits as any).maxDestinations
            : 0;
        setPlanRtmpDestinationsMax(maxRtmpFromLimits);
        if (Object.prototype.hasOwnProperty.call(features as any, "rtmpMultistream")) {
          if (typeof (features as any).rtmpMultistream === "boolean") {
            setPlanMultistreamEnabled((features as any).rtmpMultistream);
          }
        } else {
          setPlanMultistreamEnabled(maxRtmpFromLimits > 1);
        }
      }

      const runtimeHls = (features as any).hls ?? (features as any).hlsEnabled;
      const legacyHls = (features as any).canHls;
      if (
        Object.prototype.hasOwnProperty.call(features as any, "hls") ||
        Object.prototype.hasOwnProperty.call(features as any, "hlsEnabled") ||
        Object.prototype.hasOwnProperty.call(features as any, "canHls")
      ) {
        if (typeof runtimeHls === "boolean") {
          setPlanHlsEnabled(runtimeHls);
        } else if (typeof legacyHls === "boolean") {
          setPlanHlsEnabled(legacyHls);
        }
      }

      if (Object.prototype.hasOwnProperty.call(features as any, "hlsCustomizationEnabled")) {
        const customizationHls = (features as any).hlsCustomizationEnabled;
        if (typeof customizationHls === "boolean") {
          setPlanHlsCustomizationEnabled(customizationHls);
        }
      } else if (
        Object.prototype.hasOwnProperty.call(features as any, "hls") ||
        Object.prototype.hasOwnProperty.call(features as any, "hlsEnabled") ||
        Object.prototype.hasOwnProperty.call(features as any, "canHls")
      ) {
        const customizationHls = (features as any).hlsCustomizationEnabled;
        const runtime = (features as any).hls ?? (features as any).hlsEnabled;
        const legacy = (features as any).canHls;
        setPlanHlsCustomizationEnabled(
          typeof customizationHls === "boolean"
            ? customizationHls
            : typeof runtime === "boolean"
            ? runtime
            : !!legacy,
        );
      }

      if (Object.prototype.hasOwnProperty.call(limits, "maxGuests")) {
        if (typeof limits.maxGuests === "number") {
          setMaxGuestsAllowed(limits.maxGuests);
        }
      }

      if (Object.prototype.hasOwnProperty.call(limits, "maxRecordingMinutesPerClip")) {
        if (
          typeof limits.maxRecordingMinutesPerClip === "number" &&
          limits.maxRecordingMinutesPerClip > 0
        ) {
          setMaxRecordingMinutesPerClip(limits.maxRecordingMinutesPerClip);
        } else {
          setMaxRecordingMinutesPerClip(null);
        }
      }

      appliedEff = true;
    }

    if (appliedEff) {
      setEntitlementsReady(true);
    }
  };

  useEffect(() => {
    if (!hostCheckReady) return;
    if (!displayName) return;
    if (!roomId) return;
    // REMOVED GATE: Guests can now fetch tokens immediately, even when room is idle.
    // This eliminates polling delay - LiveKit's participant events will drive UX.
    // Old logic: if (!isHost && roomGateStatus !== "live") return;
    
    // If we already have a valid token+serverUrl for this mount, avoid
    // refetching room tokens on every minor state change. This prevents
    // duplicate /api/roomToken calls that can cause spurious 401s and
    // disconnects, while still allowing a fresh token on initial join.
    if (token && serverUrl) return;
    if (roomTokenMintInFlightRef.current) return;
    // Role used to mint the LiveKit token + roomAccessToken.
    // IMPORTANT: Hosts must request role="host" so /api/hls/start isn't rejected as insufficient_role.
    const requestedRole = isHost ? "host" : "participant";
    const role = requestedRole;

    const fetchToken = async () => {
      try {
        roomTokenMintInFlightRef.current = true;
        
        // Check for pre-fetched token data from consolidated join-now endpoint
        // This eliminates token fetch delay for guest invites
        try {
          const cachedTokenData = sessionStorage.getItem(`sl_lk_token:${roomId}`);
          if (cachedTokenData) {
            const parsed = JSON.parse(cachedTokenData);
            const age = Date.now() - (parsed.fetchedAt || 0);
            const cachedName = typeof parsed.displayName === "string" ? parsed.displayName.trim() : "";
            const chosenName = String(displayName || "").trim();
            const canUseCached =
              age < 5 * 60 * 1000 &&
              !!parsed.serverUrl &&
              !!parsed.token &&
              !!cachedName &&
              !!chosenName &&
              cachedName.toLowerCase() === chosenName.toLowerCase();

            // Use cached token only if it's fresh AND matches the name the user entered.
            // This ensures prefetch never overrides the display name selection flow.
            if (canUseCached) {
              console.log('[Room] Using pre-fetched LiveKit token (name matched; age:', Math.round(age / 1000), 'seconds)');
              setToken(parsed.token);
              setServerUrl(parsed.serverUrl);
              if (parsed.identity) setParticipantIdentity(parsed.identity);
              
              // Guests are RTC participants with mic+cam (not view-only)
              // isViewer stays false (invite guests can publish)
              
              // Clear the cached token after use to prevent stale data
              sessionStorage.removeItem(`sl_lk_token:${roomId}`);
              return;
            } else {
              console.log('[Room] Pre-fetched token expired, incomplete, or name mismatch; fetching fresh token');
              sessionStorage.removeItem(`sl_lk_token:${roomId}`);
            }
          }
        } catch (err) {
          console.warn('[Room] Failed to load pre-fetched token, falling back to fetch:', err);
        }
        
        console.log(`[Room] Fetching room token (role=${role || "host"})...`);
        const bearerToken = getAuthToken();
        // Force invite mode when a token is present in the URL and we are not authed.
        // This matches the legacy participant join flow: /room/<roomId>?t=<inviteToken>
        // Also fall back to any locally-stored invite token for backward compatibility.
        const guestSessionToken = getGuestSessionToken(roomId);
        console.log('[Room] Token fetch context:', {
          hasAuth: !!bearerToken,
          hasGuestToken: !!guestSessionToken,
          roomId,
          role,
          isHost,
          isViewer
        });
        const inviteTokenFromUrl = new URLSearchParams(window.location.search).get("t");
        const inviteTokenForJoin = (!guestSessionToken ? (inviteTokenFromUrl || inviteToken || null) : null)?.trim?.() || null;
        const buildRoomTokenRequest = () => {
          const canonicalRoomId = roomId || "";
          const endpoint = `${API_BASE}/api/rooms/${encodeURIComponent(canonicalRoomId)}/token`;
          const payload: any = { identity: getOrCreateUid() };

          // New API uses the URL roomId; keep displayName in the body so
          // participant name is set in LiveKit.

          // Tell the backend what role we want this token minted as.
          // The backend will clamp/lock it as needed.
          // If we failed auth for a privileged role, always request a low-trust role
          // for the guest fallback so the UI can honestly operate in viewer/guest mode.
          payload.role = role;

          payload.uid = getOrCreateUid();
          payload.displayName = displayName;
          // Always forward invite tokens when present.
          // This allows authenticated participants to join invite-scoped/private rooms
          // (server will clamp roles and validate invite-room match).
          if (inviteTokenForJoin) {
            payload.inviteToken = inviteTokenForJoin;
          }

          if (!bearerToken && guestSessionToken) {
            payload.guestSessionToken = guestSessionToken;
          }

          return { endpoint, payload };
        };

        const { endpoint, payload } = buildRoomTokenRequest();

        const mode: "auth" | "invite" = bearerToken ? "auth" : payload.inviteToken ? "invite" : "auth";
        const tokenRes = bearerToken
          ? await apiFetchAuth(
              endpoint,
              {
                method: "POST",
                headers: {
                  ...(inviteTokenForJoin ? { "x-invite-token": inviteTokenForJoin } : {}),
                },
                body: JSON.stringify(payload),
              },
              { allowNonOk: true },
            )
          : await apiFetch(
              endpoint,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(inviteTokenForJoin ? { "x-invite-token": inviteTokenForJoin } : {}),
                  ...(guestSessionToken ? { "x-guest-session": guestSessionToken } : {}),
                },
                body: JSON.stringify(payload),
              },
              { allowNonOk: true }
            );

        const attempt = { res: tokenRes, mode };

        const res = attempt.res;
        console.log("[Room] roomToken status:", res.status, "mode:", attempt.mode);
        setRoomTokenMode(attempt.mode);

        // If an authenticated mint succeeds, we can clear the banner without probing /me in the background.
        if (res.ok && attempt.mode === "auth") {
          setAuthStatus("authed");
          setNeedsReauth(false);
          setReauthBannerText("Session expired — re-auth to enable host tools.");
        }

        let data: any = null;
        let rawText: string | null = null;
        const ct = res.headers.get("content-type") || "";
        try {
          if (ct.includes("application/json")) {
            data = await res.json();
          } else {
            rawText = await res.text();
            try {
              data = JSON.parse(rawText);
            } catch (err) {
              console.error("[Room] Non-JSON response from /roomToken:", rawText);
              data = null;
            }
          }
        } catch (err) {
          console.error("[Room] Failed to parse response from /roomToken:", err);
          data = null;
        }

        if (!res.ok) {
          console.error("[Room] roomToken HTTP error", res.status, rawText);
          const errCode = extractApiErrorCode(data);
          const mapped = mapJoinErrorMessage(errCode);

          if (res.status === 409) {
            setRoomGateStatus("idle");
            if (mapped) setReauthBannerText(mapped);
            return;
          }

          if (res.status === 401) {
            setNeedsReauth(true);
            setAuthStatus("guest");
            setReauthBannerText(
              mapped ||
                (inviteToken
                  ? "Invite invalid or expired."
                  : "This room requires an account to join. Please sign in.")
            );
            // Only force login redirect when we truly have no invite to attempt guest join.
            if (!inviteToken) {
              try {
                const next = `${location.pathname}${location.search}`;
                nav(`/login?next=${encodeURIComponent(next)}`, { replace: true });
              } catch {
                // ignore
              }
            }
            return;
          }

          if (res.status === 403) {
            setNeedsReauth(true);
            setAuthStatus("guest");
            setReauthBannerText(mapped || "Not allowed to join this room.");
            return;
          }

          if (mapped) {
            setReauthBannerText(mapped);
          }
          return;
        }
        if (!data) {
          console.error("[Room] No data from /roomToken");
          return;
        }

        // SECURITY: Never log tokens in production - they're like passwords
        if (process.env.NODE_ENV === 'development') {
          console.log("[roomToken] response received:", {
            hasToken: !!data.token,
            hasServerUrl: !!data.serverUrl,
            roomId: data.roomId,
            role: data.role,
            isViewer: data.isViewer,
          });
        }
        
        if (typeof data?.token !== "string" || !data.token) {
          console.error("[Room] Invalid token returned (no token string)");
          return;
        }

        if (typeof data?.roomName === "string" && data.roomName.trim()) {
          setRoomName(data.roomName.trim());
        }

        if (data?.permissions && typeof data.permissions === "object") {
          setRoomPermissions({
            canStream: !!data.permissions.canStream,
            canRecord: !!data.permissions.canRecord,
            canDestinations: !!data.permissions.canDestinations,
            canModerate: !!data.permissions.canModerate,
            canLayout: !!data.permissions.canLayout,
            canScreenShare: !!data.permissions.canScreenShare,
            canInvite: !!data.permissions.canInvite,
            canAnalytics: !!data.permissions.canAnalytics,
          });
        } else {
          setRoomPermissions(null);
        }
        if (data.effectiveEntitlements || data.platformFlags) {
          applyEntitlementsAndPlatform(data.effectiveEntitlements, data.platformFlags || {});
        }
        const {
          token: lkToken,
          serverUrl: serverUrlFromApi,
          roomId: returnedRoomId,
          roomAccessToken: roomAccessTokenRaw,
          participantIdentity: participantIdentityRaw,
        } = data as any;
        if (typeof returnedRoomId === "string" && returnedRoomId.trim()) {
          setFirestoreRoomId(returnedRoomId.trim());
        } else {
          console.warn("[Room] /roomToken did not return roomId; leaving firestoreRoomId null", data);
          setFirestoreRoomId(null);
        }
        if (typeof roomAccessTokenRaw === "string" && roomAccessTokenRaw.trim()) {
          setRoomAccessToken(roomAccessTokenRaw.trim());
        } else {
          setRoomAccessToken(null);
        }

        if (typeof (data as any)?.adminOverride === "boolean") {
          setAdminOverride(!!(data as any).adminOverride);
        } else {
          setAdminOverride(false);
        }

        if (typeof participantIdentityRaw === "string" && participantIdentityRaw.trim()) {
          setParticipantIdentity(participantIdentityRaw.trim());
        } else {
          setParticipantIdentity(null);
        }
        const finalServerUrl = serverUrlFromApi || import.meta.env.VITE_LIVEKIT_URL;
        console.log("[Room] token received:", !!lkToken, "serverUrl:", finalServerUrl);
        setToken(typeof lkToken === "string" && lkToken.trim() ? lkToken : null);
        setServerUrl(finalServerUrl || null);
        // isViewer should always be false for /room (invite guests are RTC participants)
        if (typeof data?.isViewer === "boolean") {
          setIsViewer(data.isViewer); // Will be false from server for invite guests
        }
        if (typeof data?.effectiveRoleKey === "string") {
          setUserRole(data.effectiveRoleKey);
          if (data.effectiveRoleKey === "viewer") setIsHost(false);
          if (data.effectiveRoleKey === "host") setIsHost(true);
        } else if (typeof data?.role === "string") {
          setUserRole(data.role);
          if (data.role === "viewer") setIsHost(false);
          if (data.role === "host") setIsHost(true);
        }
        if (!lkToken || !finalServerUrl) {
          console.error("[Room] Missing token or serverUrl", { token: lkToken, serverUrl: serverUrlFromApi });
        }
      } catch (err) {
        console.error("[Room] fetchToken error:", err);
      } finally {
        roomTokenMintInFlightRef.current = false;
      }
    };

    fetchToken();
  }, [displayName, roomId, effectiveRoomName, inviteToken, userRole, isHost, hostCheckReady, token, serverUrl]);
  // REMOVED: roomGateStatus dependency - guests no longer wait for "live" status

  

  useEffect(() => {
    if (isViewer && showStreamSetup) {
      setShowStreamSetup(false);
    }
  }, [isViewer, showStreamSetup]);

  // Guest flow: Poll room status for INFORMATIONAL purposes only (not auth gating).
  // This updates UI hints but does NOT block token fetching or LiveKit connection.
  // Guests connect to LiveKit immediately; LiveKit's participant events drive the real UX.
  useEffect(() => {
    if (!roomId) return;

    // Host can proceed immediately.
    if (isHost) {
      setRoomGateStatus("live");
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const guestSessionToken = getGuestSessionToken(roomId);
        console.log('[Room] Guest polling room status (informational only, non-blocking)', { 
          roomId, 
          hasGuestToken: !!guestSessionToken, 
          hasInviteToken: !!inviteToken 
        });
        const res = await apiFetch(
          `/api/rooms/${encodeURIComponent(roomId)}/status`,
          {
            headers: {
              ...(!guestSessionToken && inviteToken ? { "x-invite-token": inviteToken } : {}),
              ...(guestSessionToken ? { "x-guest-session": guestSessionToken } : {}),
            },
          },
          { allowNonOk: true }
        );
        if (cancelled) return;

        if (res.status === 401 || res.status === 403) {
          const body = await res.json().catch(() => null);
          const errCode = extractApiErrorCode(body);
          const mapped = mapJoinErrorMessage(errCode);
          setRoomGateStatus("blocked");
          setNeedsReauth(true);
          setReauthBannerText(
            mapped || "This room requires an account to join. Please sign in or ask the host to enable guest access."
          );
          return;
        }

        if (!res.ok) {
          setRoomGateStatus("blocked");
          return;
        }

        const data = await res.json().catch(() => null);
        const status = data?.status === "live" ? "live" : "idle";
        console.log('[Room] Guest room status (informational):', status);
        setRoomGateStatus(status);

        if (status === "idle") {
          // Continue polling for informational UI updates
          roomGatePollRef.current = setTimeout(poll, 1500);
        } else {
          console.log('[Room] Room status is live (guest already connected via LiveKit)');
        }
      } catch {
        if (!cancelled) {
          roomGatePollRef.current = setTimeout(poll, 2000);
        }
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (roomGatePollRef.current) {
        clearTimeout(roomGatePollRef.current);
        roomGatePollRef.current = null;
      }
    };
  }, [roomId, isHost, inviteToken]);

  // Load effective entitlements + media presets only when the user explicitly opens host tools.
  // (Nuclear option 2: avoid background /me calls after connect.)
  useEffect(() => {
    const role = localStorage.getItem("sl_current_role") || userRole;
    if (role === "guest") return;
    if (!showStreamSetup && !(dashboardOpen && canManageStream)) return;
    if (needsReauth) return;
    if (!canManageStream) return;

    const toolsKey = `${roomId || ""}:${showStreamSetup ? "setup" : "dashboard"}`;
    if (hostToolsHydratedKeyRef.current === toolsKey) return;
    hostToolsHydratedKeyRef.current = toolsKey;

    let cancelled = false;

    (async () => {
      try {
        const [presetsRes, meRes] = await Promise.all([
          apiFetchAuth("/api/account/presets"),
          apiFetchAuth("/api/account/me"),
        ]);

        if (!cancelled && presetsRes.ok) {
          const payload = await presetsRes.json();
          const list = Array.isArray(payload?.presets) ? payload.presets : [];
          if (list.length) {
            setMediaPresets(list.map((p: any) => ({ id: p.id, label: p.label })));
          } else {
            setMediaPresets([
              { id: "standard_720p30", label: "Standard 720p30" },
              { id: "hd_1080p30", label: "HD Event 1080p30" },
            ]);
          }
        }

        if (!cancelled && (meRes.status === 401 || meRes.status === 403)) {
          setAuthStatus("guest");
          setNeedsReauth(true);
          return;
        }

        if (!cancelled && meRes.ok) {
          setAuthStatus("authed");
          const me = await meRes.json();
          const prefs = me?.mediaPrefs || {};
          if (prefs.defaultRecordingMode === "cloud" || prefs.defaultRecordingMode === "dual") {
            setDefaultRecordingModePref(prefs.defaultRecordingMode);
          }
          if (prefs.defaultPresetId) {
            setSelectedPresetId(prefs.defaultPresetId);
            setEffectivePresetId(prefs.defaultPresetId);
          }

          const eff = (me as any)?.effectiveEntitlements;
          const effPermMode = (me as any)?.effectivePermissionsMode;
          if (effPermMode === "advanced") {
            setEffectivePermissionsMode("advanced");
          } else {
            setEffectivePermissionsMode("simple");
          }
          const platformFlags = (me as any)?.platformFlags || {};
          applyEntitlementsAndPlatform(eff, platformFlags);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error("[Room] failed to load media prefs/entitlements", err);
          // If the error is a 401 (token expired / missing), enter the
          // in-room re-auth flow instead of silently degrading.
          if (err?.status === 401 || err?.name === "ApiUnauthorizedError") {
            setAuthStatus("guest");
            setNeedsReauth(true);
          }
          setMediaPresets((prev) =>
            prev.length
              ? prev
              : [
                  { id: "standard_720p30", label: "Standard 720p30" },
                  { id: "hd_1080p30", label: "HD Event 1080p30" },
                ]
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [API_BASE, userRole, showStreamSetup, dashboardOpen, canManageStream, needsReauth]);

  useEffect(() => {
    if (
      recordingStatus === "stopped" &&
      recordingId &&
      lastRecordingStatusRef.current !== "stopped"
    ) {
      setShowStreamEndedModal(true);
      setStayedInRoomDuringProcessing(false);
    } else if (recordingStatus !== "stopped") {
      setShowStreamEndedModal(false);
    }

    lastRecordingStatusRef.current = recordingStatus;
  }, [recordingStatus, recordingId]);

  // Keep polling recording readiness even if the StreamEndedModal is dismissed.
  // This prevents getting stuck in a "processing not finished" state after clicking "Stay in room".
  useEffect(() => {
    if (postStopIntervalRef.current) {
      clearInterval(postStopIntervalRef.current);
      postStopIntervalRef.current = null;
    }
    postStopPollCountRef.current = 0;

    if (recordingStatus !== "stopped" || !recordingId) {
      setPostStopProcessing(false);
      setPostStopReady(false);
      setPostStopStatus(null);
      setPostStopDownloadUrl(null);
      return;
    }

    let cancelled = false;
    const MAX_POLLS = 120; // 6 minutes at 3s interval

    const poll = async () => {
      postStopPollCountRef.current += 1;
      if (postStopPollCountRef.current > MAX_POLLS) {
        if (!cancelled) {
          setPostStopProcessing(false);
        }
        if (postStopIntervalRef.current) {
          clearInterval(postStopIntervalRef.current);
          postStopIntervalRef.current = null;
        }
        return;
      }

      try {
        const res = await apiFetchAuth(`${API_BASE}/api/recordings/${recordingId}`, {}, { allowNonOk: true });
        if (!res.ok) {
          if (!cancelled) setPostStopProcessing(true);
          return;
        }

        const payload = await res.json().catch(() => null);
        const status = String(payload?.data?.status ?? payload?.status ?? "unknown").toLowerCase();
        const downloadReady = payload?.data?.downloadReady === true || status === "ready";

        if (!cancelled) {
          setPostStopStatus(status);
          setPostStopProcessing(!downloadReady);
          setPostStopReady(downloadReady);
        }

        if (downloadReady && postStopIntervalRef.current) {
          clearInterval(postStopIntervalRef.current);
          postStopIntervalRef.current = null;
        }
      } catch {
        if (!cancelled) setPostStopProcessing(true);
      }
    };

    setPostStopProcessing(true);
    void poll();
    postStopIntervalRef.current = setInterval(() => {
      void poll();
    }, 3000);

    return () => {
      cancelled = true;
      if (postStopIntervalRef.current) {
        clearInterval(postStopIntervalRef.current);
        postStopIntervalRef.current = null;
      }
    };
  }, [API_BASE, recordingId, recordingStatus]);

  // When a post-stop recording becomes ready, prefetch the signed download URL.
  useEffect(() => {
    if (recordingStatus !== "stopped" || !recordingId) return;
    if (!postStopReady) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetchAuth(`${API_BASE}/api/recordings/${recordingId}/download-link`, {}, { allowNonOk: true });
        if (!res.ok) {
          if (!cancelled) setPostStopDownloadUrl(null);
          return;
        }
        const data = await res.json().catch(() => null);
        const url = data?.data?.url;
        if (!cancelled) setPostStopDownloadUrl(typeof url === "string" && url.trim() ? url.trim() : null);
      } catch {
        if (!cancelled) setPostStopDownloadUrl(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [API_BASE, recordingId, recordingStatus, postStopReady]);

  // Re-notify rule: if user clicked Stay in room for this recording, show a banner.
  // If they dismissed it while still processing, show a new one when ready.
  useEffect(() => {
    if (recordingStatus !== "stopped") return;
    if (!roomId || !recordingId) return;

    // Only show if a "Stay in room" action marked this recording as pending.
    const pendingId = sessionStorage.getItem(pendingDownloadBannerKey(roomId));
    if (!pendingId || pendingId !== recordingId) return;

    if (!postStopReady) return;

    // If the user dismissed the READY banner, don't show again.
    const dismissed = sessionStorage.getItem(recordingBannerDismissedKey(recordingId));
    if (dismissed === "ready") return;

    setStayedInRoomDuringProcessing(false);
    setRecordingBackgroundNotice({ kind: "ready", recordingId, downloadUrl: postStopDownloadUrl });

    // Optional: browser-level notification (only if the user previously allowed it).
    try {
      if (typeof window !== "undefined" && "Notification" in window) {
        if (window.Notification.permission === "granted") {
          const n = new window.Notification("Recording is ready to download", {
            body: "Click Download in the room banner (or open Settings → Usage → Latest video).",
          });
          n.onclick = () => {
            try {
              window.focus();
            } catch {}

            try {
              nav("/settings/billing", {
                state: {
                  openTab: "usage",
                  usageRoomId: effectiveRoomName || undefined,
                },
              });
            } catch {}
          };
        }
      }
    } catch {
      // ignore
    }
  }, [recordingStatus, roomId, recordingId, postStopReady, postStopDownloadUrl, nav, effectiveRoomName]);

  useEffect(() => {
    if (streamStatus === "live") {
      if (!streamStartTimeRef.current) {
        streamStartTimeRef.current = Date.now();
      }
      usagePostedRef.current = false;
      const interval = setInterval(() => {
        if (streamStartTimeRef.current) {
          const elapsed = Math.floor((Date.now() - streamStartTimeRef.current) / 1000);
          setElapsedTime(elapsed);
          lastElapsedRef.current = elapsed;
        }
      }, 1000);
      return () => clearInterval(interval);
    } else {
      streamStartTimeRef.current = null;
      setElapsedTime(0);
    }
  }, [streamStatus]);

  // Track recording elapsed time independently from stream timer
  useEffect(() => {
    if (recordingStatus === "recording") {
      if (!recordingStartRef.current) {
        recordingStartRef.current = Date.now();
        setRecordingElapsed(0);
      }
      const interval = setInterval(() => {
        if (recordingStartRef.current) {
          const elapsed = Math.floor((Date.now() - recordingStartRef.current) / 1000);
          setRecordingElapsed(elapsed);
        }
      }, 1000);
      return () => clearInterval(interval);
    }

    recordingStartRef.current = null;
    setRecordingElapsed(0);
  }, [recordingStatus]);

  // Auto-stop for per-clip cap when defined on plan (best-effort client-side)
  useEffect(() => {
    const capMinutes = maxRecordingMinutesPerClip;
    if (!capMinutes || recordingStatus !== "recording") return;

    const capSeconds = capMinutes * 60;
    if (recordingElapsed >= capSeconds && !autoStopTriggeredRef.current) {
      autoStopTriggeredRef.current = true;
      console.log("[Room] Recording cap reached; auto-stopping recording", {
        planId: recordingPlanId,
        capMinutes,
      });
      // Best-effort auto-stop; ignore errors (stopRecording handles alerts)
      (async () => {
        try {
          await stopRecording();
          setRecordingToast(
            `Recording stopped automatically after ${capMinutes} minutes. Start a new recording to continue.`
          );
          window.setTimeout(() => setRecordingToast(null), 5000);
        } catch (err) {
          console.error("[Room] auto-stop recording failed", err);
        }
      })();
    }
  }, [recordingElapsed, recordingStatus, maxRecordingMinutesPerClip, recordingPlanId]);

  // Load destinations only when the user explicitly opens host tools.
  useEffect(() => {
    const role = localStorage.getItem("sl_current_role") || userRole;
    if (role === "guest") return;
    if (!showStreamSetup && !(dashboardOpen && canManageStream)) return;
    if (needsReauth) return;
    if (!canManageStream) return;

    const loadDestinations = async () => {
      try {
        setDestinationsLoading(true);
        const res = await fetchDestinations({ includeDisabled: false });
        const items = res.items || [];
        setDestinations(items);
        const connectedEnabled = items.filter((d) => d.enabled && d.status === "connected");
        setDestinationsReady(connectedEnabled.length > 0);
      } catch (e: any) {
        console.error("destinations load failed", e);
        // Enter in-room re-auth flow on 401 so the user sees the
        // re-authenticate prompt instead of a broken host panel.
        if (e?.status === 401 || e?.name === "ApiUnauthorizedError") {
          setNeedsReauth(true);
        }
        setDestinationsReady(false);
      } finally {
        setDestinationsLoading(false);
      }
    };
    loadDestinations();
  }, [userRole, showStreamSetup, dashboardOpen, canManageStream, needsReauth]);

  async function refreshDestinations() {
    const role = localStorage.getItem("sl_current_role") || userRole;
    if (role === "guest") return;
    if (needsReauth) {
      setNeedsReauth(true);
      return;
    }
    if (!canManageStream) return;
    try {
      const res = await fetchDestinations({ includeDisabled: false });
      const items = res.items || [];
      setDestinations(items);
      const connectedEnabled = items.filter((d) => d.enabled && d.status === "connected");
      setDestinationsReady(connectedEnabled.length > 0);
    } catch (e: any) {
      // no-op — but enter re-auth on 401
      if (e?.status === 401 || e?.name === "ApiUnauthorizedError") {
        setNeedsReauth(true);
      }
    }
  }

  // Run preflight when modal opens (hard gate) - hosts only
  useEffect(() => {
    const role = localStorage.getItem("sl_current_role") || userRole;
    if (role === "guest") return;
    if (!canManageStream) return;
    const runPreflight = async () => {
      setPreflightLoading(true);
      try {
        const res = await preflight({});
        setPreflightResult(res);
        const connected = (res.destinations || []).filter((d: any) => d.status === "connected");
        setCanGoLive(connected.length > 0);
      } catch (e: any) {
        console.error("preflight failed", e);
        if (e?.status === 401 || e?.name === "ApiUnauthorizedError") {
          setNeedsReauth(true);
        }
        setCanGoLive(false);
      } finally {
        setPreflightLoading(false);
      }
    };
    if (showStreamSetup) runPreflight();
  }, [showStreamSetup, userRole, canManageStream]);

  function buildPreflightItems(): Array<{ id: string; label: string; ok: boolean; detail?: string }> {
    const dests = (preflightResult?.destinations || []) as Array<{ id: string; platform: string; status: string; statusReason?: string | null }>;
    const items: Array<{ id: string; label: string; ok: boolean; detail?: string }> = [];
    dests.forEach((d) => {
      const ok = d.status === "connected";
      items.push({ id: d.id, label: `${d.platform} destination`, ok, detail: d.statusReason || undefined });
    });
    // Static note for Facebook
    items.push({ id: "fb_note", label: "Facebook requires Go Live in FB console", ok: true });
    return items;
  }

  const sendUsageOnExit = async () => {
    const role = localStorage.getItem("sl_current_role") || userRole;
    if (role === "guest") return;
    if (usagePostedRef.current) {
      console.log("[usage] skip post: already sent");
      return;
    }
    const seconds = lastElapsedRef.current;
    if (!seconds || seconds <= 0) {
      console.log("[usage] skip post: no elapsed seconds", { seconds });
      return;
    }

    const minutes = Math.max(1, Math.round(seconds / 60));
    usagePostedRef.current = true;

    console.log("[usage] preparing post", { seconds, minutes });

    const payload: Record<string, any> = { minutes };
    try {
      const raw = localStorage.getItem("sl_user");
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          const uid = parsed?.id || parsed?.uid;
          if (uid) payload.uid = uid;
        } catch {}
      }
      if (!payload.uid) {
        payload.uid = getOrCreateUid();
      }
    } catch {
      payload.uid = getOrCreateUid();
    }

    console.log("[usage] sending streamEnded", payload);

    try {
      const res = await apiFetchAuth(
        `${API_BASE}/api/usage/streamEnded`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        { allowNonOk: true }
      );
      const text = await res.text();
      console.log("[usage] streamEnded response", { status: res.status, body: text });
    } catch (e) {
      console.error("Failed to post usage", e);
    }
  };

  const handleLeftRoom = () => {
    sendUsageOnExit();
    // Drop elevated cohost roles on leave; a fresh invite
    // (or host/participant flow) must re-establish them on rejoin.
    try {
      const storedRole = localStorage.getItem("sl_current_role");
      if (storedRole === "cohost") {
        localStorage.setItem("sl_current_role", "participant");
      }
    } catch {}

    // When the host leaves, request that the server
    // disconnect all remaining participants from this room.
    if (isHost && !adminOverride && effectiveRoomName && roomAccessToken) {
      try {
        apiFetchAuth(
          `${API_BASE}/api/roomModeration/remove-all`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-room-access-token": roomAccessToken,
            },
            body: JSON.stringify({ room: effectiveRoomName }),
          },
          { allowNonOk: true }
        ).catch(() => {
          // best-effort only
        });
      } catch {
        // ignore network errors here; clients will still leave locally
      }
    }

    nav('/join', { replace: true });
  };

  const handleHomeClick = () => {
    nav('/join', { replace: true });
  };

  const handleStayInRoom = () => {
    if (roomId && recordingId) {
      try {
        sessionStorage.setItem(pendingDownloadBannerKey(roomId), recordingId);
      } catch {}
    }

    if (!postStopReady) {
      setStayedInRoomDuringProcessing(true);

      if (recordingId) {
        // Show an immediate, dismissable banner with a disabled Download button.
        setRecordingBackgroundNotice({ kind: "processing", recordingId, downloadUrl: null });
      }

      // Request notification permission once (user gesture) so we can alert them when ready.
      try {
        if (typeof window !== "undefined" && "Notification" in window) {
          const alreadyAsked = localStorage.getItem("sl_recording_notify_perm_requested") === "1";
          if (!alreadyAsked && window.Notification.permission === "default") {
            localStorage.setItem("sl_recording_notify_perm_requested", "1");
            void window.Notification.requestPermission();
          }
        }
      } catch {
        // ignore
      }
    } else {
      // If ready already, show the banner immediately.
      if (recordingId) {
        setRecordingBackgroundNotice({ kind: "ready", recordingId, downloadUrl: postStopDownloadUrl });
      }
    }
    setShowStreamEndedModal(false);
  };

  const activePresetId = effectivePresetId || selectedPresetId;
  const activePresetLabel = presetLabelFor(activePresetId);

  const startRecording = async ({
    layout = "grid",
    mode = "cloud",
    presetId,
  }: { mode: "cloud" | "dual"; presetId?: string }) => {
    if (isViewer) {
      console.warn("startRecording blocked for viewer role");
      return;
    }
    if (needsReauth) {
      setNeedsReauth(true);
      return;
    }
    if (isGuestRole) {
      alert("Recording requires an account. Please sign in.");
      return;
    }
    if (!can("canRecord")) {
      alert("You don't have permission to start recording in this room.");
      return;
    }
    if (!roomId) {
      console.log("❌ No roomId, can't start recording");
      return;
    }
    if (recordingRef.current || recordingStatus === "recording" || isRecordingCountdown) {
      console.log("⏳ Recording already in progress or countdown active, skipping startRecording call.");
      return;
    }

    const requestedMode = mode === "dual" && !dualRecordingAllowed ? "cloud" : mode;
    if (mode === "dual" && !dualRecordingAllowed) {
      console.warn("Dual recording requested but not allowed; falling back to cloud mode.");
    }

    console.log("🎬 startRecording called. roomId:", roomId, "mode:", requestedMode);

    autoStopTriggeredRef.current = false;

    // Show a quick 3-2-1 countdown before kicking off the recording
    const sequence = ["3", "2", "1"];
    const stepMs = 900;
    recordingCountdownTimersRef.current.forEach(clearTimeout);
    recordingCountdownTimersRef.current = [];
    setIsRecordingCountdown(true);
    setRecordingCountdown(sequence[0]);

    sequence.slice(1).forEach((val, idx) => {
      const t = setTimeout(() => setRecordingCountdown(val), (idx + 1) * stepMs);
      recordingCountdownTimersRef.current.push(t);
    });

    const startTimer = setTimeout(async () => {
      setRecordingCountdown("You're recording");
      try {
        console.log("📡 Calling apiStartRecording...");
        const response = await apiStartRecording(roomId, requestedMode, presetId || selectedPresetId, roomAccessToken || undefined);
        console.log("📡 Got response:", response);
        const recId = response?.data?.recordingId ?? response?.recordingId;
        console.log("🎬 Extracted recordingId:", recId);
        if (!recId || recId === "unknown") {
          console.error("❌ Invalid recordingId:", recId);
          setRecordingStatus("error");
          return;
        }
        recordingRef.current = recId;
        setRecordingId(recId);
        recordingStartRef.current = Date.now();
        setRecordingElapsed(0);
        streamStartTimeRef.current = Date.now();
        setRecordingStatus("recording");
        const effective = response?.effectivePresetId || response?.data?.effectivePresetId || presetId || selectedPresetId;
        if (effective) setEffectivePresetId(effective);
        const clamped = response?.presetClamped || response?.data?.presetClamped;
        setPresetClamped(!!clamped && effective !== (presetId || selectedPresetId));
        console.log("✅ Recording started!");
      } catch (e) {
        console.error("❌ Failed to start recording:", e);
        setRecordingStatus("error");
        const anyErr: any = e as any;
        const body = anyErr?.body;
        const code = String(body?.error || body?.code || "").trim();
        const friendly = code ? getFeatureErrorMessage(code, "recording") : null;
        alert(friendly ? `Failed to start recording: ${friendly}` : `Failed to start recording: ${anyErr?.message || "Unknown error"}`);
      } finally {
        const clearTimer = setTimeout(() => {
          setRecordingCountdown(null);
          setIsRecordingCountdown(false);
        }, stepMs);
        recordingCountdownTimersRef.current.push(clearTimer);
      }
    }, sequence.length * stepMs);

    recordingCountdownTimersRef.current.push(startTimer);
  };

  const stopRecording = async () => {
    if (isViewer) {
      console.warn("stopRecording blocked for viewer role");
      return;
    }
    if (needsReauth) {
      setNeedsReauth(true);
      return;
    }
    if (isGuestRole) {
      alert("Recording requires an account. Please sign in.");
      return;
    }
    if (!can("canRecord")) {
      alert("You don't have permission to stop recording in this room.");
      return;
    }
    console.log("🛑 stopRecording called");
    const id = recordingRef.current;
    if (!id || id === "unknown") {
      console.error("❌ No valid recording ID to stop!");
      setRecordingStatus("error");
      return;
    }
    console.log("🛑 Stopping recording with ID:", id);
    setRecordingStatus("stopping");
    try {
      await apiStopRecording(id, roomAccessToken || undefined);
      console.log("✅ Recording stopped successfully");
      setRecordingStatus("stopped");
      setRecordingId(id);
      recordingRef.current = null; // allow subsequent recordings after stop
      recordingStartRef.current = null;
      autoStopTriggeredRef.current = false;
    } catch (e) {
      console.error("❌ Failed to stop recording:", e);
      setRecordingStatus("error");
      alert(`Failed to stop recording: ${(e as Error).message || "Unknown error"}`);
    }
  };

  const bestEffortStopHls = async (reason: string) => {
    if (!roomId) return;
    if (!canManageStream) return;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      console.warn(`bestEffortStopHls(${reason}) timed out; aborting`);
      controller.abort();
    }, 8000);
    try {
      const res = await apiFetchAuth(
        `${API_BASE}/api/hls/stop/${encodeURIComponent(roomId)}`,
        {
          method: "POST",
          headers: roomAccessToken ? { "x-room-access-token": roomAccessToken } : undefined,
          signal: controller.signal,
        },
        { allowNonOk: true }
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(`bestEffortStopHls(${reason}) non-ok`, res.status, text);
      }
    } catch (err) {
      if ((err as any)?.name === "AbortError") {
        console.warn(`bestEffortStopHls(${reason}) aborted due to timeout`, err);
      } else {
        console.warn(`bestEffortStopHls(${reason}) failed`, err);
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const handleEndStream = async () => {
    if (canManageStream && streamStatus === "live") {
      alert("⏹️ Stream is still live. Stop the stream first.");
      return;
    }
    if (canManageStream && recordingStatus === "recording") {
      alert("⏹️ Recording is still active. Stop the stream first.");
      return;
    }
    // Best-effort cleanup: prevent lingering HLS egress from a prior session.
    await bestEffortStopHls("end-stream");
    // At this point stream/recording are stopped. Exit to Join.
    handleLeftRoom();
  };

  const handleLeaveRoom = () => {
    handleLeftRoom();
  };

  type EffectiveDestinationInput = {
    platform: "youtube" | "facebook" | "twitch" | "custom";
    source: "main" | "session";
    streamKey?: string;
    destinationId?: string;
    targetId?: string;
    rtmpUrlBase?: string;
  };

  type ExtraRtmpDestination = {
    type: "instagram";
    protocol: "rtmp";
    rtmpUrl: string;
    streamKey: string;
    label?: string;
  };

  const handleStartMultistream = async (keys: {
    youtubeKey?: string;
    facebookKey?: string;
    twitchKey?: string;
    record?: boolean;
    layout?: "speaker" | "grid";
    enabledTargetIds?: string[];
    sessionKeys?: Record<string, { rtmpUrlBase?: string; streamKey?: string }>;
    destinations?: EffectiveDestinationInput[];
    extraDestinations?: ExtraRtmpDestination[];
  }) => {
    if (isViewer) {
      alert("View-only mode: publishing controls are disabled.");
      return;
    }
    if (needsReauth) {
      setNeedsReauth(true);
      return;
    }
    if (isGuestRole) {
      alert("Going live requires an account. Please sign in.");
      return;
    }
    if (!can("canStream") && !can("canDestinations")) {
      alert("You don't have permission to manage streaming in this room.");
      return;
    }
    if (streamStatus === "starting" || streamStatus === "live") return;
    if (isLiveCountdown) return;
    if (!roomId) {
      alert("No room id");
      return;
    }
    console.log("🎬 Room.tsx - handleStartMultistream called");
    const startLivePayload = normalizeStartLivePayloadFromDestinationsKeys({ ...keys, presetId: selectedPresetId });
    const destIds = Array.isArray(startLivePayload.enabledTargetIds) ? startLivePayload.enabledTargetIds : [];
    const sessionKeyMap = startLivePayload.sessionKeys ? { ...startLivePayload.sessionKeys } : {};
    const hasSessionKeys = Object.values(sessionKeyMap || {}).some((entry) => !!entry?.streamKey);
    const youtubeKey = startLivePayload.youtubeStreamKey;
    const facebookKey = startLivePayload.facebookStreamKey;
    const twitchKey = startLivePayload.twitchStreamKey;
    const hasDirectKeys = !!(youtubeKey || facebookKey || twitchKey);
    const extraDestinations = Array.isArray(startLivePayload.extraDestinations) ? startLivePayload.extraDestinations : [];
    const hasExtraDestinations = extraDestinations.length > 0;

    if (!hasDirectKeys && !hasSessionKeys && destIds.length === 0 && !hasExtraDestinations) {
      alert("Select at least one stream destination or enter a stream key.");
      return;
    }
    const sequence = ["3", "2", "1"];
    const stepMs = 900;
    liveCountdownTimersRef.current.forEach(clearTimeout);
    liveCountdownTimersRef.current = [];
    setIsLiveCountdown(true);
    setLiveCountdown(sequence[0]);

    sequence.slice(1).forEach((val, idx) => {
      const t = setTimeout(() => setLiveCountdown(val), (idx + 1) * stepMs);
      liveCountdownTimersRef.current.push(t);
    });

    const startTimer = setTimeout(async () => {
      setLiveCountdown("You're live");
      try {
        setStreamStatus("starting");
        const requestBody = {
          ...startLivePayload,
          userId: getOrCreateUid(),
        };
        const res = await apiFetchAuth(
          `${API_BASE}/api/multistream/${encodeURIComponent(roomId)}/start-multistream`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(roomAccessToken ? { "x-room-access-token": roomAccessToken } : {}),
            },
            body: JSON.stringify(requestBody),
          },
          { allowNonOk: true }
        );
        const raw = await res.text();
        let data: any = {};
        if (raw && raw.trim().length > 0) {
          try {
            data = JSON.parse(raw);
          } catch {
            console.warn("start-multistream parse error");
            data = { raw };
          }
        } else {
          console.warn("start-multistream empty response body");
          data = { raw: "" };
        }
        if (!res.ok) {
          const code = data?.error ?? data?.code ?? data?.data?.error ?? data?.data?.code;
          const mapped = getFeatureErrorMessage(code, code === "TRANSCODE_DISABLED" ? "transcode" : "multistream");
          const message =
            mapped !== "Feature unavailable."
              ? mapped
              : `Failed to start streaming to Stream Destinations: ${data?.message || data?.error || "Unknown error"}`;

          if (code === "TRANSCODE_DISABLED") {
            console.warn("Start multistream blocked by transcode kill-switch");
          } else {
            console.error("Start multistream failed", data);
          }

          alert(message);
          setStreamStatus("idle");
          return;
        }
        if (data?.success === false || data?.error) {
          const code = data?.error ?? data?.code ?? data?.data?.error ?? data?.data?.code;
          const mapped = getFeatureErrorMessage(code, code === "TRANSCODE_DISABLED" ? "transcode" : "multistream");
          const message =
            mapped !== "Feature unavailable."
              ? mapped
              : `Failed to start streaming to Stream Destinations: ${data?.message || data?.error || "Unknown error"}`;

          if (code === "TRANSCODE_DISABLED") {
            console.warn("Start multistream blocked by transcode kill-switch");
          } else {
            console.error("Start multistream API indicated failure", data);
          }

          alert(message);
          setStreamStatus("idle");
          return;
        }
        const egressIdVal = data?.data?.egressId ?? data?.egressId ?? data?.data?.id ?? data?.id;
        streamEgressRef.current = egressIdVal || null;
        setStreamStatus("live");
        streamStartTimeRef.current = Date.now();
        setDidStreamThisSession(true);
        const effective = data?.effectivePresetId || data?.data?.effectivePresetId || selectedPresetId;
        if (effective) setEffectivePresetId(effective);
        setPresetClamped(!!(data?.presetClamped || data?.data?.presetClamped) && effective !== selectedPresetId);
        if (keys.record) {
          await startRecording({ layout: keys.layout ?? "grid", mode: "cloud", presetId: selectedPresetId });
        }
        console.log("✅ Stream started! Egress ID:", egressIdVal);
      } catch (err) {
        console.error("Error starting multistream:", err);
        alert("Error starting stream");
        setStreamStatus("idle");
      } finally {
        const clearTimer = setTimeout(() => {
          setLiveCountdown(null);
          setIsLiveCountdown(false);
        }, stepMs);
        liveCountdownTimersRef.current.push(clearTimer);
      }
    }, sequence.length * stepMs);

    liveCountdownTimersRef.current.push(startTimer);
  };

  const handleStopMultistream = async () => {
    if (isViewer) {
      alert("View-only mode: publishing controls are disabled.");
      return;
    }
    if (needsReauth) {
      setNeedsReauth(true);
      return;
    }
    if (isGuestRole) {
      alert("Going live requires an account. Please sign in.");
      return;
    }
    if (!can("canStream") && !can("canDestinations")) {
      alert("You don't have permission to manage streaming in this room.");
      return;
    }
    const streamEgressId = streamEgressRef.current;
    if (!streamEgressId) {
      alert("No active stream");
      return;
    }
    if (!roomId) {
      alert("No room id");
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      console.warn("stop-multistream request timed out; aborting");
      controller.abort();
    }, 10000);
    try {
      setStreamStatus("stopping");
      const res = await apiFetchAuth(
        `${API_BASE}/api/multistream/${encodeURIComponent(roomId)}/stop-multistream`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(roomAccessToken ? { "x-room-access-token": roomAccessToken } : {}),
          },
          body: JSON.stringify({ egressId: streamEgressId }),
          signal: controller.signal,
        },
        { allowNonOk: true }
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("Failed to stop multistream", res.status, text);
        alert(
          "We couldn't confirm that the stream fully stopped. If it still appears live, try refreshing or stopping it from the platform dashboard."
        );
      }
    } catch (err) {
      if ((err as any)?.name === "AbortError") {
        console.warn("stop-multistream aborted due to timeout", err);
      } else {
        console.error("Error stopping multistream", err);
      }
      alert(
        "We couldn't confirm that the stream fully stopped. If it still appears live, try refreshing or stopping it from the platform dashboard."
      );
    } finally {
      window.clearTimeout(timeoutId);
      setEgressId(null);
      setStreamStatus("idle");
      streamEgressRef.current = null;
      void bestEffortStopHls("stop-multistream");
      if (recordingStatus === "recording") {
        console.log("ℹ️ Stream stopped but recording still active");
      }
    }
  };

  const copyInviteLink = (_role: "participant", label: string) => {
    (async () => {
      try {
        if (!roomId && !effectiveRoomName) {
          alert("No room identity available yet");
          return;
        }
        const res = await apiFetchAuth(
          `${API_BASE}/api/invites/create`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roomId: roomId || undefined, roomName: effectiveRoomName || undefined, role: _role }),
          },
          { allowNonOk: true }
        );

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.inviteToken) {
          alert("Failed to create invite link");
          return;
        }

        const base = APP_BASE || window.location.origin;
        const relativeUrl = typeof data?.url === "string" && data.url.startsWith("/")
          ? data.url
          : `/room?t=${encodeURIComponent(data.inviteToken)}`;
        const url = `${base}${relativeUrl}`;
        await navigator.clipboard.writeText(url);

        setCopiedInviteLabel(label);
        if (copiedInviteTimeoutRef.current) {
          window.clearTimeout(copiedInviteTimeoutRef.current);
        }
        copiedInviteTimeoutRef.current = window.setTimeout(() => {
          setCopiedInviteLabel(null);
          copiedInviteTimeoutRef.current = null;
        }, 4000);
      } catch (err) {
        console.error("invite create failed", err);
        alert("Failed to create invite link");
      }
    })();
  };

  const copyViewerLink = async () => {
    if (!roomId) {
      alert("Viewer link is unavailable until roomId is known");
      return;
    }
    const base = APP_BASE || window.location.origin;
    const url = `${base}/live/${encodeURIComponent(roomId)}`;
    try {
      await navigator.clipboard.writeText(url);
      alert(`Viewer link copied!\n${url}`);
    } catch (err) {
      console.error("copy viewer link failed", err);
      alert("Copy failed");
    }
  };

  // ==================== RENDER ====================

  if (!displayName) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000000',
        color: '#ffffff',
        padding: '1.5rem',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{
          position: 'absolute',
          top: '20%',
          left: '15%',
          width: '200px',
          height: '200px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #dc2626, #ef4444)',
          opacity: 0.1,
          filter: 'blur(30px)',
          animation: 'float 7s ease-in-out infinite'
        }} />
        <div style={{
          position: 'absolute',
          bottom: '25%',
          right: '20%',
          width: '150px',
          height: '150px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #ef4444, #dc2626)',
          opacity: 0.08,
          filter: 'blur(25px)',
          animation: 'float 9s ease-in-out infinite reverse'
        }} />

        <style>{`
          @keyframes float {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-15px) rotate(180deg); }
          }
        `}</style>

        <form
          style={{
            background: 'rgba(39, 39, 42, 0.5)',
            borderRadius: '1rem',
            padding: '2rem',
            width: '100%',
            maxWidth: '400px',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            border: '1px solid rgba(63, 63, 70, 0.8)',
            backdropFilter: 'blur(20px)',
            position: 'relative',
            zIndex: 1,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
          }}
          onSubmit={(e) => {
            e.preventDefault();
            const name = pendingName.trim();
            if (!name) return;
            localStorage.setItem("sl_displayName", name);
            setDisplayName(name);
          }}
        >
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: '600',
              textAlign: 'center',
              marginBottom: '0.5rem',
              color: '#ffffff'
            }}
          >
            Enter your name to join
          </h1>

          <input
            type="text"
            style={{
              width: '100%',
              padding: '0.875rem',
              borderRadius: '0.75rem',
              background: 'rgba(31, 41, 55, 0.8)',
              color: '#ffffff',
              border: '1px solid rgba(75, 85, 99, 0.5)',
              outline: 'none',
              transition: 'all 0.3s ease',
              backdropFilter: 'blur(10px)'
            }}
            onFocus={(e) => (e.target as HTMLInputElement).style.borderColor = '#dc2626'}
            onBlur={(e) => (e.target as HTMLInputElement).style.borderColor = 'rgba(75, 85, 99, 0.5)'}
            placeholder={`Enter your name to join "${roomName}"`}
            value={pendingName}
            onChange={(e) => setPendingName(e.target.value)}
            autoFocus
          />

          <button
            type="submit"
            disabled={!pendingName.trim()}
            style={{
              width: '100%',
              padding: '0.875rem',
              borderRadius: '0.75rem',
              background: !pendingName.trim()
                ? 'rgba(75, 85, 99, 0.5)'
                : 'linear-gradient(135deg, #dc2626, #ef4444)',
              color: '#ffffff',
              fontWeight: '600',
              border: 'none',
              cursor: !pendingName.trim() ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s ease',
              opacity: !pendingName.trim() ? 0.6 : 1,
            }}
          >
            Join Room
          </button>
        </form>

        <p style={{
          fontSize: '0.875rem',
          textAlign: 'center',
          marginTop: '1rem',
          color: 'rgba(255, 255, 255, 0.7)',
          position: 'relative',
          zIndex: 1,
          maxWidth: '400px',
          lineHeight: 1.5
        }}>
          When you enter the room, tap the microphone and camera icons to enable audio and video.
        </p>

        <img
          src="/logosmall.png"
          alt="StreamLine Logo"
          className="mt-6 w-40 opacity-90"
        />
      </div>
    );
  }

  if (showGoodbye) {
    return <ThankYouScreen showHomeButton={isHost} onHome={handleHomeClick} />;
  }

  const guestCapLabel = typeof maxGuestsAllowed === "number" && maxGuestsAllowed > 0 ? `${maxGuestsAllowed}` : "—";

  const entitlementSummary = `Rec:${planRecordingEnabled ? "on" : "off"} • Dual:${dualRecordingAllowed ? "on" : "off"} • RTMP:${rtmpCap === 0 ? "off" : rtmpCap === 1 ? "1" : `up to ${rtmpCap}`} • HLS:${planHlsEnabled ? "on" : "off"} • HLS Setup:${planHlsCustomizationEnabled ? "on" : "off"} • Guests:${guestCapLabel}`;
  const recordingEnabled =
    planRecordingEnabled &&
    platformRecordingEnabled &&
    !needsReauth &&
    !isViewer &&
    (isHost || can("canRecord") || !!effectiveControls.canStartStopRecording);
  const canMultistream =
    featureAccess.canUse.destinations &&
    !needsReauth &&
    !isViewer &&
    (isHost || can("canDestinations") || !!effectiveControls.canManageDestinations);
  const hlsAvailable = featureAccess.canUse.hlsRuntime && !needsReauth;
  const canStartStopHls =
    !isViewer &&
    (isHost || can("canStream") || !!effectiveControls.canStartStopStream);

  const handleUpgradeHls = () => {
    nav("/settings/billing");
  };

  const myPlanId =
    typeof (myEffectiveEntitlements as any)?.planId === "string"
      ? String((myEffectiveEntitlements as any).planId)
      : typeof recordingPlanId === "string"
        ? recordingPlanId
        : null;

  const showUpgradeButton = myPlanId === "free" || myPlanId === "starter" || myPlanId === "basic";

  const handleUpgradePlanFromRoom = () => {
    const recordingActive =
      recordingStatus === "recording" ||
      recordingStatus === "stopping" ||
      isRecordingCountdown;

    const streamingActive = streamStatus !== "idle";

    const hlsStatus = String(hlsStatusData?.status || "").toLowerCase();
    const hlsActive =
      !!roomId &&
      !!roomAccessToken &&
      (hlsStatus === "starting" || hlsStatus === "live" || hlsStatus === "active");

    if (recordingActive || streamingActive || hlsActive) {
      const blockers: string[] = [];
      if (recordingActive) blockers.push("recording");
      if (streamingActive) blockers.push("streaming");
      if (hlsActive) blockers.push("HLS");

      alert(`You can't leave the room while ${blockers.join(", ")}${blockers.length === 1 ? " is" : " are"} running. Stop it first, then upgrade.`);
      return;
    }

    nav("/settings/billing");
  };

  return (
    <>
      <RoleChangeToast message={roleChangeMessage} />
      {isViewer && (
        <div className="w-full bg-amber-500 text-black text-sm font-semibold px-4 py-2 flex items-center gap-2">
          👀 View-only mode — publishing controls are disabled.
        </div>
      )}
      {/* REMOVED: Old "Not started yet" banner - guests now connect immediately to LiveKit.
          WaitingForHostBanner (inside LiveKitRoom) shows real-time participant status instead. */}
      {!isViewer && needsReauth && (
        <div className="w-full bg-red-600 text-white text-sm font-semibold px-4 py-2 flex items-center justify-between gap-3">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span>{reauthBannerText}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={openReauthInNewTab}
              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded text-sm font-semibold"
              title="Opens login in a new tab"
            >
              Re-auth
            </button>
            <button
              onClick={confirmReauthed}
              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded text-sm font-semibold"
              title="Checks auth once, without reconnecting"
            >
              Enable tools
            </button>
          </div>
        </div>
      )}

      {DEV_CONTROLS && canManageStream && roomId && roomAccessToken && (
        <div style={{ position: "fixed", top: 72, right: 16, zIndex: 1200 }}>
          <button
            onClick={() => setControlsPanelOpen((v) => !v)}
            style={{
              padding: "0.4rem 0.6rem",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.25)",
              background: "rgba(0,0,0,0.4)",
              color: "#fff",
              fontSize: 12,
              cursor: "pointer",
            }}
            title="Realtime guest controls"
          >
            Guest controls
          </button>

          {controlsPanelOpen && (
            <div
              style={{
                marginTop: 8,
                width: 220,
                padding: 12,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(15, 23, 42, 0.92)",
                color: "#e5e7eb",
                boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "#fff" }}>
                Room controls (live)
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={effectiveControls.canPublishAudio}
                  onChange={(e) => updateRoomControls({ canPublishAudio: e.target.checked })}
                />
                Guests can publish audio
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={effectiveControls.tileVisible}
                  onChange={(e) => updateRoomControls({ tileVisible: e.target.checked })}
                />
                Guest tile visible
              </label>

              {needsReauth && (
                <div style={{ marginTop: 10, fontSize: 11, color: "#fecaca" }}>
                  Session expired — re-auth to continue.
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {recordingCountdown && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            zIndex: 50,
          }}
        >
          <div
            key={recordingCountdown}
            style={{
              padding: "14px 22px",
              borderRadius: "12px",
              background: "rgba(0, 0, 0, 0.65)",
              color: "#ffffff",
              fontSize: "30px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
              animation: "fadeScale 0.9s ease",
            }}
          >
            {recordingCountdown}
          </div>
        </div>
      )}
      {recordingStatus === "recording" && (
        <div className="fixed bottom-16 left-4 flex items-center gap-2 bg-red-600 px-4 py-3 rounded-lg shadow-lg z-40">
          <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
          <span className="text-sm font-bold">RECORDING</span>
          <span className="text-xs text-gray-200 ml-2">{recordingId}</span>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-2 bg-black text-white sl-topbar border-b border-gray-700">
        <div className="flex items-center gap-4">
          <button
            onClick={handleEndStream}
            disabled={recordingStatus === "stopping"}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded font-semibold text-sm transition disabled:opacity-50"
          >
            {recordingStatus === "stopping" ? "⏳ Exiting..." : "Exit Room"}
          </button>

          <span className="text-sm opacity-80">{roomName}</span>

          {canInviteLinks && (
            <button
              onClick={() => setInviteModalOpen(true)}
              style={{
                fontSize: '0.75rem',
                padding: '0.5rem 0.75rem',
                border: '1px solid rgba(34, 197, 94, 0.4)',
                borderRadius: '0.375rem',
                background: 'rgba(34, 197, 94, 0.05)',
                color: '#22c55e',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                fontWeight: '500'
              }}
              title="Copy invite links"
            >
              🔗 Invite Links
            </button>
          )}

          {showUpgradeButton && (
            <button
              onClick={handleUpgradePlanFromRoom}
              style={{
                fontSize: '0.75rem',
                padding: '0.5rem 0.75rem',
                border: '1px solid rgba(251, 191, 36, 0.55)',
                borderRadius: '0.375rem',
                background: 'rgba(251, 191, 36, 0.08)',
                color: '#fbbf24',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                fontWeight: '600'
              }}
              title="Upgrade your plan"
            >
              ⬆️ Upgrade
            </button>
          )}

          {streamStatus === "live" && (
            <div
              style={{
                fontSize: '0.75rem',
                padding: '0.5rem 0.75rem',
                border: '1px solid rgba(220, 38, 38, 0.4)',
                borderRadius: '0.375rem',
                background: 'rgba(220, 38, 38, 0.05)',
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontWeight: '500',
                fontFamily: 'monospace'
              }}
            >
              🔴 {`${Math.floor(elapsedTime / 60)}:${String(elapsedTime % 60).padStart(2, '0')}`}
            </div>
          )}
        </div>

        {!isViewer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {isHost && (
              <>
                <div style={{
                  padding: '0.35rem 0.6rem',
                  borderRadius: '0.375rem',
                  border: '1px solid rgba(148, 163, 184, 0.4)',
                  color: '#e5e7eb',
                  fontSize: '0.7rem',
                  background: 'rgba(255, 255, 255, 0.04)',
                  whiteSpace: 'nowrap'
                }}>
                  {entitlementSummary}
                </div>
                <div style={{
                  padding: '0.35rem 0.6rem',
                  borderRadius: '0.375rem',
                  border: presetClamped ? '1px solid rgba(251,191,36,0.6)' : '1px solid rgba(148, 163, 184, 0.35)',
                  color: presetClamped ? '#fbbf24' : '#e5e7eb',
                  fontSize: '0.7rem',
                  background: presetClamped ? 'rgba(251,191,36,0.12)' : 'rgba(255, 255, 255, 0.04)',
                  whiteSpace: 'nowrap'
                }}>
                  Preset: {activePresetLabel}{presetClamped ? " (clamped)" : ""}
                </div>
              </>
            )}
            <button
              onClick={() => setDashboardOpen(v => !v)}
              style={{
                fontSize: '0.75rem',
                padding: '0.5rem 0.75rem',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                borderRadius: '0.375rem',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
            >
              Dashboard
            </button>

            {canManageStream && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: '#ffffff' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: streamStatus === "live" ? "#ef4444" : "#6b7280"
                    }}
                  />
                  <span>{streamStatus === "live" ? "LIVE" : "OFFLINE"}</span>
                </div>

                <button
                  onClick={() => setShowStreamSetup(v => !v)}
                  style={{
                    padding: '0.375rem 0.75rem',
                    fontSize: '0.75rem',
                    borderRadius: '0.375rem',
                    background: 'linear-gradient(135deg, #dc2626, #ef4444)',
                    color: '#ffffff',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    fontWeight: '500'
                  }}
                >
                  {streamStatus === "live" ? "Manage Stream" : "Setup Stream"}
                </button>
              </>
            )}

            {!canManageStream && !isViewer && roomTokenMode === "guest" && (
              <button
                disabled
                title="Host auth required"
                style={{
                  padding: '0.375rem 0.75rem',
                  fontSize: '0.75rem',
                  borderRadius: '0.375rem',
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: 'rgba(255, 255, 255, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.18)',
                  cursor: 'not-allowed',
                  fontWeight: '500'
                }}
              >
                Setup Stream
              </button>
            )}
          </div>
        )}
      </div>

      {token && serverUrl && (
        <LiveKitShell
          token={token}
          serverUrl={serverUrl}
          isHost={isHost}
          isViewer={isViewer}
          roomId={roomId}
          subjectToControls={subjectToControls}
          controlsAllowPublishAudio={controlsAllowPublishAudio}
          controlsTileVisible={controlsTileVisible}
          controlsAllowScreenShare={controlsAllowScreenShare}
          watermarkEnabled={watermarkEnabled}
          dashboardOpen={dashboardOpen}
          onCloseDashboard={() => setDashboardOpen(false)}
          roomName={roomName || ""}
          roomAccessToken={roomAccessToken}
          canMuteGuests={canMuteGuestsUi}
          canRemoveGuests={canRemoveGuestsUi}
          canModerate={canModerateUi}
          effectivePermissionsMode={effectivePermissionsMode}
          dashboardGreenroomEnabled={dashboardGreenroomEnabled}
          dashboardOverlaysEnabled={dashboardOverlaysEnabled}
          dashboardRole={isHost ? "host" : "participant"}
          onLeaveRequested={() => {
            void handleEndStream();
          }}
          onDisconnected={handleLeftRoom}
        />
      )}

      {inviteModalOpen && canInviteLinks && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setInviteModalOpen(false)}
        >
          <div
            style={{
              width: "min(420px, 90vw)",
              background: "#0f172a",
              border: "1px solid #1f2937",
              borderRadius: 12,
              padding: 20,
              boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
              color: "#e5e7eb",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Invite people</h3>
              <button
                onClick={() => setInviteModalOpen(false)}
                style={{
                  background: "transparent",
                  color: "#9ca3af",
                  border: "none",
                  fontSize: 16,
                  cursor: "pointer",
                }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <p style={{ marginTop: 0, marginBottom: 14, color: "#94a3b8", fontSize: 13 }}>
              Room invites are participant-only. Copy the link to invite someone on stage.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #1f2937",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>Participant</span>
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>Join the room on stage</span>
                </div>
                <button
                  onClick={() => copyInviteLink("participant", "Participant")}
                  style={{
                    fontSize: 12,
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(34, 197, 94, 0.4)",
                    background:
                      copiedInviteLabel === "Participant"
                        ? "rgba(34, 197, 94, 0.18)"
                        : "rgba(34, 197, 94, 0.08)",
                    color: copiedInviteLabel === "Participant" ? "#bbf7d0" : "#22c55e",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  {copiedInviteLabel === "Participant" ? "Copied" : "Copy link"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ErrorBoundary
        fallback={
          <div
            style={{
              position: "fixed",
              bottom: "80px",
              right: "20px",
              zIndex: 60,
              background: "rgba(15,23,42,0.98)",
              borderRadius: "0.75rem",
              border: "1px solid rgba(248,113,113,0.6)",
              padding: "0.9rem 1rem",
              color: "#fee2e2",
              maxWidth: "360px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: "0.25rem", fontSize: "0.85rem" }}>
              Stream setup crashed.
            </div>
            <div style={{ fontSize: "0.75rem", opacity: 0.9 }}>
              Try closing this panel and reopening it. If it keeps happening, grab a screenshot of the browser console
              and send it to support.
            </div>
            <button
              type="button"
              onClick={() => nav("/join", { replace: true })}
              style={{
                marginTop: "0.5rem",
                padding: "0.4rem 0.9rem",
                borderRadius: "999px",
                border: "1px solid rgba(248,113,113,0.8)",
                background: "rgba(127,29,29,0.7)",
                color: "#fee2e2",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              ⬅ Back to Join Room
            </button>
          </div>
        }
      >
        <StreamSetupModalV2
          open={showStreamSetup}
          onClose={() => setShowStreamSetup(false)}
          roomName={roomName ?? ""}
          roomId={roomId || ""}
          roomAccessToken={roomAccessToken || undefined}
          
          selectedPresetId={selectedPresetId}
          defaultRecordingMode={defaultRecordingModePref}
          streamStatus={streamStatus}
          onStartStream={handleStartMultistream}
          onStopStream={handleStopMultistream}
          recordingStatus={recordingStatus}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
          recordingEnabled={recordingEnabled}
          rtmpDestinationsMax={planRtmpDestinationsMax ?? undefined}
          multistreamAllowed={canMultistream}
          hlsEnabled={hlsAvailable}
          hlsCustomizationEnabled={featureAccess.canUse.hlsSetup && (isHost || can("canLayout"))}
          showHlsSection={hlsAvailable}
          canStartStopHls={canStartStopHls}
          entitlementsReady={entitlementsReady}
          onUpgradeHls={handleUpgradeHls}
          dualRecordingAllowed={dualRecordingAllowed}
          maxGuests={maxGuestsAllowed === null ? undefined : maxGuestsAllowed || undefined}
          planId={recordingPlanId || undefined}
          recordingMaxMinutes={maxRecordingMinutesPerClip || undefined}
          recordingElapsedSeconds={recordingElapsed}
          savedDestinations={destinations
            .filter((d) => d.enabled && (d.status === "connected" || d.persistent === false))
            .map((d) => ({
              id: d.id,
              targetId: d.targetId || d.id,
              platform: d.platform,
              name: d.name,
              enabled: d.enabled,
              label: d.name ? `${d.platform} – ${d.name}` : d.platform,
              status: d.status,
              hasKey: d.hasKey,
              keyPreview: d.keyPreview ?? null,
              persistent: d.persistent,
              rtmpUrlBase: d.rtmpUrlBase,
              mode: d.mode,
            }))}
        />
      </ErrorBoundary>

      {showStreamEndedModal && recordingId && (
        <StreamEndedModal
          recordingId={recordingId}
          processing={postStopProcessing}
          ready={postStopReady}
          onExitRoom={() => nav('/join', { replace: true })}
          onStayInRoom={handleStayInRoom}
        />
      )}

      {/* Recording cap toast (Free plan) */}
      {recordingToast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            background: "rgba(24,24,27,0.96)",
            color: "#f9fafb",
            padding: "10px 16px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: "0 14px 40px rgba(0,0,0,0.7)",
            border: "1px solid rgba(248,250,252,0.15)",
            zIndex: 1200,
          }}
        >
          ⏱️ {recordingToast}
        </div>
      )}

      {/* Recording background processing/ready notice */}
      {recordingBackgroundNotice && (
        <div
          style={{
            position: "fixed",
            bottom: recordingToast ? 74 : 24,
            right: 24,
            zIndex: 1201,
            background: "rgba(15,23,42,0.98)",
            border: "1px solid rgba(148,163,184,0.25)",
            borderRadius: 12,
            padding: "12px 12px",
            color: "#e5e7eb",
            width: "min(380px, calc(100vw - 48px))",
            boxShadow: "0 18px 60px rgba(0,0,0,0.7)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {recordingBackgroundNotice.kind === "processing"
                ? "Recording is processing"
                : "Recording is ready to download"}
            </div>
            <button
              type="button"
              onClick={() => {
                try {
                  sessionStorage.setItem(
                    recordingBannerDismissedKey(recordingBackgroundNotice.recordingId),
                    recordingBackgroundNotice.kind
                  );
                } catch {}
                setRecordingBackgroundNotice(null);
              }}
              style={{
                border: "none",
                background: "transparent",
                color: "#94a3b8",
                cursor: "pointer",
                fontSize: 16,
                lineHeight: 1,
              }}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>

          <div style={{ marginTop: 6, fontSize: 12, color: "#cbd5e1", lineHeight: 1.35 }}>
            {recordingBackgroundNotice.kind === "processing" ? (
              <>
                Recording is processing in the background. Download it from{" "}
                <span style={{ color: "#e5e7eb", fontWeight: 600 }}>Settings → Usage → Latest video</span>{" "}
                when it turns green.
              </>
            ) : (
              <>
                Recording is ready. Click <span style={{ color: "#e5e7eb", fontWeight: 700 }}>Download</span> (opens a new tab).{" "}
                <span style={{ color: "#94a3b8" }}>Link lasts 1 hour.</span>
              </>
            )}
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() =>
                nav("/settings/billing", {
                  state: {
                    openTab: "usage",
                    usageRoomId: effectiveRoomName || undefined,
                  },
                })
              }
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(34, 197, 94, 0.35)",
                background: "rgba(34, 197, 94, 0.12)",
                color: "#bbf7d0",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              Open Settings
            </button>

            <button
              type="button"
              disabled={recordingBackgroundNotice.kind !== "ready"}
              onClick={async () => {
                if (recordingBackgroundNotice.kind !== "ready") return;

                const rid = recordingBackgroundNotice.recordingId;

                const openUrl = (url: string) => {
                  try {
                    window.open(url, "_blank", "noopener,noreferrer");
                  } catch {
                    window.open(url, "_blank");
                  }
                };

                // Use prefetched URL when available; otherwise fetch on-demand.
                const prefetched = recordingBackgroundNotice.downloadUrl || postStopDownloadUrl;
                if (typeof prefetched === "string" && prefetched.trim()) {
                  openUrl(prefetched.trim());
                  return;
                }

                try {
                  const res = await apiFetchAuth(`${API_BASE}/api/recordings/${rid}/download-link`, {}, { allowNonOk: true });
                  if (res.status === 410) {
                    alert("This recording link expired. Use Settings → Usage → Latest video.");
                    return;
                  }
                  if (res.status === 402) {
                    alert("Upgrade required to download this recording.");
                    return;
                  }
                  if (!res.ok) throw new Error("Failed to get download link");

                  const data = await res.json().catch(() => null);
                  const url = data?.data?.url;
                  if (!data?.success || !url) throw new Error(data?.error || "Invalid download link response");
                  openUrl(String(url));
                } catch (err) {
                  console.error(err);
                  alert("Failed to download recording. Use Settings → Usage → Latest video.");
                }
              }}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border:
                  recordingBackgroundNotice.kind === "ready"
                    ? "1px solid rgba(34, 197, 94, 0.35)"
                    : "1px solid rgba(148,163,184,0.25)",
                background:
                  recordingBackgroundNotice.kind === "ready"
                    ? "rgba(34, 197, 94, 0.22)"
                    : "rgba(148,163,184,0.08)",
                color: recordingBackgroundNotice.kind === "ready" ? "#bbf7d0" : "#94a3b8",
                cursor: recordingBackgroundNotice.kind === "ready" ? "pointer" : "not-allowed",
                fontWeight: 800,
                fontSize: 12,
                opacity: recordingBackgroundNotice.kind === "ready" ? 1 : 0.75,
              }}
            >
              {recordingBackgroundNotice.kind === "ready" ? "Download" : "Processing…"}
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        @keyframes fadeScale {
          0% { opacity: 0; transform: scale(0.92); }
          20% { opacity: 1; transform: scale(1); }
          80% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.94); }
        }

        

        ${/* Removed sl-viewer CSS - invite guests are now RTC participants with mic+cam */ ""}

       
      `}</style>
    </>
  );
};

export default RoomPage;