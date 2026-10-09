import React from "react";
import { getFeatureErrorMessage } from "../../lib/featureErrors";
import { useEffect, useState, useRef, useMemo } from "react";
import { logAuthDebugContext } from "../../lib/logAuthDebug";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { API_BASE } from "../../lib/apiBase";
import {
  clearStoredGuestSession,
  isUsableGuestSession,
  readStoredGuestSession,
  storeGuestSession,
  stripQueryParams,
} from "../../lib/guestSession";
import { APP_BASE } from "../../lib/appBase";
import {
  LiveKitRoom,
  useRoomContext,
  useLocalParticipant,
  useLocalParticipantPermissions,
  useParticipants,
} from "@livekit/components-react";
import { RoomEvent, Track, ConnectionState } from "livekit-client";
import { buildRoomOptions } from "../../lib/captureDefaults";
import {
  DEFAULT_MEDIA_PRESET_ID,
  isHighQualityPreset,
  isMediaPresetId,
  mediaPresetLabel,
  readCachedRoomPreset,
  toPresetOptions,
  writeCachedRoomPreset,
  type PresetOption,
} from "../../lib/mediaPresetLabels";
import CaptureDefaultsSync from "../components/CaptureDefaultsSync";
import {
  apiStartRecording,
  apiStopRecording,
  apiFetch,
  apiFetchAuth,
  apiFetchOptionalAuth,
  hasAuthSession,
} from "../../lib/api";
import { postGuestPresence } from "../../lib/telemetry";
import {
  classifyDisconnect,
  hasRoomPermission,
  isAccessDeniedCode,
  joinPagePillText,
  nextMintRetryDelayMs,
  normalizePublicRoomInfo,
  parseJoinPagePresence,
  presenceDowngradeNotice,
  readShareToken,
  resolveRoomPermissions,
  storeShareToken,
  type DisconnectKind,
  type JoinPagePresence,
  type PublicRoomInfo,
  type RoomPermissions,
} from "../../lib/roomJoin";
import RoleOverlay from "../components/RoleOverlay";
import { JoinGateLayout, RoomUnavailableCard, WaitingForHostCard } from "../components/RoomJoinGate";
import StreamSetupModalV2 from "../components/StreamSetupModal";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { RoleChangeToast } from "../components/RoleChangeToast";
import ProgramStage, { ProgramStateProvider, useProgramState } from "../components/ProgramStage";
import AudioMixerModal from "../components/AudioMixerModal";
import ViewerStatsChip from "../components/ViewerStatsChip";
import MixerBridge from "../components/MixerBridge";
import ScreenShareRouter, { type ScreenShareRouteMode } from "../components/ScreenShareRouter";
import ScreenSharePopout from "../components/ScreenSharePopout";
import { TourProvider, useTour } from "../../components/tour/TourProvider";
import { useEffectiveEntitlements } from "../../hooks/useEffectiveEntitlements";
import { getSelectedOwnerContext } from "../../lib/producerDelegation";
import { useFeatureAccess } from "../../hooks/useFeatureAccess";
import { useHlsStatus } from "../hooks/useHlsStatus";
import { normalizeStartLivePayloadFromDestinationsKeys } from "../hooks/useDestinationsStartPayload";
import {
  RECONNECT_MEDIA_MESSAGE_TYPE,
  reconnectMedia,
  tryParseLiveKitDataMessage,
} from "../../lib/mediaRecovery";
import { setPlatformFlagsValue } from "../../lib/platformFlagsStore";
import { fetchDestinations, preflight, type DestinationItem } from "../../services/destinations";
import { normalizeUiRolePresetId } from "../../lib/roles";
import { recordingEvents } from "../../lib/recordingEvents";
import { detectInAppBrowser } from "../../lib/detectInAppBrowser";
import {
  ROOM_ACCESS_HLS_NOTE,
  normalizeRoomAccess,
  roomAccessInviteSummary,
  roomAccessLabel,
  type RoomAccessMode,
} from "../../lib/roomAccess";
import {
  getRoomAccessPermissions,
  isLimitedHostToken,
  normalizeRoomRole,
  type RoomAccessPermissions,
  type RoomRole,
} from "../../lib/roomAccessClaims";
import {
  HostControlsEnforcer,
  TileVisibilityEnforcer,
  type PublishPermissionState,
} from "../components/HostControlsEnforcer";
import { isEligibleParticipant, type FracSlot, type Orientation } from "../../lib/programPresets";
import {
  canonicalPresetId,
  pickerPresets,
  resolveProgram,
  slotIsScreen,
  type ProgramResolution,
} from "../../lib/programResolve";

const DEV_CONTROLS = import.meta.env.VITE_DEV_CONTROLS === "1";

// Room options (camera capture resolution, simulcast, screen-share encoding,
// adaptiveStream + dynacast) come from lib/captureDefaults buildRoomOptions,
// computed ONCE per LiveKitShell mount (useLiveKitRoom recreates the Room when
// the options' JSON changes). livekit-client has no room-level screen-share
// capture defaults, so CaptureDefaultsSync injects ScreenShareCaptureOptions
// (1080p30 + system/tab audio) when screen share is enabled without options.

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
        serverUrl: (room.engine?.client as any)?.url,
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
          Array.from((p as any).videoTracks?.values?.() ?? (p as any).trackPublications?.values?.() ?? []).some((t: any) => t.isSubscribed)
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
            color: '#d97706',
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
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const handleError = (error: any) => {
      console.error('[MediaDeviceError]', error);

      // Permission-denied is never transient — show immediately.
      const name = error?.name || String(error);
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        onError(error);
        return;
      }

      // For all other errors, delay briefly. LiveKit often auto-retries
      // with fallback constraints and succeeds within ~2 s. If by then
      // the local participant has an active audio or video track the
      // error was transient — suppress it.
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        const lp = room.localParticipant;
        const hasAudio = lp?.audioTrackPublications?.size > 0;
        const hasVideo = lp?.videoTrackPublications?.size > 0;
        if (hasAudio || hasVideo) {
          return;
        }
        onError(error);
      }, 2500);
    };

    room.on(RoomEvent.MediaDevicesError, handleError);

    return () => {
      room.off(RoomEvent.MediaDevicesError, handleError);
      if (pendingTimer) clearTimeout(pendingTimer);
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

  // 1. Query param `gst` (handed over by InviteRedeem; works in FB/IG in-app
  //    browsers). Persist it, then drop it from the address bar so it isn't
  //    shared or bookmarked along with the URL.
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("gst")?.trim();
    if (fromQuery) {
      if (isUsableGuestSession(fromQuery, roomId)) {
        storeGuestSession(roomId, fromQuery);
        stripQueryParams(["gst"]);
        return fromQuery;
      }
      stripQueryParams(["gst"]);
    }
  } catch {
    // ignore
  }

  // 2. sessionStorage (per-room), then localStorage. Expired sessions are
  //    ignored so a fresh ?t= invite isn't hidden behind a dead session.
  const stored = readStoredGuestSession(roomId);
  if (stored) return stored;
  clearStoredGuestSession(roomId);
  return null;
}

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

  // Host-enforced media state (server also enforces via LiveKit permissions).
  forcedMute?: boolean;
  forcedVideoOff?: boolean;
  muteLocked?: boolean;
  // Raw role from the controls doc, normalized defensively ("viewer" after
  // "Move to audience", "participant" after "Bring on stage", ...).
  stageRole?: RoomRole | null;
};

function ThankYouScreen({
  showHomeButton = false,
  onHome,
  onRejoin,
  message,
}: {
  showHomeButton?: boolean;
  onHome?: () => void;
  /** Guests go back to their own room/invite page, never the host /join page. */
  onRejoin?: () => void;
  message?: string | null;
}) {
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
        <p style={{ maxWidth: 400, opacity: 0.9, fontSize: '1.125rem', lineHeight: 1.6, marginBottom: showHomeButton || onRejoin ? '1.5rem' : '0' }}>
          {message || "Your session has ended. You can now close this app or tab."}
        </p>
        {onRejoin && (
          <button
            type="button"
            onClick={onRejoin}
            style={{
              padding: '12px 24px',
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#ffffff',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              marginRight: showHomeButton && onHome ? 8 : 0,
            }}
          >
            Rejoin room
          </button>
        )}
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

// ---------------------------------------------------------------------------
// LayoutPickerPanel – in-room program layout selector (host / cohost)
// Lives inside <LiveKitRoom> + <ProgramStateProvider>. Picking a preset
// applies it immediately: optimistic for this client, everyone else gets it
// through LiveKit room metadata.
// ---------------------------------------------------------------------------

function initialsOf(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

function SlotThumb({
  slots,
  orientation,
  height,
  names,
  active,
  testId,
}: {
  slots: Array<{ id: string; x: number; y: number; w: number; h: number; z?: number; screen?: boolean; text?: string }>;
  orientation: Orientation;
  height: number;
  names?: boolean;
  active?: boolean;
  testId?: string;
}) {
  const width = orientation === "portrait" ? (height * 9) / 16 : (height * 16) / 9;
  return (
    <div
      data-testid={testId}
      style={{
        position: "relative",
        width,
        height,
        background: "#020617",
        borderRadius: 3,
        overflow: "hidden",
        border: active ? "1px solid rgba(250,204,21,0.8)" : "1px solid rgba(255,255,255,0.12)",
        flex: "0 0 auto",
      }}
    >
      {slots.map((s) => (
        <div
          key={s.id}
          style={{
            position: "absolute",
            left: `${s.x * 100}%`,
            top: `${s.y * 100}%`,
            width: `${s.w * 100}%`,
            height: `${s.h * 100}%`,
            zIndex: s.z ?? 1,
            boxSizing: "border-box",
            border: "1px solid #020617",
            background: s.screen ? "rgba(56,189,248,0.55)" : s.text === "" ? "rgba(148,163,184,0.12)" : "rgba(250,204,21,0.45)",
            color: "#0f172a",
            fontSize: names ? 9 : 0,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {names ? s.text : null}
        </div>
      ))}
    </div>
  );
}

function presetThumbSlots(slots: FracSlot[]) {
  return slots.map((s) => ({ ...s, screen: slotIsScreen(s) }));
}

function resolutionThumbSlots(res: ProgramResolution, nameOf: (id: string) => string) {
  return res.slots.map((r) => ({
    id: r.slot.id,
    x: r.slot.x,
    y: r.slot.y,
    w: r.slot.w,
    h: r.slot.h,
    z: r.slot.z,
    screen: r.track === "screen",
    text: r.identity ? (r.track === "screen" ? "SCREEN" : initialsOf(nameOf(r.identity))) : "",
  }));
}

function LayoutPickerPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useProgramState();
  const [tab, setTab] = useState<Orientation>("landscape");
  const participants = ctx?.participants ?? [];
  const state = ctx?.state ?? null;

  const nameOf = useMemo(() => {
    const m = new Map(participants.map((p) => [p.identity, p.name || p.identity] as const));
    return (id: string) => m.get(id) || id;
  }, [participants]);
  const eligibleCount = useMemo(() => participants.filter(isEligibleParticipant).length, [participants]);
  const resLandscape = useMemo(
    () => resolveProgram({ state, participants, orientation: "landscape" }),
    [state, participants],
  );
  const resPortrait = useMemo(
    () => resolveProgram({ state, participants, orientation: "portrait" }),
    [state, participants],
  );

  if (!open || !ctx) return null;

  const activeId = canonicalPresetId(tab === "landscape" ? state?.landscape?.presetId : state?.portrait?.presetId, tab);
  const presets = pickerPresets(tab);
  const screenMode = state?.screenShareMode ?? "auto";

  const tabBtn = (o: Orientation, label: string) => (
    <button
      type="button"
      data-testid={`layout-tab-${o}`}
      onClick={() => setTab(o)}
      style={{
        flex: 1,
        padding: "6px 0",
        borderRadius: 6,
        border: "none",
        background: tab === o ? "rgba(234,179,8,0.18)" : "transparent",
        color: tab === o ? "#facc15" : "#94a3b8",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  const modeBtn = (m: "auto" | "manual", label: string) => (
    <button
      type="button"
      data-testid={`screen-mode-${m}`}
      onClick={() => void ctx.apply({ screenShareMode: m })}
      style={{
        flex: 1,
        padding: "5px 0",
        borderRadius: 6,
        border: screenMode === m ? "1px solid #38bdf8" : "1px solid rgba(255,255,255,0.1)",
        background: screenMode === m ? "rgba(56,189,248,0.15)" : "transparent",
        color: screenMode === m ? "#7dd3fc" : "#94a3b8",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      data-testid="layout-picker"
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        width: 300,
        maxHeight: "calc(100% - 16px)",
        overflowY: "auto",
        zIndex: 30,
        borderRadius: 12,
        border: "1px solid rgba(234,179,8,0.3)",
        background: "rgba(15,23,42,0.96)",
        backdropFilter: "blur(12px)",
        padding: 14,
        color: "#e2e8f0",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Program Layout</div>
        <button
          type="button"
          aria-label="Close layout picker"
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 16, padding: 0 }}
        >
          ✕
        </button>
      </div>

      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>
        Applies instantly to the room stage and the stream.
        <span style={{ display: "block", marginTop: 4, color: "#facc15" }}>
          {eligibleCount} on stage
        </span>
      </div>

      {/* Live preview of both orientations */}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>Landscape</div>
          <SlotThumb
            testId="preview-landscape"
            slots={resolutionThumbSlots(resLandscape, nameOf)}
            orientation="landscape"
            height={96}
            names
          />
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>Vertical</div>
          <SlotThumb
            testId="preview-portrait"
            slots={resolutionThumbSlots(resPortrait, nameOf)}
            orientation="portrait"
            height={96}
            names
          />
        </div>
      </div>
      {(resLandscape.screenOverride || resLandscape.fallbackGrid) && (
        <div style={{ fontSize: 10, color: "#7dd3fc", marginBottom: 8 }}>
          {resLandscape.screenOverride
            ? "Screen share is live: showing Screen Focus until it stops."
            : "No layout chosen yet: showing an automatic grid."}
        </div>
      )}

      <div style={{ display: "flex", gap: 4, marginBottom: 8, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 2 }}>
        {tabBtn("landscape", "Landscape")}
        {tabBtn("portrait", "Vertical")}
      </div>
      {tab === "portrait" && (
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>
          {ctx.portraitExplicit
            ? "Vertical layout chosen manually."
            : "Vertical follows the landscape layout until you pick one here."}
        </div>
      )}

      {ctx.saving && <div style={{ fontSize: 11, color: "#facc15", marginBottom: 6 }}>Applying…</div>}
      {ctx.error && <div style={{ fontSize: 11, color: "#f87171", marginBottom: 6 }}>{ctx.error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: tab === "portrait" ? "1fr 1fr 1fr" : "1fr 1fr", gap: 6 }}>
        {presets.map((preset) => {
          const isActive = activeId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              data-testid={`layout-preset-${preset.id}`}
              data-active={isActive ? "true" : "false"}
              onClick={() =>
                void ctx.apply(tab === "landscape" ? { landscapeId: preset.id } : { portraitId: preset.id })
              }
              title={preset.label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 5,
                padding: "8px 4px",
                borderRadius: 8,
                border: isActive ? "2px solid #facc15" : "1px solid rgba(255,255,255,0.1)",
                background: isActive ? "rgba(234,179,8,0.12)" : "rgba(255,255,255,0.03)",
                color: isActive ? "#facc15" : "#e2e8f0",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: isActive ? 700 : 500,
              }}
            >
              <SlotThumb
                slots={presetThumbSlots(preset.slots)}
                orientation={tab}
                height={tab === "portrait" ? 56 : 40}
                active={isActive}
              />
              <span style={{ textAlign: "center", lineHeight: 1.2 }}>{preset.label}</span>
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Screen share</div>
        <div style={{ display: "flex", gap: 6 }}>
          {modeBtn("auto", "Auto-switch")}
          {modeBtn("manual", "Manual")}
        </div>
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 5 }}>
          {screenMode === "auto"
            ? "When someone shares, the stage switches to a screen layout (cameras stay visible)."
            : "Shares only appear in layouts with a screen slot."}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
 
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
  screenShareMode: ScreenShareRouteMode;
  /** Bumped when the user changes the screen-share route (maps to screenShareMode). */
  screenShareRouteNonce?: number;
  watermarkEnabled: boolean;
  dashboardOpen: boolean;
  onCloseDashboard: () => void;
  roomName: string;
  roomAccessToken: string | null;
  canMuteGuests: boolean;
  canRemoveGuests: boolean;
  canModerate: boolean;
  /** Production-room access mode shown/edited in the host dashboard. */
  roomAccessMode?: RoomAccessMode | null;
  onRoomAccessChange?: (mode: RoomAccessMode) => void;
  effectivePermissionsMode: "simple" | "advanced";
  dashboardRole: "host" | "moderator" | "participant";
  onLeaveRequested?: () => void;
  /** LiveKit Disconnected (reason is a DisconnectReason value when known). */
  onDisconnected: (reason?: number) => void;
  /** Connect failed before the room was ever connected. */
  onConnectError?: (error: Error) => void;
  onConnected?: () => void;
  /** Host or cohost with canLayout: show the broadcast layout picker. */
  canLayout?: boolean;
  onActiveSharerChange?: (name: string | null) => void;
  audioMixerEnabled: boolean;
  advancedScreenShareEnabled: boolean;
  presenceMode: "normal" | "invisible";
  showLayoutPicker: boolean;
  onToggleLayoutPicker: () => void;
  /** Subscribe-only participant (viewer / moved to audience). */
  isAudience?: boolean;
  /** Host controls currently forbid mic (canPublishAudio=false, forcedMute, mute lock). */
  controlsAudioBlocked?: boolean;
  /** Host controls currently forbid camera (canPublishVideo=false, forcedVideoOff). */
  controlsVideoBlocked?: boolean;
  onPublishPermissionChange?: (state: PublishPermissionState) => void;
  /** Host's effective media preset: drives publisher capture defaults. */
  capturePresetId?: string | null;
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
  screenShareMode,
  screenShareRouteNonce = 0,
  watermarkEnabled,
  dashboardOpen,
  onCloseDashboard,
  roomName,
  roomAccessToken,
  canMuteGuests,
  canRemoveGuests,
  canModerate,
  roomAccessMode,
  onRoomAccessChange,
  effectivePermissionsMode,
  dashboardRole,
  onLeaveRequested,
  onDisconnected,
  onConnectError,
  onConnected,
  canLayout = false,
  onActiveSharerChange,
  audioMixerEnabled,
  advancedScreenShareEnabled,
  presenceMode,
  showLayoutPicker,
  onToggleLayoutPicker,
  isAudience = false,
  controlsAudioBlocked = false,
  controlsVideoBlocked = false,
  onPublishPermissionChange,
  capturePresetId = null,
}: LiveKitShellProps) {
  const [joinPagePresence, setJoinPagePresence] = useState<JoinPagePresence | null>(null);
  // Computed once per mount: changing options would make useLiveKitRoom
  // recreate the Room. Later preset changes go through CaptureDefaultsSync.
  const [roomOptions] = useState(() => buildRoomOptions(capturePresetId || readCachedRoomPreset(roomId)));
  const mediaRootRef = useRef<HTMLDivElement | null>(null);

  // Stable LiveKitRoom callbacks: useLiveKitRoom re-runs its connect effect
  // when onError changes identity, so never pass fresh closures.
  const callbacksRef = useRef({ onDisconnected, onConnectError, onConnected });
  callbacksRef.current = { onDisconnected, onConnectError, onConnected };
  const connectedOnceRef = useRef(false);
  const handleLkDisconnected = React.useCallback((reason?: number) => {
    console.log("[Room] LiveKit disconnected", { reason });
    callbacksRef.current.onDisconnected(typeof reason === "number" ? reason : undefined);
  }, []);
  const handleLkError = React.useCallback((error: Error) => {
    console.error("[Room] ❌ LiveKit error:", { error, message: error?.message });
    if (!connectedOnceRef.current) callbacksRef.current.onConnectError?.(error);
  }, []);
  const handleLkConnected = React.useCallback(() => {
    connectedOnceRef.current = true;
    console.log("[Room] 🔗 LiveKit onConnected callback fired");
    callbacksRef.current.onConnected?.();
  }, []);

  // Media permission error state and handlers
  const [mediaPermissionError, setMediaPermissionError] = useState<{
    type: 'denied' | 'notFound' | 'notReadable' | 'notSupported' | 'inAppBrowser' | null;
    message: string;
  } | null>(null);

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

  // Join-page presence for the host/cohost pill: who is sitting on the guest
  // join gate right now (server expires entries ~60s after the last ping).
  const canSeeJoinPage = (isHost || canModerate) && !isViewer;
  useEffect(() => {
    if (!canSeeJoinPage || !roomId) {
      setJoinPagePresence(null);
      return;
    }

    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await apiFetchOptionalAuth(
          `/api/invites/room-status?roomId=${encodeURIComponent(roomId)}`,
          { headers: roomAccessToken ? { "x-room-access-token": roomAccessToken } : {} },
        );
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          // Not allowed to see it: stop quietly.
          setJoinPagePresence(null);
          return;
        }
        if (res.ok) {
          failures = 0;
          const data = await res.json().catch(() => null);
          if (!cancelled) setJoinPagePresence(parseJoinPagePresence(data));
        } else {
          failures++;
        }
      } catch {
        failures++;
      }
      if (!cancelled) timer = setTimeout(poll, failures > 3 ? 30000 : 7000);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [canSeeJoinPage, roomId, roomAccessToken]);
  const joinPagePill = joinPagePillText(joinPagePresence);

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
      className={`sl-layout${isAudience ? " sl-viewer" : ""}${
        subjectToControls && (!controlsAllowPublishAudio || controlsAudioBlocked) ? " sl-controls-no-audio" : ""
      }${subjectToControls && controlsVideoBlocked ? " sl-controls-no-video" : ""}${
        subjectToControls && !controlsTileVisible ? " sl-controls-hide-self" : ""
      }${
        subjectToControls && !controlsAllowScreenShare ? " sl-controls-no-screen" : ""
      }${advancedScreenShareEnabled ? ` sl-screen-${screenShareMode}` : ""}`}
      token={token}
      serverUrl={serverUrl}
      connect={true}
      // Viewers are subscribe-only: never try to publish on connect (it
      // would fail and surface device errors). Promoted viewers turn mic/cam
      // on themselves via the control bar once LiveKit grants publish.
      audio={!isAudience && !controlsAudioBlocked}
      video={!isAudience && !controlsVideoBlocked}
      options={roomOptions}
      connectOptions={undefined}
      onConnected={handleLkConnected}
      onDisconnected={handleLkDisconnected}
      onError={handleLkError}
      style={{
        width: "100%",
        height: "calc(100vh - 60px)",
        position: "relative",
      }}
    >
      <ProgramStateProvider
        roomId={roomId}
        roomAccessToken={roomAccessToken}
        canLayout={isHost || canLayout}
        isHost={isHost}
        screenShareRouteMode={screenShareMode}
        screenShareRouteNonce={screenShareRouteNonce}
      >
      <div ref={mediaRootRef} style={{ width: "100%", height: "100%", position: "relative" }}>
        <LiveKitDebugLogger />
        <VideoElementMonitor />
        {DEV_CONTROLS && <PermissionsDebugOverlay dashboardRole={dashboardRole === "host" ? "host" : "participant"} />}
        <MediaDeviceErrorHandler onError={handleMediaDeviceError} />
        <WaitingForHostBanner isViewer={isViewer} />
        <MediaPermissionErrorBanner 
          error={mediaPermissionError} 
          onDismiss={() => setMediaPermissionError(null)}
        />
        <ReconnectCommandListener />
        <CaptureDefaultsSync presetId={capturePresetId || readCachedRoomPreset(roomId)} isPublisher={!isAudience} />
        <HostControlsEnforcer
          audioBlocked={subjectToControls && (!controlsAllowPublishAudio || controlsAudioBlocked)}
          videoBlocked={subjectToControls && controlsVideoBlocked}
          screenBlocked={subjectToControls && !controlsAllowScreenShare}
          onPublishPermissionChange={onPublishPermissionChange}
        />
        <TileVisibilityEnforcer rootRef={mediaRootRef} hideLocal={subjectToControls && !controlsTileVisible} />
        {audioMixerEnabled && <MixerBridge />}
        {advancedScreenShareEnabled && <ScreenSharePopout mode={screenShareMode} onActiveSharerChange={onActiveSharerChange} />}
        {(isHost || canLayout) && roomId && roomAccessToken && (
          <LayoutPickerPanel open={showLayoutPicker} onClose={onToggleLayoutPicker} />
        )}
        {canSeeJoinPage && (
          <div
            data-testid="join-page-pill"
            aria-hidden={!joinPagePill}
            style={{
              position: "absolute",
              top: 10,
              left: "50%",
              transform:
                joinPagePill
                  ? "translateX(-50%) translateY(0)"
                  : "translateX(-50%) translateY(-6px)",
              padding: "6px 12px",
              borderRadius: 999,
              background: "rgba(15,23,42,0.9)",
              border: "1px solid rgba(59,130,246,0.7)",
              fontSize: 12,
              color: "#bfdbfe",
              zIndex: 20,
              opacity: joinPagePill ? 1 : 0,
              pointerEvents: "none",
              transition: "opacity 0.35s ease-in-out, transform 0.35s ease-in-out",
            }}
          >
            {joinPagePill}
          </div>
        )}
        {/* When host is invisible, hide their local video tile completely */}
        {presenceMode === "invisible" && (
          <style>{`[data-lk-local-participant="true"] { display: none !important; }`}</style>
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
            <ProgramStage />
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
            roomAccessMode={roomAccessMode}
            onRoomAccessChange={onRoomAccessChange}
          />
        )}
      </div>
      </ProgramStateProvider>
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
    if (cachedName) return cachedName;

    // If InviteRedeem pre-cached a LiveKit token, use its displayName so we
    // don't flash the name-entry gate before the room loads.
    try {
      const candidateRoom = routeRoomId;
      if (candidateRoom) {
        const cached = sessionStorage.getItem(`sl_lk_token:${candidateRoom}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (typeof parsed?.displayName === "string" && parsed.displayName.trim()) {
            const name = parsed.displayName.trim();
            localStorage.setItem("sl_displayName", name);
            return name;
          }
        }
      }
    } catch { /* ignore */ }

    return "";
  });
  const [pendingName, setPendingName] = useState(displayName);
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [showStreamSetup, setShowStreamSetup] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [showMixer, setShowMixer] = useState(false);
  const [showScreenShareRouter, setShowScreenShareRouter] = useState(false);
  const [showLayoutPicker, setShowLayoutPicker] = useState(false);
  const [screenShareMode, setScreenShareModeRaw] = useState<ScreenShareRouteMode>("off");
  // Bumped on user changes only: the stage maps them onto programState.screenShareMode.
  const [screenShareRouteNonce, setScreenShareRouteNonce] = useState(0);
  const [activeSharerName, setActiveSharerName] = useState<string | null>(null);
  const [egressId, setEgressId] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [showGoodbye, setShowGoodbye] = useState(false);
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
  // Production-room access (invite_only | link | public), from /token.
  const [roomAccessMode, setRoomAccessMode] = useState<RoomAccessMode | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [reauthBannerText, setReauthBannerText] = useState<string>(
    "Session expired — re-auth to enable host tools."
  );
  const [roomTokenMode, setRoomTokenMode] = useState<"unknown" | "auth" | "guest">("unknown");
  const [actingContextBanner, setActingContextBanner] = useState<{ ownerUid: string | null; ownerLabel: string | null; isDelegated: boolean }>({
    ownerUid: null,
    ownerLabel: null,
    isDelegated: false,
  });
  const roomTokenMintInFlightRef = useRef(false);

  // Presence mode: passed from Join page via route state or localStorage
  const [presenceMode, setPresenceMode] = useState<"normal" | "invisible">(() => {
    const fromState = (location.state as any)?.presenceMode;
    if (fromState === "silent" || fromState === "invisible") return "invisible";
    try {
      const stored = localStorage.getItem("sl_presence_mode");
      if (stored === "silent" || stored === "invisible") return "invisible";
    } catch { /* ignore */ }
    return "normal";
  });
  const [roomGateStatus, setRoomGateStatus] = useState<"unknown" | "idle" | "live" | "blocked">("unknown");
  const roomGatePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped to re-run the token mint effect (room went live, Retry, rejoin).
  const [mintAttempt, setMintAttempt] = useState(0);
  const mintRetryCountRef = useRef(0);
  const requestMint = React.useCallback(() => setMintAttempt((n) => n + 1), []);
  // Anonymous visitors of an "Anyone With Link" / "Public" room: one direct
  // join-guest attempt (audience viewer) before asking them to sign in.
  const linkViewerJoinTriedRef = useRef(false);
  // Role from the last successful /token mint (authoritative over local hints).
  const mintedRoleRef = useRef<string | null>(null);
  // Pending mint retry timer (409 backoff / network error).
  const mintRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Remount key for LiveKitShell so Retry builds a fresh LiveKit Room.
  const [connectAttempt, setConnectAttempt] = useState(0);
  // Unintended disconnect / failed connect: shown as a banner with Retry.
  const [connectionIssue, setConnectionIssue] = useState<{ kind: DisconnectKind | "connect_failed"; message: string } | null>(null);
  // Set by Exit Room / Leave before the leave flow runs, so the resulting
  // LiveKit disconnect is not mistaken for a network failure.
  const explicitLeaveRef = useRef(false);
  const [goodbyeMessage, setGoodbyeMessage] = useState<string | null>(null);
  // 403 not_allowed from /token: no access (not an auth problem).
  const [accessDenied, setAccessDenied] = useState<string | null>(null);
  const [presenceNotice, setPresenceNotice] = useState<string | null>(null);
  // Public room info for the guest join gate (GET /api/rooms/:id/info).
  const [publicRoomInfo, setPublicRoomInfo] = useState<PublicRoomInfo | null>(null);
  const waitStartRef = useRef<number | null>(null);
  const [waitStartedAt, setWaitStartedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const STALE_WAIT_MS = 15 * 60 * 1000;
  const hostToolsHydratedKeyRef = useRef<string | null>(null);
  const [controlsPanelOpen, setControlsPanelOpen] = useState(false);
  const [effectiveControls, setEffectiveControls] = useState<EffectiveControls>(() => ({
    canPublishAudio: true,
    tileVisible: true,
    canPublishVideo: true,
    canScreenShare: undefined,
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
      // Authorization when signed in (host/cohost session) plus the RAT.
      const res = await apiFetchOptionalAuth(`/api/rooms/${encodeURIComponent(roomId)}/controls`, {
        method: "PATCH",
        headers: { "x-room-access-token": roomAccessToken },
        body: JSON.stringify(patch),
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        const c = data?.controls;
        if (c && typeof c === "object") {
          setEffectiveControls({
            canPublishAudio: typeof c.canPublishAudio === "boolean" ? c.canPublishAudio : true,
            tileVisible: typeof c.tileVisible === "boolean" ? c.tileVisible : true,
            canPublishVideo: typeof c.canPublishVideo === "boolean" ? c.canPublishVideo : true,
            canScreenShare: typeof c.canScreenShare === "boolean" ? c.canScreenShare : undefined,
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
  const [postStopDownloadUrl, setPostStopDownloadUrl] = useState<string | null>(null);
  const [postStopProcessing, setPostStopProcessing] = useState(false);
  const [postStopReady, setPostStopReady] = useState(false);
  const [postStopStatus, setPostStopStatus] = useState<string | null>(null);
  const postStopIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const postStopPollCountRef = useRef(0);
  const [copiedInviteLabel, setCopiedInviteLabel] = useState<string | null>(null);
  const copiedInviteTimeoutRef = useRef<number | null>(null);
  const lastStopWasAutoRef = useRef<boolean>(false);
  const autoStopTriggeredRef = useRef(false);
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
  const [dualRecordingAllowed, setDualRecordingAllowed] = useState<boolean>(false);
  const [watermarkEnabled, setWatermarkEnabled] = useState<boolean>(false);
  const [maxGuestsAllowed, setMaxGuestsAllowed] = useState<number | null>(null);
  const [destinations, setDestinations] = useState<DestinationItem[]>([]);
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [destinationsReady, setDestinationsReady] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightResult, setPreflightResult] = useState<any>(null);
  const [canGoLive, setCanGoLive] = useState(false);
  const [mediaPresets, setMediaPresets] = useState<PresetOption[]>([]);
  // selectedPresetId mirrors the ROOM OWNER's saved default until the user
  // makes an explicit choice in Stream Setup (presetExplicit). Requests only
  // send presetId for explicit choices; otherwise the server applies the
  // owner's default (clamped to the owner's plan).
  const [selectedPresetId, setSelectedPresetId] = useState<string>(() => readCachedRoomPreset(routeRoomId) || DEFAULT_MEDIA_PRESET_ID);
  const [presetExplicit, setPresetExplicit] = useState(false);
  const [ownerDefaultPresetId, setOwnerDefaultPresetId] = useState<string | null>(null);
  const [ownerMaxPresetId, setOwnerMaxPresetId] = useState<string | null>(null);
  const [warnOnHighQualityPref, setWarnOnHighQualityPref] = useState(true);
  const [effectivePresetId, setEffectivePresetId] = useState<string | null>(null);
  const [presetClamped, setPresetClamped] = useState(false);
  const [presetAdjustment, setPresetAdjustment] = useState<string | null>(null);
  // Failed multistream outputs reported by the server (e.g. Instagram rejected the push).
  const [outputIssues, setOutputIssues] = useState<Array<{ kind: string; error: string | null }>>([]);
  const [outputIssuesDismissed, setOutputIssuesDismissed] = useState(false);
  const [defaultRecordingModePref, setDefaultRecordingModePref] = useState<"cloud" | "dual">("cloud");
  const [firestoreRoomId, setFirestoreRoomId] = useState<string | null>(null);
  const [roomAccessToken, setRoomAccessToken] = useState<string | null>(null);
  const [participantIdentity, setParticipantIdentity] = useState<string | null>(null);
  const [adminOverride, setAdminOverride] = useState<boolean>(false);
  const [, setAuthStatus] = useState<"unknown" | "authed" | "guest">("unknown");
    const [effectivePermissionsMode, setEffectivePermissionsMode] = useState<"simple" | "advanced">("simple");
  const roomId = firestoreRoomId ?? routeRoomId ?? null;

  // ---------------------------------------------------------------------------
  // Token refresh on role change (controls SSE `refresh_token` hint).
  // We re-run the existing token fetch effect by clearing `token` (its guard
  // is `if (token && serverUrl) return`). While the new token is minted the
  // LiveKitShell keeps the previous token so the live connection is not torn
  // down (LiveKitRoom ignores a token change once connected).
  // ---------------------------------------------------------------------------
  const lastLiveKitTokenRef = useRef<string | null>(null);
  if (token) lastLiveKitTokenRef.current = token;
  const [tokenRefreshPending, setTokenRefreshPending] = useState(false);
  const tokenRefreshCtxRef = useRef<{ roomId: string | null; identity: string | null }>({ roomId: null, identity: null });
  tokenRefreshCtxRef.current = { roomId, identity: participantIdentity };
  const requestRoomTokenRefresh = React.useCallback(() => {
    // Guest identities are pinned in the guest session, so a re-mint keeps
    // the same LiveKit identity for invite guests too.
    const { roomId: rid } = tokenRefreshCtxRef.current;
    if (roomTokenMintInFlightRef.current) return;
    try {
      if (rid) sessionStorage.removeItem(`sl_lk_token:${rid}`);
    } catch {
      // ignore
    }
    setTokenRefreshPending(true);
    setToken(null);
  }, []);
  useEffect(() => {
    if (token && tokenRefreshPending) setTokenRefreshPending(false);
  }, [token, tokenRefreshPending]);
  const shellToken = token ?? (tokenRefreshPending ? lastLiveKitTokenRef.current : null);

  // Live LiveKit publish permissions reported from inside the room.
  const [livekitPublish, setLivekitPublish] = useState<PublishPermissionState | null>(null);
  const handlePublishPermissionChange = React.useCallback((s: PublishPermissionState) => {
    setLivekitPublish((prev) =>
      prev &&
      prev.canPublish === s.canPublish &&
      prev.canPublishAudio === s.canPublishAudio &&
      prev.canPublishVideo === s.canPublishVideo &&
      prev.canScreenShare === s.canScreenShare
        ? prev
        : s,
    );
  }, []);

  // What the server will actually accept: the roomAccessToken's permissions
  // (from the /token response, or decoded from the RAT itself). SSE controls
  // alone are not enough — showing a button the RAT can't back leads to a
  // 401/403 and a bogus "Session expired" banner.
  const ratPermissions: RoomAccessPermissions | null = useMemo(
    () => getRoomAccessPermissions(roomAccessToken),
    [roomAccessToken],
  );
  // Delegated producers carry a "host" token limited by its permissions
  // (their collaborator permissions); only the owner/admin host has all.
  const isLimitedHost = isHost && isLimitedHostToken(roomAccessToken);
  const isFullHost = isHost && !isLimitedHost;
  // Full host, or the /token `permissions`, or the RAT claims (co-hosts and
  // producers get their stream/record/moderation abilities from these).
  // Buttons reflect token permissions only: the server enforces the same.
  const can = (key: keyof RoomPermissions) =>
    hasRoomPermission(key, { isHost: isFullHost, needsReauth, roomPermissions, ratPermissions });
  const canInviteLinks = !needsReauth && !isViewer && can("canInvite");
  const canManageStream =
    !needsReauth && !isViewer && (can("canStream") || can("canRecord") || can("canDestinations"));
  const canMuteGuestsUi = !needsReauth && !isViewer && (can("canMuteGuests") || can("canModerate"));

  const canRemoveGuestsUi = !needsReauth && !isViewer && (can("canRemoveGuests") || can("canModerate"));

  const canModerateUi = !needsReauth && !isViewer && can("canModerate");
  const canLayoutUi = !needsReauth && !isViewer && can("canLayout");
  // Co-hosts with moderation rights get the host dashboard (minus co-host
  // assignment and removing the owner, handled inside RoleOverlay).
  // Co-host per the minted role (used by the viewer-count chip).
  const isCohost = !isHost && normalizeRoomRole(userRole) === "cohost";
  const dashboardRole: "host" | "moderator" | "participant" = isHost
    ? "host"
    : canModerateUi || canMuteGuestsUi || canRemoveGuestsUi
      ? "moderator"
      : "participant";

  // Audience (subscribe-only) detection. Live LiveKit permissions win once
  // known (so "Bring on stage" / "Move to audience" apply without reload);
  // before that, fall back to the token response (isViewer / role "viewer")
  // and the controls doc role.
  const tokenSaysViewer =
    isViewer || normalizeRoomRole(userRole) === "viewer" || effectiveControls.stageRole === "viewer";
  const isAudience =
    !isHost &&
    presenceMode !== "invisible" &&
    (livekitPublish && livekitPublish.canPublish !== null ? livekitPublish.canPublish === false : tokenSaysViewer);

  const subjectToControls = !isHost;
  const controlsAllowPublishAudio = !subjectToControls || effectiveControls.canPublishAudio !== false;
  const controlsAllowPublishVideo = !subjectToControls || effectiveControls.canPublishVideo !== false;
  const controlsTileVisible = !subjectToControls || effectiveControls.tileVisible !== false;
  // Screen share: an explicit controls value wins (host restriction or the
  // applied role preset). Without one (e.g. an invite guest whose token was
  // minted from the owner's participant preset), the LiveKit grant decides,
  // since LiveKit's ControlBar shows the Screen button for any publisher.
  const controlsAllowScreenShare =
    !subjectToControls ||
    (typeof effectiveControls.canScreenShare === "boolean"
      ? effectiveControls.canScreenShare
      : livekitPublish?.canPublish === true && livekitPublish.canScreenShare);
  const controlsAudioBlocked =
    subjectToControls && (!controlsAllowPublishAudio || !!effectiveControls.forcedMute || !!effectiveControls.muteLocked);
  const controlsVideoBlocked = subjectToControls && (!controlsAllowPublishVideo || !!effectiveControls.forcedVideoOff);


  // ---------------------------------------------------------------------------
  // Screen share route mode: persist per-room in localStorage + room controls
  // ---------------------------------------------------------------------------
  const SCREEN_SHARE_MODE_KEY = "sl_screen_share_mode";

  // Load saved screenShareMode from localStorage when roomId becomes available
  useEffect(() => {
    if (!roomId) return;
    try {
      const stored = localStorage.getItem(`${SCREEN_SHARE_MODE_KEY}:${roomId}`);
      if (stored === "off" || stored === "main" || stored === "popout") {
        setScreenShareModeRaw(stored);
      }
    } catch {
      // ignore
    }
  }, [roomId]);

  // Wrapper that persists to localStorage and broadcasts via room controls
  const setScreenShareMode = (mode: ScreenShareRouteMode) => {
    setScreenShareModeRaw(mode);
    setScreenShareRouteNonce((n) => n + 1);
    // Persist locally
    if (roomId) {
      try {
        localStorage.setItem(`${SCREEN_SHARE_MODE_KEY}:${roomId}`, mode);
      } catch {
        // ignore
      }
    }
    // Broadcast via room controls PATCH
    if (roomId && roomAccessToken) {
      apiFetchOptionalAuth(`/api/rooms/${encodeURIComponent(roomId)}/controls`, {
        method: "PATCH",
        headers: { "x-room-access-token": roomAccessToken },
        body: JSON.stringify({ screenShareLayout: mode }),
      })
        .then(async (res) => {
          if (res.ok) return;
          console.warn("[Room] screenShareLayout broadcast rejected", res.status);
          if (res.status === 403) {
            const data = await res.json().catch(() => ({}));
            if (data?.feature === "advancedScreenShare") {
              // Server refused (plan / platform switch): fall back to Off.
              setScreenShareModeRaw("off");
              try {
                localStorage.setItem(`${SCREEN_SHARE_MODE_KEY}:${roomId}`, "off");
              } catch {
                // ignore
              }
              alert(data?.reason || "Advanced screen share isn't available for this room's plan.");
            }
          }
        })
        .catch((err: unknown) => {
          console.warn("[Room] screenShareLayout broadcast failed", err);
        });
    }
  };

  // Host HLS status is only meaningful (and only authorized) for people who
  // can manage the stream; guests/viewers must not poll it.
  const { data: hlsStatusData } = useHlsStatus({
    apiBase: API_BASE,
    roomId: roomId || "",
    roomAccessToken: roomAccessToken || "",
    enabled: !!token && (isHost || can("canStream") || canManageStream),
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
  // A saved/broadcast Main or Pop-out route only applies while the room owner
  // has Advanced screen share; otherwise the stage behaves as "off".
  const effectiveScreenShareMode: ScreenShareRouteMode = featureAccess.advancedScreenShare.allowed
    ? screenShareMode
    : "off";

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

    // Once the server has minted a role, it wins over these local hints.
    if (mintedRoleRef.current) {
      setIsHost(mintedRoleRef.current === "host");
      return;
    }
    const willBeHost = createdRooms.includes(candidateKey) || localIsAdmin;
    setIsHost(willBeHost);
    const nextRole = willBeHost ? "host" : "guest";
    setUserRole(nextRole);
    try {
      localStorage.setItem("sl_current_role", nextRole);
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

    let lastRole: RoomRole | undefined = undefined;

    es.onmessage = (ev) => {
      if (closed) return;
      try {
        const data = JSON.parse(ev.data);

        // Server hint: the host changed our role; re-mint the room token so
        // roomAccessToken permissions match. Not a controls payload.
        if (data?.type === "refresh_token") {
          requestRoomTokenRefresh();
          return;
        }
        if (typeof data?.type === "string") return; // unknown event types

        // Defensive: unknown roles are ignored rather than breaking the page.
        const stageRole = normalizeRoomRole(data?.role);
        const rawRole = data?.role;
        const nextRole = stageRole && stageRole !== "host" && stageRole !== "guest" ? stageRole : undefined;

        if (nextRole && lastRole && nextRole !== lastRole) {
          const msg =
            nextRole === "viewer"
              ? "You've been moved to the audience"
              : lastRole === "viewer"
                ? "You're on stage — you can turn on your mic and camera"
                : `You're now a ${nextRole === "cohost" ? "Co-host" : "Participant"}`;
          setRoleChangeMessage(msg);

          if (roleToastTimeoutRef.current) {
            clearTimeout(roleToastTimeoutRef.current);
          }
          roleToastTimeoutRef.current = setTimeout(() => {
            setRoleChangeMessage(null);
            roleToastTimeoutRef.current = null;
          }, 2800);
        }

        if (nextRole) {
          lastRole = nextRole;
        }

        const normalizedRolePresetId =
          rawRole === "cohost" || rawRole === "participant" ? normalizeUiRolePresetId(rawRole) : undefined;

        setEffectiveControls({
          forcedMute: data?.forcedMute === true,
          forcedVideoOff: data?.forcedVideoOff === true,
          muteLocked: data?.muteLocked === true,
          stageRole,
          canPublishAudio: typeof data?.canPublishAudio === "boolean" ? data.canPublishAudio : true,
          tileVisible: typeof data?.tileVisible === "boolean" ? data.tileVisible : true,
          canPublishVideo: typeof data?.canPublishVideo === "boolean" ? data.canPublishVideo : true,
          canScreenShare: typeof data?.canScreenShare === "boolean" ? data.canScreenShare : undefined,
          canMuteGuests: typeof data?.canMuteGuests === "boolean" ? data.canMuteGuests : false,
          canRemoveGuests: typeof data?.canRemoveGuests === "boolean" ? data.canRemoveGuests : false,
          canInviteLinks: typeof data?.canInviteLinks === "boolean" ? data.canInviteLinks : false,
          canManageDestinations: typeof data?.canManageDestinations === "boolean" ? data.canManageDestinations : false,
          canStartStopStream: typeof data?.canStartStopStream === "boolean" ? data.canStartStopStream : false,
          canStartStopRecording: typeof data?.canStartStopRecording === "boolean" ? data.canStartStopRecording : false,
          rolePresetId: normalizedRolePresetId,
        });

        // Sync screen-share layout from room controls broadcast
        const ssLayout = data?.screenShareLayout;
        if (ssLayout === "off" || ssLayout === "main" || ssLayout === "popout") {
          setScreenShareModeRaw(ssLayout);
        }
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
        // Keep cohost as cohost: /token decides the real role (it mints cohost
        // only for a signed-in user with a cohost acceptance/invite).
        const resolvedRole = String(data.role || "guest");
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
            // stripQueryParams drops `t` after the first mint; keep the share
            // token for status checks and re-mints (refresh_token, Retry).
            storeShareToken(resolvedRoomId || routeRoomId, t);
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

  // Static id -> label map (never shows raw ids, no flicker while presets load).
  const presetLabelFor = (id?: string | null) => mediaPresetLabel(id);

  const handlePresetChange = (id: string) => {
    if (!isMediaPresetId(id)) return;
    // Never change the reported preset while an egress is running.
    if (streamStatus === "live" || streamStatus === "starting" || recordingStatus === "recording") return;
    setSelectedPresetId(id);
    setPresetExplicit(true);
    setEffectivePresetId(null);
    setPresetClamped(false);
    setPresetAdjustment(null);
  };

  /** Explicit setup-modal choice, or undefined to let the server use the owner's default. */
  const explicitPresetId = presetExplicit ? selectedPresetId : undefined;

  /** Confirm before starting at >=1080p60 / 1440p / 4K when the owner's pref asks for it. */
  const confirmHighQualityStart = (what: "stream" | "recording") => {
    if (!warnOnHighQualityPref || !isHighQualityPreset(selectedPresetId)) return true;
    if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
    return window.confirm(
      `Start ${what === "stream" ? "streaming" : "recording"} at ${mediaPresetLabel(selectedPresetId)}? ` +
        "High-quality presets need a strong, stable upload connection."
    );
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
    // Left the room (goodbye screen) or no access: don't mint.
    if (showGoodbye || accessDenied) return;
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
              if (parsed.roomAccessToken) setRoomAccessToken(parsed.roomAccessToken);
              if (typeof parsed.isViewer === "boolean") setIsViewer(parsed.isViewer);
              if (typeof parsed.role === "string" && parsed.role) {
                mintedRoleRef.current = parsed.role;
                setUserRole(parsed.role);
                setIsHost(parsed.role === "host");
              }
              mintRetryCountRef.current = 0;
              setRoomGateStatus("live");
              
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
        // Signed-in users (Firebase or legacy JWT) mint with Authorization so
        // the server sees their account (host/cohost/admin), not a guest.
        const bearerToken = await hasAuthSession();
        const urlT = String(new URLSearchParams(window.location.search).get("t") || "").trim() || null;
        const shareToken = readShareToken(roomId) || readShareToken(routeRoomId);
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
        // A share-link `t` is a roomAccessToken, not an invite.
        const inviteTokenFromUrl = urlT && urlT !== shareToken ? urlT : null;
        // Forward the invite whenever there's no usable guest session (expired
        // sessions are already filtered out), and always for signed-in users
        // so a cohost invite link is honored even next to an old session.
        const inviteTokenForJoin =
          (bearerToken || !guestSessionToken ? (inviteTokenFromUrl || inviteToken || null) : null)?.trim?.() || null;
        const selectedOwnerContext = getSelectedOwnerContext();
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
          // Include presence mode so the backend can restrict grants accordingly.
          if (presenceMode !== "normal") {
            payload.presenceMode = presenceMode;
          }
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

        // Shared success handling for the main request and the guest-session
        // retry, so both set identity, role, viewer state and permissions the
        // same way. Returns false when the response carries no usable token.
        const applyTokenResponse = (data: any): boolean => {
          if (!data) {
            console.error("[Room] No data from /roomToken");
            return false;
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
            return false;
          }

          // Renewed guest session (same claims, fresh expiry): keep it in both
          // storage layers so refreshes/new tabs present a live session.
          const canonicalRoomId =
            (typeof data?.roomId === "string" && data.roomId.trim()) || roomId || "";
          if (typeof data?.guestSessionToken === "string" && data.guestSessionToken.trim() && canonicalRoomId) {
            storeGuestSession(canonicalRoomId, data.guestSessionToken.trim());
          }

          if (typeof data?.roomName === "string" && data.roomName.trim()) {
            setRoomName(data.roomName.trim());
          }

          // `permissions` from the response; falls back to the RAT claims
          // when an older server omits the field.
          setRoomPermissions(
            resolveRoomPermissions(
              data?.permissions,
              typeof data?.roomAccessToken === "string" ? data.roomAccessToken : null,
            ),
          );
          if (typeof data?.access === "string") {
            setRoomAccessMode(normalizeRoomAccess(data.access));
          }
          // Invisible joins can be downgraded server-side (e.g. not allowed
          // for this role): follow the server and tell the user.
          if (data?.presenceMode === "normal" || data?.presenceMode === "invisible" || data?.presenceMode === "silent") {
            const granted = data.presenceMode === "normal" ? "normal" : "invisible";
            setPresenceNotice(presenceDowngradeNotice(presenceMode, data.presenceMode));
            setPresenceMode(granted);
            if (granted === "normal") {
              try {
                localStorage.removeItem("sl_presence_mode");
              } catch {
                // ignore
              }
            }
          }
          if (data.effectiveEntitlements || data.platformFlags) {
            applyEntitlementsAndPlatform(data.effectiveEntitlements, data.platformFlags || {});
          }
          if (data?.actingContext && typeof data.actingContext === "object") {
            const ownerLabel = data.actingContext.ownerDisplayName || data.actingContext.ownerEmail || null;
            setActingContextBanner({
              ownerUid: typeof data.actingContext.ownerUid === "string" ? data.actingContext.ownerUid : null,
              ownerLabel,
              isDelegated: !!data.actingContext.isDelegated,
            });
          } else {
            setActingContextBanner({ ownerUid: null, ownerLabel: null, isDelegated: false });
          }
          const {
            token: lkToken,
            serverUrl: serverUrlFromApi,
            roomId: returnedRoomId,
            roomAccessToken: roomAccessTokenRaw,
          } = data as any;
          // Server returns participantIdentity; older join-now payloads used identity.
          const participantIdentityRaw = (data as any).participantIdentity ?? (data as any).identity;
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
          // Server reports isViewer=true for subscribe-only tokens.
          if (typeof data?.isViewer === "boolean") {
            setIsViewer(data.isViewer);
          }
          // The minted role is authoritative: a stale sl_created_rooms entry
          // or a local admin flag must not grant host UI (or the host-only
          // remove-all on exit) unless the server minted host.
          const mintedRole =
            typeof data?.effectiveRoleKey === "string" && data.effectiveRoleKey
              ? data.effectiveRoleKey
              : typeof data?.role === "string" && data.role
                ? data.role
                : null;
          if (mintedRole) {
            mintedRoleRef.current = mintedRole;
            setUserRole(mintedRole);
            setIsHost(mintedRole === "host");
            try {
              localStorage.setItem("sl_current_role", mintedRole);
            } catch {
              // ignore
            }
          }
          if (!lkToken || !finalServerUrl) {
            console.error("[Room] Missing token or serverUrl", { token: lkToken, serverUrl: serverUrlFromApi });
            return false;
          }

          // Credentials are stored now; drop them from the address bar so
          // they aren't shared or bookmarked with the room URL.
          stripQueryParams(["gst", "t"]);
          mintRetryCountRef.current = 0;
          setRoomGateStatus("live");
          setAccessDenied(null);
          setConnectionIssue(null);
          return true;
        };

        const { endpoint, payload } = buildRoomTokenRequest();

        const mode: "auth" | "invite" = bearerToken ? "auth" : payload.inviteToken ? "invite" : "auth";
        // Share-link guests: present the share token on every (re-)mint.
        const shareHeader: Record<string, string> = shareToken || (urlT && !inviteTokenFromUrl)
          ? { "x-room-access-token": (shareToken || urlT) as string }
          : {};
        const anonymousMint = () =>
          apiFetch(
            endpoint,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...shareHeader,
                ...(inviteTokenForJoin ? { "x-invite-token": inviteTokenForJoin } : {}),
                ...(guestSessionToken ? { "x-guest-session": guestSessionToken } : {}),
              },
              body: JSON.stringify(
                guestSessionToken && !payload.guestSessionToken ? { ...payload, guestSessionToken } : payload,
              ),
            },
            { allowNonOk: true },
          );
        let tokenRes: Response;
        if (bearerToken) {
          try {
            // allowNonOk + suppressAuthSideEffects: a 401 comes back to us
            // (guest-session retry, mapped message, re-auth banner) instead of
            // throwing / wiping the session.
            tokenRes = await apiFetchAuth(
              endpoint,
              {
                method: "POST",
                headers: {
                  ...shareHeader,
                  ...(selectedOwnerContext.ownerUid ? { "x-owner-context-uid": selectedOwnerContext.ownerUid } : {}),
                  ...(inviteTokenForJoin ? { "x-invite-token": inviteTokenForJoin } : {}),
                  // Logged-in invitees: forward the room's guest session so the
                  // server can see the invite without the cross-site sl_guest cookie.
                  ...(guestSessionToken ? { "x-guest-session": guestSessionToken } : {}),
                },
                body: JSON.stringify(payload),
              },
              { allowNonOk: true, suppressAuthSideEffects: true },
            );
          } catch (err: any) {
            if (err?.name !== "ApiUnauthorizedError") throw err;
            // Session disappeared between the check and the request.
            tokenRes = await anonymousMint();
          }
        } else {
          tokenRes = await anonymousMint();
        }

        const attempt = { res: tokenRes, mode };

        const res = attempt.res;
        console.log("[Room] roomToken status:", res.status, "mode:", attempt.mode);
        setRoomTokenMode(attempt.mode === "invite" ? "guest" : attempt.mode);

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
            // Not live yet: show the waiting screen and try again on a
            // backoff timer (the status/info polls also re-request as soon
            // as the room turns live).
            setRoomGateStatus("idle");
            if (mapped) setReauthBannerText(mapped);
            if (mintRetryTimerRef.current) clearTimeout(mintRetryTimerRef.current);
            const delay = nextMintRetryDelayMs(mintRetryCountRef.current++);
            mintRetryTimerRef.current = setTimeout(() => {
              mintRetryTimerRef.current = null;
              requestMint();
            }, delay);
            return;
          }

          if (res.status === 401) {
            // Guest session retry: if we have a guest session token and this was
            // a cookie-only attempt, retry once with the explicit header.
            const gst = getGuestSessionToken(roomId);
            if (gst && !payload.guestSessionToken) {
              console.log('[Room] 401 on token fetch — retrying with explicit guest session header');
              const retryRes = await apiFetch(
                endpoint,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-guest-session": gst,
                    ...(inviteTokenForJoin ? { "x-invite-token": inviteTokenForJoin } : {}),
                  },
                  body: JSON.stringify({ ...payload, guestSessionToken: gst }),
                },
                { allowNonOk: true },
              );
              if (retryRes.ok) {
                const retryData = await retryRes.json().catch(() => null);
                if (retryData?.token && retryData?.serverUrl && applyTokenResponse(retryData)) {
                  console.log('[Room] Guest session retry succeeded');
                  setRoomTokenMode("guest");
                  setNeedsReauth(false);
                  return;
                }
              }
            }

            // No invite and no session: link/public rooms let anyone with the
            // link watch from the audience (server: POST /join-guest, viewer
            // only). Invite-only rooms refuse this, so fall through to sign-in.
            if (!inviteToken && !inviteTokenForJoin && !gst && roomId && !linkViewerJoinTriedRef.current) {
              linkViewerJoinTriedRef.current = true;
              const viewerName = String(payload?.displayName || displayName || "").trim() || "Viewer";
              const jg = await apiFetch(
                `/api/rooms/${encodeURIComponent(roomId)}/join-guest`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ displayName: viewerName }),
                },
                { allowNonOk: true },
              ).catch(() => null);
              const jgData = jg && jg.ok ? await jg.json().catch(() => null) : null;
              if (jgData && typeof jgData.guestSessionToken === "string" && jgData.guestSessionToken.trim()) {
                storeGuestSession(roomId, jgData.guestSessionToken.trim());
                requestMint();
                return;
              }
              if (jg && jg.status === 409) {
                // Link room not live yet: wait and try again.
                linkViewerJoinTriedRef.current = false;
                setRoomGateStatus("idle");
                if (mintRetryTimerRef.current) clearTimeout(mintRetryTimerRef.current);
                const delay = nextMintRetryDelayMs(mintRetryCountRef.current++);
                mintRetryTimerRef.current = setTimeout(() => {
                  mintRetryTimerRef.current = null;
                  requestMint();
                }, delay);
                return;
              }
            }

            setNeedsReauth(true);
            setAuthStatus("guest");
            setReauthBannerText(
              mapped ||
                (inviteToken
                  ? "Invite invalid or expired."
                  : "This room is invite-only. Use your invite link, or sign in.")
            );
            // Only force login redirect when we truly have no invite or guest session to attempt guest join.
            if (!inviteToken && !inviteTokenForJoin && !gst) {
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
            if (errCode === "login_required") {
              setNeedsReauth(true);
              setAuthStatus("guest");
              setReauthBannerText(mapped || "This room requires an account to join. Please sign in.");
              return;
            }
            if (isAccessDeniedCode(errCode)) {
              // Re-auth can't fix this; say so plainly.
              setNeedsReauth(false);
              setAccessDenied(mapped || "You don't have access to this room.");
              return;
            }
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
        applyTokenResponse(data);
      } catch (err) {
        console.error("[Room] fetchToken error:", err);
        // Network failure reaching the API: offer Retry and keep trying.
        setConnectionIssue({ kind: "connect_failed", message: "Couldn't reach the server to join this room." });
        if (mintRetryTimerRef.current) clearTimeout(mintRetryTimerRef.current);
        mintRetryTimerRef.current = setTimeout(() => {
          mintRetryTimerRef.current = null;
          requestMint();
        }, nextMintRetryDelayMs(mintRetryCountRef.current++));
      } finally {
        roomTokenMintInFlightRef.current = false;
      }
    };

    fetchToken();
  }, [displayName, roomId, effectiveRoomName, inviteToken, userRole, isHost, hostCheckReady, token, serverUrl, mintAttempt, showGoodbye, accessDenied]);

  useEffect(() => {
    return () => {
      if (mintRetryTimerRef.current) clearTimeout(mintRetryTimerRef.current);
    };
  }, []);
  // REMOVED: roomGateStatus dependency - guests no longer wait for "live" status

  

  useEffect(() => {
    if (isViewer && showStreamSetup) {
      setShowStreamSetup(false);
    }
  }, [isViewer, showStreamSetup]);

  // Waiting room: after /token answered 409 room_not_live, poll the room
  // status (Authorization when signed in, else the room access / guest
  // session / invite token) and re-request /token as soon as it turns live.
  // Once a token exists LiveKit drives the UX, so polling stops.
  const waitingForLive = !isHost && !token && !tokenRefreshPending && roomGateStatus === "idle";
  useEffect(() => {
    if (!roomId || !waitingForLive) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const guestSessionToken = getGuestSessionToken(roomId);
        const shareToken = readShareToken(roomId);
        const ratForStatus = shareToken || roomAccessToken;
        const res = await apiFetchOptionalAuth(`/api/rooms/${encodeURIComponent(roomId)}/status`, {
          headers: {
            ...(ratForStatus ? { "x-room-access-token": ratForStatus } : {}),
            ...(guestSessionToken ? { "x-guest-session": guestSessionToken } : {}),
            ...(!guestSessionToken && inviteToken ? { "x-invite-token": inviteToken } : {}),
          },
        });
        if (cancelled) return;

        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (cancelled) return;
          if (data?.status === "live") {
            console.log("[Room] Room is live — re-requesting token");
            if (mintRetryTimerRef.current) {
              clearTimeout(mintRetryTimerRef.current);
              mintRetryTimerRef.current = null;
            }
            requestMint();
            return;
          }
        }
        // 401/403/5xx here are informational only: the /token request is
        // authoritative and keeps retrying on its own backoff.
        roomGatePollRef.current = setTimeout(poll, res.ok ? 3000 : 8000);
      } catch {
        if (!cancelled) {
          roomGatePollRef.current = setTimeout(poll, 5000);
        }
      }
    };

    roomGatePollRef.current = setTimeout(poll, 1500);

    return () => {
      cancelled = true;
      if (roomGatePollRef.current) {
        clearTimeout(roomGatePollRef.current);
        roomGatePollRef.current = null;
      }
    };
  }, [roomId, waitingForLive, inviteToken, roomAccessToken, requestMint]);

  // Join gate: public room info (no auth) for the name/waiting screens.
  // Polls every 5s while the room isn't live (slower once the link looks
  // stale); stops when live, ended or not found, and once in the room.
  const onJoinGate = !isHost && !token && !tokenRefreshPending && !showGoodbye && !accessDenied;
  const displayNameRef = useRef(displayName);
  displayNameRef.current = displayName;
  useEffect(() => {
    if (!roomId || !onJoinGate) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (!waitStartRef.current) waitStartRef.current = Date.now();
    setWaitStartedAt((prev) => prev ?? waitStartRef.current);

    const fetchInfo = async () => {
      let next: PublicRoomInfo | null = null;
      try {
        const res = await apiFetch(`/api/rooms/${encodeURIComponent(roomId)}/info`, {}, { allowNonOk: true });
        if (cancelled) return;
        if (res.ok || res.status === 404) {
          const data = res.status === 404 ? null : await res.json().catch(() => null);
          if (cancelled) return;
          next = normalizePublicRoomInfo(res.status, data);
          setPublicRoomInfo(next);
          if (next.roomName) setRoomName((prev) => prev || next!.roomName || prev);
        }
      } catch {
        // non-critical — the join gate still works without this
      }
      if (cancelled) return;
      const st = next?.status;
      if (st === "live") {
        // Became live while waiting with a name already chosen: join now.
        if (displayNameRef.current && roomGateStatus === "idle") {
          if (mintRetryTimerRef.current) {
            clearTimeout(mintRetryTimerRef.current);
            mintRetryTimerRef.current = null;
          }
          requestMint();
        }
        return;
      }
      if (st === "ended" || st === "not_found") return;
      const waited = Date.now() - (waitStartRef.current || Date.now());
      timer = setTimeout(fetchInfo, waited >= STALE_WAIT_MS ? 30000 : 5000);
    };

    void fetchInfo();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [roomId, onJoinGate, roomGateStatus, requestMint, STALE_WAIT_MS]);

  // Elapsed-wait clock for the waiting screen.
  const showingWaitScreen = onJoinGate && (!displayName || roomGateStatus === "idle");
  useEffect(() => {
    if (!showingWaitScreen) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [showingWaitScreen]);

  // Join-page presence: while a guest sits on the join/waiting gate, ping
  // every 20s so the host sees them; "entered_room" once connected and
  // "left" on leave/unload.
  const presenceCtxRef = useRef<{ roomId: string | null; identity: string | null; name: string }>({
    roomId: null,
    identity: null,
    name: "",
  });
  presenceCtxRef.current = {
    roomId,
    identity: participantIdentity,
    name: displayName || pendingName || "",
  };
  const presenceStageRef = useRef<"join_page" | "entered_room" | "left" | null>(null);
  const sendPresence = React.useCallback((stage: "join_page" | "entered_room" | "left", beacon = false) => {
    const ctx = presenceCtxRef.current;
    if (!ctx.roomId) return;
    presenceStageRef.current = stage;
    postGuestPresence(
      {
        roomId: ctx.roomId,
        stage,
        identity: ctx.identity,
        displayName: ctx.name,
        guestSessionToken: readStoredGuestSession(ctx.roomId),
      },
      { beacon },
    );
  }, []);
  const gateRoomClosed = publicRoomInfo?.status === "ended" || publicRoomInfo?.status === "not_found";
  useEffect(() => {
    if (!roomId || !onJoinGate || gateRoomClosed) return;
    sendPresence("join_page");
    const id = setInterval(() => sendPresence("join_page"), 20000);
    return () => clearInterval(id);
  }, [roomId, onJoinGate, gateRoomClosed, sendPresence]);
  useEffect(() => {
    if (!roomId || isHost) return;
    const onPageHide = () => {
      if (presenceStageRef.current && presenceStageRef.current !== "left") sendPresence("left", true);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [roomId, isHost, sendPresence]);

  // Hydrate the ROOM OWNER's default preset on connect for anyone who can run
  // streams/recordings (host, cohost, producer). One request per room/token.
  const presetDefaultsKeyRef = useRef<string | null>(null);
  const egressActiveRef = useRef(false);
  const streamLiveRef = useRef(false);
  const presetExplicitRef = useRef(false);
  useEffect(() => {
    egressActiveRef.current = streamStatus === "live" || streamStatus === "starting" || recordingStatus === "recording";
    streamLiveRef.current = streamStatus === "live";
    presetExplicitRef.current = presetExplicit;
  }, [streamStatus, recordingStatus, presetExplicit]);
  useEffect(() => {
    if (!roomId || !roomAccessToken || !canManageStream || needsReauth) return;
    const key = `${roomId}:${roomAccessToken}`;
    if (presetDefaultsKeyRef.current === key) return;
    presetDefaultsKeyRef.current = key;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetchAuth(
          `${API_BASE}/api/multistream/${encodeURIComponent(roomId)}/preset-defaults`,
          { method: "GET", headers: { "x-room-access-token": roomAccessToken } },
          { allowNonOk: true }
        );
        if (!res.ok || cancelled) return;
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const def = isMediaPresetId(data?.defaultPresetId) ? data.defaultPresetId : DEFAULT_MEDIA_PRESET_ID;
        if (isMediaPresetId(data?.maxPresetId)) {
          setOwnerMaxPresetId(data.maxPresetId);
        }
        setWarnOnHighQualityPref(data?.warnOnHighQuality !== false);
        setOwnerDefaultPresetId(def);
        writeCachedRoomPreset(roomId, def);
        // Don't touch the selection after an explicit choice or while live.
        if (!egressActiveRef.current && !presetExplicitRef.current) {
          setSelectedPresetId(def);
        }
      } catch (e) {
        console.warn("[Room] preset-defaults hydration failed", e);
        presetDefaultsKeyRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId, roomAccessToken, canManageStream, needsReauth]);

  // While live, poll per-output egress status so a destination that silently
  // fails (e.g. Instagram shows no video) surfaces its reason to the host.
  useEffect(() => {
    if (streamStatus !== "live" || !roomId || !roomAccessToken || !canManageStream) {
      setOutputIssues([]);
      setOutputIssuesDismissed(false);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await apiFetchAuth(
          `${API_BASE}/api/multistream/${encodeURIComponent(roomId)}/multistream-status`,
          { method: "GET", headers: { "x-room-access-token": roomAccessToken } },
          { allowNonOk: true }
        );
        if (!res.ok || cancelled) return;
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const outputs: Array<{ kind: string; failed?: boolean; error?: string | null }> = Array.isArray(data?.outputs)
          ? data.outputs
          : [];
        setOutputIssues(outputs.filter((o) => o.failed).map((o) => ({ kind: o.kind, error: o.error ?? null })));
      } catch {
        // transient; next poll retries
      }
    };
    const first = setTimeout(poll, 8000);
    const timer = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [streamStatus, roomId, roomAccessToken, canManageStream]);

  // Preset availability follows the ROOM OWNER's ceiling once known (clamping
  // uses the owner's plan), else the caller's own `allowed` flags.
  const presetOptionsForUi = useMemo(
    () => (ownerMaxPresetId && mediaPresets.length ? toPresetOptions(mediaPresets.map((p) => ({ id: p.id })), ownerMaxPresetId) : mediaPresets),
    [mediaPresets, ownerMaxPresetId]
  );

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
          setMediaPresets(toPresetOptions(list, payload?.maxPresetId ?? null));
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
          // Preset defaults come from the ROOM OWNER (preset-defaults effect),
          // not the caller's own mediaPrefs.

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
          setMediaPresets((prev) => (prev.length ? prev : toPresetOptions([], null)));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [API_BASE, userRole, showStreamSetup, dashboardOpen, canManageStream, needsReauth]);

  // Emit recording.processing on stop (replaces the old modal trigger)
  useEffect(() => {
    if (
      recordingStatus === "stopped" &&
      recordingId &&
      lastRecordingStatusRef.current !== "stopped"
    ) {
      recordingEvents.emit({
        type: "recording.processing",
        recordingId,
        message: "Recording stopped — processing your video…",
      });
    }

    lastRecordingStatusRef.current = recordingStatus;
  }, [recordingStatus, recordingId]);

  // Poll recording readiness after stop. Emits recording.ready / recording.failed globally.
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
    let readyEmitted = false;
    const MAX_POLLS = 120; // 6 minutes at 3s interval

    const poll = async () => {
      postStopPollCountRef.current += 1;
      if (postStopPollCountRef.current > MAX_POLLS) {
        if (!cancelled) {
          setPostStopProcessing(false);
          if (!readyEmitted) {
            recordingEvents.emit({
              type: "recording.failed",
              recordingId: recordingId!,
              message: "Recording processing timed out. Check Settings → Usage.",
            });
          }
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

        if (downloadReady && !readyEmitted && !cancelled) {
          readyEmitted = true;
          // Fetch download URL then emit recording.ready
          let dlUrl: string | undefined;
          try {
            const dlRes = await apiFetchAuth(`${API_BASE}/api/recordings/${recordingId}/download-link`, {}, { allowNonOk: true });
            if (dlRes.ok) {
              const dlData = await dlRes.json().catch(() => null);
              const u = dlData?.data?.url;
              if (typeof u === "string" && u.trim()) dlUrl = u.trim();
            }
          } catch { /* best-effort */ }
          if (!cancelled) {
            setPostStopDownloadUrl(dlUrl ?? null);
            recordingEvents.emit({
              type: "recording.ready",
              recordingId: recordingId!,
              downloadUrl: dlUrl,
              message: "Recording is ready to download!",
            });
          }
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
    // The server computes billable minutes from its own egress session
    // timestamps, so we only need to tell it which room ended. Post whenever
    // this session went live (even if the local timer was lost to a reload).
    if ((!seconds || seconds <= 0) && !didStreamThisSession) {
      console.log("[usage] skip post: did not stream this session", { seconds });
      return;
    }
    if (!roomId) {
      console.log("[usage] skip post: no roomId");
      return;
    }

    usagePostedRef.current = true;

    // `minutes` is informational only (server logs large discrepancies);
    // the user is identified by the auth token, not the body.
    const payload: Record<string, any> = {
      roomId,
      minutes: seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0,
    };

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

  // Explicit leave only (Exit Room / LiveKit Leave). Never called for a
  // network drop or failed connect — see handleLiveKitDisconnected.
  const handleLeftRoom = () => {
    explicitLeaveRef.current = true;
    if (mintRetryTimerRef.current) {
      clearTimeout(mintRetryTimerRef.current);
      mintRetryTimerRef.current = null;
    }
    setConnectionIssue(null);
    if (!isHost) sendPresence("left");
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

    if (isHost) {
      // Post-stream page: stream summary (viewers, duration, outputs) + Back to Join.
      nav('/room-exit/unknown', { replace: true, state: { exitRole: 'host', roomId: roomId || undefined } });
      return;
    }
    // Guests / participants / co-hosts: thank-you screen on this page (with
    // Rejoin), never the host /join page.
    setGoodbyeMessage(null);
    setShowGoodbye(true);
  };

  // LiveKit Disconnected. Only an explicit leave runs the leave flow (and
  // that already ran before the disconnect); anything else is surfaced as a
  // banner with Retry — no navigation, no usage post, no remove-all.
  const handleLiveKitDisconnected = (reason?: number) => {
    const kind = classifyDisconnect(reason, explicitLeaveRef.current);
    console.log("[Room] disconnect classified", { reason, kind });
    if (kind === "explicit" || kind === "client") return;
    if ((kind === "removed" || kind === "ended") && !isHost) {
      explicitLeaveRef.current = true;
      sendPresence("left");
      setGoodbyeMessage(
        kind === "removed" ? "You were removed from the room by the host." : "The host has ended this session.",
      );
      setShowGoodbye(true);
      return;
    }
    setConnectionIssue({
      kind,
      message:
        kind === "duplicate"
          ? "You joined this room from another tab or device, so this tab was disconnected."
          : kind === "removed" || kind === "ended"
            ? "The server closed your connection to this room."
            : "Lost connection to the live room.",
    });
  };

  const handleLiveKitConnectError = (error: Error) => {
    if (explicitLeaveRef.current) return;
    console.warn("[Room] LiveKit connect failed", error?.message);
    setConnectionIssue({ kind: "connect_failed", message: "Couldn't connect to the live room." });
  };

  const handleLiveKitConnected = () => {
    setConnectionIssue(null);
    if (!isHost) sendPresence("entered_room");
  };

  // Retry after a drop / failed connect: re-mint and build a fresh LiveKit room.
  const retryConnection = () => {
    setConnectionIssue(null);
    explicitLeaveRef.current = false;
    mintRetryCountRef.current = 0;
    if (mintRetryTimerRef.current) {
      clearTimeout(mintRetryTimerRef.current);
      mintRetryTimerRef.current = null;
    }
    try {
      if (roomId) sessionStorage.removeItem(`sl_lk_token:${roomId}`);
    } catch {
      // ignore
    }
    setTokenRefreshPending(false);
    setToken(null);
    setConnectAttempt((n) => n + 1);
    requestMint();
  };

  // Goodbye screen → back into this same room (guests' own room page).
  const handleRejoin = () => {
    explicitLeaveRef.current = false;
    setShowGoodbye(false);
    setGoodbyeMessage(null);
    retryConnection();
  };

  const handleHomeClick = () => {
    nav('/join', { replace: true });
  };

  // The server-reported preset only applies while an egress runs; otherwise
  // the chip shows the selection (owner default or explicit choice).
  const egressRunning = streamStatus !== "idle" || recordingStatus === "recording";
  const activePresetId = (egressRunning ? effectivePresetId : null) || selectedPresetId;
  const chipPresetClamped = egressRunning && presetClamped;
  const chipPresetAdjustment = egressRunning ? presetAdjustment : null;
  const activePresetLabel = presetLabelFor(activePresetId);

  const startRecording = async ({
    layout = "grid",
    mode = "cloud",
    presetId,
    skipQualityConfirm = false,
  }: { layout?: string; mode: "cloud" | "dual"; presetId?: string; skipQualityConfirm?: boolean }) => {
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
    if (!skipQualityConfirm && !confirmHighQualityStart("recording")) return;

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
        const requestedPresetId = presetId || explicitPresetId;
        const response = await apiStartRecording(
          roomId,
          requestedMode,
          requestedPresetId,
          roomAccessToken || undefined,
          { presetExplicit: !!requestedPresetId }
        );
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
        const effective = response?.effectivePresetId || response?.data?.effectivePresetId || null;
        // While a stream is live the chip keeps the stream's preset.
        if (effective && !streamLiveRef.current) {
          setEffectivePresetId(effective);
          const clamped = response?.presetClamped || response?.data?.presetClamped;
          setPresetClamped(!!clamped);
        }
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
    if (!confirmHighQualityStart("stream")) return;
    const startLivePayload = {
      ...normalizeStartLivePayloadFromDestinationsKeys({ ...keys, presetId: explicitPresetId }),
      ...(explicitPresetId ? { presetId: explicitPresetId, presetExplicit: true } : {}),
    };
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
        if (recordingStatus !== "recording") {
          setEffectivePresetId(null);
          setPresetClamped(false);
        }
        setPresetAdjustment(null);
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
        const effective = data?.effectivePresetId || data?.data?.effectivePresetId || data?.presetEffectiveId || null;
        if (effective) setEffectivePresetId(effective);
        setPresetClamped(!!(data?.presetClamped || data?.data?.presetClamped));
        const adjustment = data?.presetAdjustment || data?.data?.presetAdjustment || null;
        setPresetAdjustment(typeof adjustment === "string" && adjustment ? adjustment : null);
        if (keys.record) {
          await startRecording({ layout: keys.layout ?? "grid", mode: "cloud", presetId: explicitPresetId, skipQualityConfirm: true });
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

  // "cohost" links are host-only server-side and require the invitee to sign in.
  const copyInviteLink = (_role: "participant" | "cohost", label: string) => {
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
          alert(
            _role === "cohost" && res.status === 403
              ? "Only the room host can create co-host invite links."
              : "Failed to create invite link",
          );
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

  // (The HLS viewer link lives in Stream Setup, bound to the active saved
  // embed; /live/<roomId> is not a valid viewer route.)

  // ==================== RENDER ====================

  const gateRoomName = publicRoomInfo?.roomName || roomName || routeRoomId || "this room";
  const gateStatus = publicRoomInfo?.status ?? "unknown";
  const gateIsLive = gateStatus === "live";
  const goHomeFromGate = () => nav("/");
  const goBackFromGate = () => {
    try {
      if (window.history.length > 1) {
        nav(-1);
        return;
      }
    } catch {
      // ignore
    }
    nav("/");
  };
  const waitedMs = waitStartedAt ? Math.max(0, nowTick - waitStartedAt) : 0;
  const waitIsStale = waitedMs >= STALE_WAIT_MS;
  const checkNow = () => {
    mintRetryCountRef.current = 0;
    if (mintRetryTimerRef.current) {
      clearTimeout(mintRetryTimerRef.current);
      mintRetryTimerRef.current = null;
    }
    if (displayName) requestMint();
    // Refresh the public room info immediately as well.
    void (async () => {
      if (!roomId) return;
      try {
        const res = await apiFetch(`/api/rooms/${encodeURIComponent(roomId)}/info`, {}, { allowNonOk: true });
        if (res.ok || res.status === 404) {
          const data = res.status === 404 ? null : await res.json().catch(() => null);
          setPublicRoomInfo(normalizePublicRoomInfo(res.status, data));
        }
      } catch {
        // ignore
      }
    })();
  };

  // No access (403 not_allowed): re-auth can't fix it.
  if (accessDenied) {
    return (
      <JoinGateLayout roomName={gateRoomName} hostName={publicRoomInfo?.hostName}>
        <RoomUnavailableCard
          testId="room-access-denied"
          title="You don't have access to this room"
          message={
            accessDenied === "You don't have access to this room."
              ? "Ask the host for an invite link, or check that you're signed in with the right account."
              : accessDenied
          }
          actionLabel="Go back"
          onAction={goBackFromGate}
        />
      </JoinGateLayout>
    );
  }

  // Guest join gate status cards (hosts never wait on their own room).
  const gateUnavailable =
    !isHost && !token && (gateStatus === "not_found" || gateStatus === "ended") ? (
      <RoomUnavailableCard
        testId={gateStatus === "not_found" ? "room-not-found" : "room-ended"}
        title={gateStatus === "not_found" ? "Room not found" : "This stream has ended"}
        message={
          gateStatus === "not_found"
            ? "This link doesn't match an active room. Check the link with your host."
            : "The host has ended this session. Thanks for stopping by!"
        }
        actionLabel="Return home"
        onAction={goHomeFromGate}
      />
    ) : null;

  if (!displayName) {
    const showWaiting = !isHost && !gateUnavailable && gateStatus === "idle";
    return (
      <JoinGateLayout roomName={gateRoomName} hostName={publicRoomInfo?.hostName} isLive={gateIsLive}>
        {gateUnavailable}
        {showWaiting && (
          <WaitingForHostCard
            elapsedMs={waitedMs}
            stale={waitIsStale}
            hasName={false}
            onCheckNow={checkNow}
            onHome={goHomeFromGate}
          />
        )}
        {!gateUnavailable && (
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
            placeholder={`Enter your name to join "${gateRoomName}"`}
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
            {showWaiting ? "Join when live" : "Join Room"}
          </button>
        </form>
        )}

        {!gateUnavailable && (
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
        )}
      </JoinGateLayout>
    );
  }

  if (showGoodbye) {
    return (
      <ThankYouScreen
        showHomeButton={isHost}
        onHome={handleHomeClick}
        onRejoin={isHost ? undefined : handleRejoin}
        message={goodbyeMessage}
      />
    );
  }

  // Name chosen but the room isn't open: ended / not found, or waiting for
  // the host (409 room_not_live) — re-requests /token automatically.
  if (!isHost && !token && (gateUnavailable || roomGateStatus === "idle")) {
    return (
      <JoinGateLayout roomName={gateRoomName} hostName={publicRoomInfo?.hostName} isLive={gateIsLive}>
        {gateUnavailable || (
          <WaitingForHostCard
            elapsedMs={waitedMs}
            stale={waitIsStale}
            hasName
            onCheckNow={checkNow}
            onHome={goHomeFromGate}
          />
        )}
      </JoinGateLayout>
    );
  }

  const guestCapLabel = typeof maxGuestsAllowed === "number" && maxGuestsAllowed > 0 ? `${maxGuestsAllowed}` : "—";

  const entitlementSummary = `Rec:${planRecordingEnabled ? "on" : "off"} • Dual:${dualRecordingAllowed ? "on" : "off"} • RTMP:${rtmpCap === 0 ? "off" : rtmpCap === 1 ? "1" : `up to ${rtmpCap}`} • HLS:${planHlsEnabled ? "on" : "off"} • HLS Setup:${planHlsCustomizationEnabled ? "on" : "off"} • Guests:${guestCapLabel}`;
  const recordingEnabled =
    planRecordingEnabled &&
    platformRecordingEnabled &&
    !needsReauth &&
    !isViewer &&
    can("canRecord");
  const canMultistream =
    featureAccess.canUse.destinations &&
    !needsReauth &&
    !isViewer &&
    can("canDestinations");
  const hlsAvailable = featureAccess.canUse.hlsRuntime && !needsReauth;
  const canStartStopHls = !isViewer && can("canStream");

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
      {isAudience && (
        <div
          role="status"
          className="w-full bg-amber-500 text-black text-sm font-semibold px-4 py-2 flex items-center gap-2"
        >
          You're watching — the host can bring you on stage.
        </div>
      )}
      {/* REMOVED: Old "Not started yet" banner - guests now connect immediately to LiveKit.
          WaitingForHostBanner (inside LiveKitRoom) shows real-time participant status instead. */}
      {connectionIssue && (
        <div
          role="alert"
          data-testid="connection-issue-banner"
          className="w-full bg-red-700 text-white text-sm font-semibold px-4 py-2 flex items-center justify-between gap-3"
        >
          <span>{connectionIssue.message}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={retryConnection}
              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded text-sm font-semibold"
            >
              Retry
            </button>
          </div>
        </div>
      )}
      {presenceNotice && (
        <div
          role="status"
          className="w-full bg-amber-500 text-black text-sm font-semibold px-4 py-2 flex items-center justify-between gap-3"
        >
          <span>{presenceNotice}</span>
          <button
            onClick={() => setPresenceNotice(null)}
            className="px-2 py-1 rounded text-sm font-semibold"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      {adminOverride && (
        <div
          role="status"
          className="w-full bg-indigo-700 text-white text-xs font-semibold px-4 py-1.5"
        >
          Admin override: you're in this room with admin access. Leaving won't end the session for others.
        </div>
      )}
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

      {outputIssues.length > 0 && !outputIssuesDismissed && (
        <div
          role="alert"
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1300,
            maxWidth: "min(560px, calc(100vw - 32px))",
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(127, 29, 29, 0.95)",
            border: "1px solid #f87171",
            color: "#fff",
            fontSize: 13,
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: 1 }}>
            {outputIssues.map((o, i) => (
              <div key={i} style={{ marginBottom: i < outputIssues.length - 1 ? 6 : 0 }}>
                <strong>{o.kind === "instagram" ? "Instagram" : "Stream destinations"} output failed.</strong>{" "}
                {o.error || "The destination rejected or dropped the stream."}
                {o.kind === "instagram" && (
                  <div style={{ opacity: 0.85, marginTop: 2 }}>
                    Instagram stream keys work once — copy a fresh Stream URL + key from Live Producer, then stop and
                    restart the stream.
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={() => setOutputIssuesDismissed(true)}
            aria-label="Dismiss"
            style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer", fontSize: 16 }}
          >
            ×
          </button>
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
            data-tour="end-room-button"
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded font-semibold text-sm transition disabled:opacity-50"
          >
            {recordingStatus === "stopping" ? "⏳ Exiting..." : "Exit Room"}
          </button>

          <span className="text-sm opacity-80">{roomName}</span>

          {actingContextBanner.isDelegated && actingContextBanner.ownerLabel && (
            <div
              style={{
                fontSize: "12px",
                padding: "6px 10px",
                borderRadius: "999px",
                background: "rgba(251, 191, 36, 0.14)",
                border: "1px solid rgba(251, 191, 36, 0.3)",
                color: "#fde68a",
                fontWeight: 600,
              }}
            >
              Producing for {actingContextBanner.ownerLabel}
            </div>
          )}

          {canInviteLinks && (
            <button
              onClick={() => setInviteModalOpen(true)}
              data-tour="invite-button"
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
                  border: chipPresetClamped || chipPresetAdjustment ? '1px solid rgba(251,191,36,0.6)' : '1px solid rgba(148, 163, 184, 0.35)',
                  color: chipPresetClamped || chipPresetAdjustment ? '#fbbf24' : '#e5e7eb',
                  fontSize: '0.7rem',
                  background: chipPresetClamped || chipPresetAdjustment ? 'rgba(251,191,36,0.12)' : 'rgba(255, 255, 255, 0.04)',
                  whiteSpace: 'nowrap'
                }}
                  data-testid="preset-chip"
                  title={chipPresetAdjustment || (chipPresetClamped ? "Adjusted to fit the room owner's plan" : undefined)}
                >
                  Preset: {activePresetLabel}
                  {chipPresetAdjustment ? ` · ${chipPresetAdjustment}` : chipPresetClamped ? " (adjusted for plan)" : ""}
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

            {featureAccess.audioMixer.allowed && (
            <button
              onClick={() => setShowMixer(v => !v)}
              style={{
                fontSize: '0.75rem',
                padding: '0.5rem 0.75rem',
                border: showMixer
                  ? '1px solid rgba(139, 92, 246, 0.7)'
                  : '1px solid rgba(139, 92, 246, 0.35)',
                borderRadius: '0.375rem',
                background: showMixer
                  ? 'rgba(139, 92, 246, 0.18)'
                  : 'rgba(139, 92, 246, 0.06)',
                color: '#a78bfa',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                fontWeight: '500'
              }}
              title="Open audio mixer"
            >
              🎛️ Mixer
            </button>
            )}

            {isHost && featureAccess.advancedScreenShare.allowed && (
              <button
                onClick={() => setShowScreenShareRouter(v => !v)}
                data-tour="screen-share"
                style={{
                  fontSize: '0.75rem',
                  padding: '0.5rem 0.75rem',
                  border: showScreenShareRouter
                    ? '1px solid rgba(59, 130, 246, 0.7)'
                    : '1px solid rgba(59, 130, 246, 0.35)',
                  borderRadius: '0.375rem',
                  background: showScreenShareRouter
                    ? 'rgba(59, 130, 246, 0.18)'
                    : 'rgba(59, 130, 246, 0.06)',
                  color: '#60a5fa',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  fontWeight: '500'
                }}
                title="Screen share routing"
              >
                🖥️ Screen
              </button>
            )}

            {canLayoutUi && (
              <button
                onClick={() => setShowLayoutPicker(v => !v)}
                data-tour="layout-controls"
                style={{
                  fontSize: '0.75rem',
                  padding: '0.5rem 0.75rem',
                  border: showLayoutPicker
                    ? '1px solid rgba(234, 179, 8, 0.7)'
                    : '1px solid rgba(234, 179, 8, 0.35)',
                  borderRadius: '0.375rem',
                  background: showLayoutPicker
                    ? 'rgba(234, 179, 8, 0.18)'
                    : 'rgba(234, 179, 8, 0.06)',
                  color: '#facc15',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  fontWeight: '500'
                }}
                title="Broadcast layout — controls what viewers see on YouTube / Twitch / Facebook"
              >
                🎬 Layout
              </button>
            )}

            {(isHost || isCohost) && !isViewer && roomId && (
              <ViewerStatsChip roomId={roomId} roomAccessToken={roomAccessToken} />
            )}

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
                  data-tour="go-live-button"
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

            <StudioHelpButton />
          </div>
        )}
      </div>

      {shellToken && serverUrl && (
        <LiveKitShell
          token={shellToken}
          serverUrl={serverUrl}
          isHost={isHost}
          isViewer={isViewer}
          roomId={roomId}
          subjectToControls={subjectToControls}
          controlsAllowPublishAudio={controlsAllowPublishAudio}
          controlsTileVisible={controlsTileVisible}
          controlsAllowScreenShare={controlsAllowScreenShare}
          screenShareMode={effectiveScreenShareMode}
          screenShareRouteNonce={screenShareRouteNonce}
          watermarkEnabled={watermarkEnabled}
          dashboardOpen={dashboardOpen}
          onCloseDashboard={() => setDashboardOpen(false)}
          roomName={roomName || ""}
          roomAccessToken={roomAccessToken}
          canMuteGuests={canMuteGuestsUi}
          canRemoveGuests={canRemoveGuestsUi}
          canModerate={canModerateUi}
          roomAccessMode={roomAccessMode}
          onRoomAccessChange={setRoomAccessMode}
          effectivePermissionsMode={effectivePermissionsMode}
          key={connectAttempt}
          dashboardRole={dashboardRole}
          canLayout={canLayoutUi}
          onLeaveRequested={() => {
            void handleEndStream();
          }}
          onDisconnected={handleLiveKitDisconnected}
          onConnectError={handleLiveKitConnectError}
          onConnected={handleLiveKitConnected}
          onActiveSharerChange={setActiveSharerName}
          audioMixerEnabled={featureAccess.audioMixer.allowed}
          advancedScreenShareEnabled={featureAccess.advancedScreenShare.allowed}
          presenceMode={presenceMode}
          showLayoutPicker={showLayoutPicker}
          onToggleLayoutPicker={() => setShowLayoutPicker(v => !v)}
          isAudience={isAudience}
          controlsAudioBlocked={controlsAudioBlocked}
          controlsVideoBlocked={controlsVideoBlocked}
          onPublishPermissionChange={handlePublishPermissionChange}
          capturePresetId={ownerDefaultPresetId}
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

            <p style={{ marginTop: 0, marginBottom: 10, color: "#94a3b8", fontSize: 13 }}>
              Copy a participant link to invite someone on stage{isHost ? ", or a co-host link for someone who helps run the room" : ""}.
            </p>
            <div
              data-testid="invite-access-state"
              style={{
                marginBottom: 14,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(59,130,246,0.35)",
                background: "rgba(59,130,246,0.08)",
                fontSize: 12,
                color: "#bfdbfe",
              }}
            >
              <strong>Access: {roomAccessLabel(roomAccessMode)}</strong>
              {" — "}
              {roomAccessInviteSummary(roomAccessMode)} {ROOM_ACCESS_HLS_NOTE}
            </div>

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
              {isHost && (
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
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Co-host</span>
                    <span style={{ fontSize: 12, color: "#9ca3af" }}>Helps run the room; must sign in</span>
                  </div>
                  <button
                    onClick={() => copyInviteLink("cohost", "Co-host")}
                    aria-label="Copy co-host invite link"
                    style={{
                      fontSize: 12,
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid rgba(129, 140, 248, 0.4)",
                      background:
                        copiedInviteLabel === "Co-host"
                          ? "rgba(129, 140, 248, 0.18)"
                          : "rgba(129, 140, 248, 0.08)",
                      color: copiedInviteLabel === "Co-host" ? "#c7d2fe" : "#818cf8",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    {copiedInviteLabel === "Co-host" ? "Copied" : "Copy co-host link"}
                  </button>
                </div>
              )}
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
          presetOptions={presetOptionsForUi}
          onPresetChange={handlePresetChange}
          explicitPresetId={explicitPresetId}
          presetAdjustment={chipPresetAdjustment}
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

      {featureAccess.audioMixer.allowed && (
      <AudioMixerModal
        open={showMixer}
        onClose={() => setShowMixer(false)}
        canBroadcast={!isAudience && (isHost || can("canStream"))}
      />
      )}

      {featureAccess.advancedScreenShare.allowed && (
      <ScreenShareRouter
        open={showScreenShareRouter}
        onClose={() => setShowScreenShareRouter(false)}
        mode={screenShareMode}
        onModeChange={setScreenShareMode}
        activeSharerName={activeSharerName}
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

export default function RoomPageWithTour() {
  return (
    <TourProvider tourName="studio">
      <RoomPage />
    </TourProvider>
  );
}

function StudioHelpButton() {
  const {
    startTour,
    helpMenuOpen,
    setHelpMenuOpen,
    tourActive,
  } = useTour();
  const helpMenuRef = useRef<HTMLDivElement | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    if (!helpMenuOpen && !guideOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!helpMenuOpen) return;
      if (helpMenuRef.current?.contains(event.target as Node)) return;
      setHelpMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHelpMenuOpen(false);
      setGuideOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [helpMenuOpen, guideOpen, setHelpMenuOpen]);

  const menuButtonStyle = {
    fontSize: '0.75rem',
    padding: '0.5rem 0.75rem',
    borderRadius: '0.375rem',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    fontWeight: '500',
  } as const;

  return (
    <>
      <div ref={helpMenuRef} data-tour="help-button" style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setHelpMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={helpMenuOpen}
          style={{
            ...menuButtonStyle,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            border: helpMenuOpen
              ? '1px solid rgba(59, 130, 246, 0.7)'
              : '1px solid rgba(255, 255, 255, 0.4)',
            background: helpMenuOpen
              ? 'rgba(255, 255, 255, 0.12)'
              : 'rgba(255, 255, 255, 0.05)',
            color: '#ffffff',
          }}
        >
          <span>Help</span>
          <span style={{ fontSize: '0.65rem', opacity: 0.75 }}>{helpMenuOpen ? '▲' : '▼'}</span>
        </button>

        {helpMenuOpen && (
          <div
            role="menu"
            aria-label="Help actions"
            style={{
              position: 'absolute',
              top: 'calc(100% + 10px)',
              right: 0,
              width: '200px',
              padding: '0.5rem',
              borderRadius: '0.75rem',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              background: 'rgba(15, 23, 42, 0.96)',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 18px 48px rgba(0,0,0,0.38)',
              zIndex: 1200,
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setHelpMenuOpen(false);
                startTour();
              }}
              style={{
                ...menuButtonStyle,
                width: '100%',
                textAlign: 'left',
                border: '1px solid rgba(220, 38, 38, 0.28)',
                background: tourActive ? 'rgba(220, 38, 38, 0.18)' : 'rgba(220, 38, 38, 0.1)',
                color: '#fca5a5',
                marginBottom: '0.5rem',
              }}
            >
              Start Tour
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setHelpMenuOpen(false);
                setGuideOpen(true);
              }}
              style={{
                ...menuButtonStyle,
                width: '100%',
                textAlign: 'left',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                background: 'rgba(59, 130, 246, 0.12)',
                color: '#bfdbfe',
              }}
            >
              Help Guide
            </button>
          </div>
        )}
      </div>

      {guideOpen && (
        <>
          <button
            type="button"
            aria-label="Close help guide"
            onClick={() => setGuideOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              border: 'none',
              padding: 0,
              margin: 0,
              background: 'rgba(2, 6, 23, 0.55)',
              zIndex: 1998,
              cursor: 'pointer',
            }}
          />
          <aside
            aria-label="Studio help guide"
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              width: 'min(420px, 92vw)',
              height: '100vh',
              background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 0.98))',
              borderLeft: '1px solid rgba(148, 163, 184, 0.35)',
              boxShadow: '-24px 0 60px rgba(0, 0, 0, 0.42)',
              zIndex: 1999,
              display: 'flex',
              flexDirection: 'column',
              animation: 'slideInGuide 220ms ease-out',
            }}
          >
            <div style={{ padding: '1rem 1rem 0.75rem 1rem', borderBottom: '1px solid rgba(148, 163, 184, 0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#e2e8f0' }}>Studio Help Guide</h3>
                <button
                  type="button"
                  onClick={() => setGuideOpen(false)}
                  style={{
                    border: '1px solid rgba(148, 163, 184, 0.35)',
                    background: 'rgba(15, 23, 42, 0.6)',
                    color: '#e2e8f0',
                    borderRadius: '0.5rem',
                    padding: '0.35rem 0.55rem',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                  }}
                >
                  Close
                </button>
              </div>
              <p style={{ margin: '0.5rem 0 0 0', color: '#94a3b8', fontSize: '0.8rem' }}>
                Quick reminders while you are live. No page switch required.
              </p>
            </div>

            <div style={{ padding: '0.9rem 1rem 1rem 1rem', overflowY: 'auto', display: 'grid', gap: '0.75rem' }}>
              <div style={{ border: '1px solid rgba(245, 158, 11, 0.28)', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#fcd34d', fontSize: '0.82rem' }}>PREPARE - Before Going Live</div>
              </div>

              <div style={{ border: '1px solid rgba(248, 113, 113, 0.25)', background: 'rgba(220, 38, 38, 0.08)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#fecaca', fontSize: '0.85rem' }}>1) Start with Layout + Audio Checks</div>
                <ul style={{ margin: '0.45rem 0 0 1rem', padding: 0, color: '#e2e8f0', fontSize: '0.78rem', lineHeight: 1.45 }}>
                  <li>Select layout first (Grid, Speaker, Single view).</li>
                  <li>Confirm every guest is visible.</li>
                  <li>Open mixer and verify mic levels move cleanly.</li>
                  <li>Confirm screen share audio is audible when used.</li>
                  <li>Mute unused microphones.</li>
                </ul>
                <div style={{ marginTop: '0.45rem', color: '#fca5a5', fontSize: '0.76rem', fontWeight: 600 }}>
                  Most broadcast issues start with bad audio. Check this first.
                </div>
              </div>

              <div style={{ border: '1px solid rgba(192, 132, 252, 0.28)', background: 'rgba(147, 51, 234, 0.08)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#e9d5ff', fontSize: '0.85rem' }}>2) Confirm Cameras and Names</div>
                <ul style={{ margin: '0.45rem 0 0 1rem', padding: 0, color: '#e2e8f0', fontSize: '0.78rem', lineHeight: 1.45 }}>
                  <li>Cameras ON for visible guests.</li>
                  <li>Names are correct and not duplicated.</li>
                  <li>Background distractions are minimized.</li>
                  <li>Focused participant is correct for highlight layouts.</li>
                </ul>
                <div style={{ marginTop: '0.45rem', color: '#ddd6fe', fontSize: '0.76rem' }}>
                  Frozen guest tip: ask them to toggle camera OFF then ON.
                </div>
              </div>

              <div style={{ border: '1px solid rgba(96, 165, 250, 0.25)', background: 'rgba(59, 130, 246, 0.08)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#bfdbfe', fontSize: '0.85rem' }}>3) Use Invite Links for Guests</div>
                <ul style={{ margin: '0.45rem 0 0 1rem', padding: 0, color: '#e2e8f0', fontSize: '0.78rem', lineHeight: 1.45 }}>
                  <li>Send invite links from top bar.</li>
                  <li>Wait for camera connected, audio detected, and stable video.</li>
                  <li>Do not go live until guests are fully connected.</li>
                </ul>
              </div>

              <div style={{ border: '1px solid rgba(74, 222, 128, 0.3)', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#bbf7d0', fontSize: '0.82rem' }}>GO LIVE - Start the Broadcast</div>
              </div>

              <div style={{ border: '1px solid rgba(74, 222, 128, 0.25)', background: 'rgba(34, 197, 94, 0.08)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#bbf7d0', fontSize: '0.85rem' }}>4) Go Live After Preview Looks Right</div>
                <ul style={{ margin: '0.45rem 0 0 1rem', padding: 0, color: '#e2e8f0', fontSize: '0.78rem', lineHeight: 1.45 }}>
                  <li>Destination status must show ready.</li>
                  <li>Preview layout and audio levels must be stable.</li>
                  <li>Screen share visible (if used).</li>
                  <li>Then click Go Live.</li>
                </ul>
              </div>

              <div style={{ border: '1px solid rgba(45, 212, 191, 0.25)', background: 'rgba(20, 184, 166, 0.08)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#99f6e4', fontSize: '0.85rem' }}>5) Watch the Program Window</div>
                <div style={{ marginTop: '0.35rem', color: '#e2e8f0', fontSize: '0.78rem', lineHeight: 1.45 }}>
                  Treat the program window as source of truth. If it looks wrong there, viewers see it wrong.
                </div>
              </div>

              <div style={{ border: '1px solid rgba(56, 189, 248, 0.28)', background: 'rgba(14, 165, 233, 0.09)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#bae6fd', fontSize: '0.82rem' }}>DURING BROADCAST - Live Management</div>
              </div>

              <div style={{ border: '1px solid rgba(56, 189, 248, 0.25)', background: 'rgba(14, 165, 233, 0.08)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#bae6fd', fontSize: '0.85rem' }}>6) Switching Layouts Mid-Show</div>
                <div style={{ marginTop: '0.35rem', color: '#e2e8f0', fontSize: '0.78rem', lineHeight: 1.45 }}>
                  Change layout when guests change, focus shifts, or screen share starts. Pause briefly before switching to keep viewers oriented.
                </div>
              </div>

              <div style={{ border: '1px solid rgba(167, 139, 250, 0.25)', background: 'rgba(139, 92, 246, 0.08)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#ddd6fe', fontSize: '0.85rem' }}>7) Managing Guests</div>
                <ul style={{ margin: '0.45rem 0 0 1rem', padding: 0, color: '#e2e8f0', fontSize: '0.78rem', lineHeight: 1.45 }}>
                  <li>Mute noisy guests quickly.</li>
                  <li>Remove disconnected users.</li>
                  <li>Adjust layout as participants change.</li>
                  <li>If a guest drops, send a new invite link.</li>
                </ul>
              </div>

              <div style={{ border: '1px solid rgba(244, 114, 182, 0.25)', background: 'rgba(236, 72, 153, 0.08)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#fbcfe8', fontSize: '0.85rem' }}>8) Screen Sharing Tips</div>
                <ul style={{ margin: '0.45rem 0 0 1rem', padding: 0, color: '#e2e8f0', fontSize: '0.78rem', lineHeight: 1.45 }}>
                  <li>Close unnecessary windows before sharing.</li>
                  <li>Select the correct tab/window and audio source.</li>
                  <li>After sharing, verify visibility in program window.</li>
                </ul>
              </div>

              <div style={{ border: '1px solid rgba(251, 146, 60, 0.3)', background: 'rgba(234, 88, 12, 0.1)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#fdba74', fontSize: '0.82rem' }}>ENDING - Closing the Session</div>
              </div>

              <div style={{ border: '1px solid rgba(251, 146, 60, 0.25)', background: 'rgba(234, 88, 12, 0.08)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#fdba74', fontSize: '0.85rem' }}>9) Ending Your Broadcast</div>
                <div style={{ marginTop: '0.35rem', color: '#e2e8f0', fontSize: '0.78rem', lineHeight: 1.45 }}>
                  Click Stop Broadcast, confirm shutdown, then wait for recording finalization. Do not close browser immediately.
                </div>
              </div>

              <div style={{ border: '1px solid rgba(251, 191, 36, 0.25)', background: 'rgba(234, 179, 8, 0.08)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#fde68a', fontSize: '0.85rem' }}>10) Confirm Recording Saved</div>
                <ul style={{ margin: '0.45rem 0 0 1rem', padding: 0, color: '#e2e8f0', fontSize: '0.78rem', lineHeight: 1.45 }}>
                  <li>Recording entry exists.</li>
                  <li>Playback opens and works.</li>
                  <li>File is saved correctly.</li>
                  <li>If save fails, report immediately.</li>
                </ul>
              </div>

              <div style={{ border: '1px solid rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#fca5a5', fontSize: '0.82rem' }}>Quick Trouble Fixes</div>
                <div style={{ marginTop: '0.35rem', color: '#e2e8f0', fontSize: '0.78rem', lineHeight: 1.45 }}>
                  No Audio: mic device + browser permissions + mixer levels, then refresh/rejoin.<br />
                  Camera Missing: permission + correct device, then restart camera/refresh.<br />
                  Screen Share Missing: confirm correct window/tab and restart share.<br />
                  Black Output: verify layout + active camera + program preview, then switch layout once.
                </div>
              </div>

              <div style={{ border: '1px solid rgba(94, 234, 212, 0.3)', background: 'rgba(13, 148, 136, 0.1)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#99f6e4', fontSize: '0.82rem' }}>Producer Workflow</div>
                <div style={{ marginTop: '0.35rem', color: '#e2e8f0', fontSize: '0.78rem', lineHeight: 1.45 }}>
                  Before: start room, add host, confirm layout, test audio, prep destinations.<br />
                  During: monitor program feed, adjust layout, manage guests.<br />
                  After: stop stream, confirm recording.
                </div>
              </div>

              <div style={{ border: '1px solid rgba(125, 211, 252, 0.28)', background: 'rgba(2, 132, 199, 0.1)', borderRadius: '0.65rem', padding: '0.75rem' }}>
                <div style={{ fontWeight: 700, color: '#bae6fd', fontSize: '0.82rem' }}>Streaming Destinations Check</div>
                <div style={{ marginTop: '0.35rem', color: '#e2e8f0', fontSize: '0.78rem', lineHeight: 1.45 }}>
                  Before streaming, verify YouTube, Twitch, and Facebook connections are linked and status shows ready.
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setGuideOpen(false);
                  startTour();
                }}
                style={{
                  marginTop: '0.25rem',
                  border: '1px solid rgba(220, 38, 38, 0.35)',
                  background: 'rgba(220, 38, 38, 0.16)',
                  color: '#fecaca',
                  borderRadius: '0.6rem',
                  padding: '0.65rem 0.75rem',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  textAlign: 'left',
                }}
              >
                Start the interactive studio tour
              </button>
            </div>
          </aside>

          <style>{`
            @keyframes slideInGuide {
              from { transform: translateX(100%); opacity: 0.5; }
              to { transform: translateX(0); opacity: 1; }
            }
          `}</style>
        </>
      )}
    </>
  );
}