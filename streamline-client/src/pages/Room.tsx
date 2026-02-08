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
} from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import {
  apiStartRecording,
  apiStopRecording,
  apiFetch,
  apiFetchAuth,
  getAuthToken,
  apiGetRoomPolicy,
  apiUpdateRoomPolicy,
} from "../lib/api";
import RoleOverlay from "../components/RoleOverlay";
import StreamSetupModalV2 from "../components/StreamSetupModal";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { RoleChangeToast } from "../components/RoleChangeToast";
import SafeVideoConference from "../components/SafeVideoConference";
import { useEffectiveEntitlements } from "../hooks/useEffectiveEntitlements";
import { useFeatureAccess } from "../hooks/useFeatureAccess";
import {
  RECONNECT_MEDIA_MESSAGE_TYPE,
  reconnectMedia,
  tryParseLiveKitDataMessage,
} from "../lib/mediaRecovery";
import { setPlatformFlagsValue } from "../lib/platformFlagsStore";
import { fetchDestinations, preflight, type DestinationItem } from "../services/destinations";

const DEV_CONTROLS = import.meta.env.VITE_DEV_CONTROLS === "1";

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
  try {
    return sessionStorage.getItem(`sl_guest_session:${roomId}`) || null;
  } catch {
    return null;
  }
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
  const localPermissions: any =
    (localParticipant as any)?.permissions || (localParticipant as any)?.participant?.permissions;
  const rawRolePresetId = ((localParticipant as any)?.identityMetadata as any)?.rolePresetId;
  const normalizedRolePresetId = normalizeUiRolePresetId(rawRolePresetId);

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
        alert("This recording link expired. Use Settings → Usage → Emergency Download.");
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
      alert("Failed to download recording. Use Settings → Usage → Emergency Download.");
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
    setConfirmMessage("Use Settings → Usage → Emergency Download (Latest Recording) if you're having trouble.");
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
            <p style={{ margin: 0, marginBottom: 16, color: "#d1d5db", fontSize: 14 }}>If not, you can retry via Emergency Download in Settings → Usage.</p>
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
      audio={!isViewer}
      video={!isViewer}
      connectOptions={isViewer ? { autoSubscribe: true } : undefined}
      onDisconnected={onDisconnected}
      style={{
        width: "100%",
        height: "calc(100vh - 60px)",
        position: "relative",
      }}
    >
      <div ref={mediaRootRef} style={{ width: "100%", height: "100%", position: "relative" }}>
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
    return localStorage.getItem("sl_displayName") ?? "";
  });
  const [pendingName, setPendingName] = useState(displayName);
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [showStreamSetup, setShowStreamSetup] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [allowGuests, setAllowGuests] = useState<boolean | null>(null);
  const [allowGuestsLoading, setAllowGuestsLoading] = useState(false);
  const [allowGuestsSaving, setAllowGuestsSaving] = useState(false);
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
  const [, setAuthStatus] = useState<"unknown" | "authed" | "guest">("unknown");
    const [effectivePermissionsMode, setEffectivePermissionsMode] = useState<"simple" | "advanced">("simple");
  const roomId = firestoreRoomId ?? routeRoomId ?? null;

  useEffect(() => {
    if (!inviteModalOpen) return;
    if (!roomId || !roomAccessToken) return;
    if (!isHost) return;

    let cancelled = false;
    (async () => {
      setAllowGuestsLoading(true);
      try {
        const data = await apiGetRoomPolicy(roomId, roomAccessToken);
        if (cancelled) return;
        setAllowGuests(typeof (data as any)?.allowGuests === "boolean" ? (data as any).allowGuests : null);
      } catch {
        if (!cancelled) setAllowGuests(null);
      } finally {
        if (!cancelled) setAllowGuestsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inviteModalOpen, roomId, roomAccessToken, isHost]);

  const setAllowGuestsPolicy = async (next: boolean) => {
    if (!roomId || !roomAccessToken) return;
    if (needsReauth) {
      setNeedsReauth(true);
      return;
    }

    setAllowGuestsSaving(true);
    try {
      const resp = await apiUpdateRoomPolicy(roomId, roomAccessToken, { allowGuests: next });
      setAllowGuests(resp.allowGuests);
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403 || err?.name === "ApiUnauthorizedError") {
        setNeedsReauth(true);
      }
    } finally {
      setAllowGuestsSaving(false);
    }
  };

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
    const willBeHost = createdRooms.includes(candidateKey);
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
  // /api/rooms/resolve using Authorization headers. If resolution fails,
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
            Authorization: `Bearer ${t}`,
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

          // Distinguish between legacy invite JWTs and roomAccessTokens.
          // Invite tokens must be forwarded to /api/rooms/:roomId/token as x-invite-token.
          if (tokenType === "invite") {
            setInviteToken(t);
            try {
              localStorage.setItem("sl_invite_token", t);
            } catch {
              // ignore
            }
          } else {
            // Treat the incoming token as a roomAccessToken for downstream
            // APIs (HLS, status, etc.). /api/rooms/:roomId/token will return a refreshed
            // token which will overwrite this state when available.
            setRoomAccessToken(t);
          }
          return;
        }

        // If resolve fails (legacy tokens, pure invites, etc.), fall back to
        // the previous behavior of treating `t` as an invite token only.
        console.warn("[Room] /api/rooms/resolve failed for token route", res.status);
        setInviteToken(t);
        try {
          localStorage.setItem("sl_invite_token", t);
        } catch {
          // ignore
        }
      } catch (err) {
        if (cancelled) return;
        console.warn("[Room] /api/rooms/resolve error; treating t as invite", err);
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
    // Guests should only request RTC tokens once the room is live.
    if (!isHost && roomGateStatus !== "live") return;
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
        console.log(`[Room] Fetching room token (role=${role || "host"})...`);
        const bearerToken = getAuthToken();
        // Force invite mode when a token is present in the URL and we are not authed.
        // This matches the legacy participant join flow: /room/<roomId>?t=<inviteToken>
        // Also fall back to any locally-stored invite token for backward compatibility.
        const inviteTokenFromUrl = new URLSearchParams(window.location.search).get("t");
        const inviteTokenForJoin = (inviteTokenFromUrl || inviteToken || null)?.trim?.() || null;
        const guestSessionToken = getGuestSessionToken(roomId);
        const buildRoomTokenRequest = () => {
          const canonicalRoomId = roomId || "";
          const endpoint = `${API_BASE}/api/rooms/${encodeURIComponent(canonicalRoomId)}/token`;
          const payload: any = { identity: displayName };

          // New API uses the URL roomId; keep displayName in the body so
          // participant name is set in LiveKit.

          // Tell the backend what role we want this token minted as.
          // The backend will clamp/lock it as needed.
          // If we failed auth for a privileged role, always request a low-trust role
          // for the guest fallback so the UI can honestly operate in viewer/guest mode.
          payload.role = role;

          payload.uid = getOrCreateUid();
          payload.displayName = displayName;
          // Invites are currently guest/participant-only (no elevated roles).
          if (!bearerToken && inviteTokenForJoin) {
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
          ? await apiFetchAuth(endpoint, { method: "POST", body: JSON.stringify(payload) }, { allowNonOk: true })
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

        console.log("[roomToken] raw response:", data);
        if (typeof data?.token !== "string" || !data.token) {
          console.error("[Room] Invalid token returned:", data);
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
        if (typeof participantIdentityRaw === "string" && participantIdentityRaw.trim()) {
          setParticipantIdentity(participantIdentityRaw.trim());
        } else {
          setParticipantIdentity(null);
        }
        const finalServerUrl = serverUrlFromApi || import.meta.env.VITE_LIVEKIT_URL;
        console.log("[Room] token received:", !!lkToken, "serverUrl:", finalServerUrl);
        setToken(typeof lkToken === "string" && lkToken.trim() ? lkToken : null);
        setServerUrl(finalServerUrl || null);
        if (typeof data?.isViewer === "boolean") {
          setIsViewer(data.isViewer);
          if (data.isViewer) {
            setIsHost(false);
            setUserRole("viewer");
          }
        }
        if (typeof data?.effectiveRoleKey === "string") {
          setUserRole(data.effectiveRoleKey);
          if (data.effectiveRoleKey === "viewer") setIsHost(false);
        } else if (typeof data?.role === "string") {
          setUserRole(data.role);
          if (data.role === "viewer") setIsHost(false);
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
  }, [displayName, roomId, effectiveRoomName, inviteToken, userRole, isHost, hostCheckReady, token, serverUrl, roomGateStatus]);

  

  useEffect(() => {
    if (isViewer && showStreamSetup) {
      setShowStreamSetup(false);
    }
  }, [isViewer, showStreamSetup]);

  // Guest flow: poll idle/live and auto-join when live.
  // Hosts can join anytime (they flip the room live on join).
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
        const res = await apiFetch(
          `/api/rooms/${encodeURIComponent(roomId)}/status`,
          {
            headers: {
              ...(inviteToken ? { "x-invite-token": inviteToken } : {}),
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
        setRoomGateStatus(status);

        if (status === "idle") {
          roomGatePollRef.current = setTimeout(poll, 4000);
        }
      } catch {
        if (!cancelled) {
          roomGatePollRef.current = setTimeout(poll, 5000);
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
      } catch (err) {
        if (!cancelled) {
          console.error("[Room] failed to load media prefs/entitlements", err);
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

  // If the user stayed in the room while the recording was processing, re-open
  // the modal once the recording becomes ready so they can download it.
  useEffect(() => {
    if (!stayedInRoomDuringProcessing) return;
    if (!postStopReady) return;
    setStayedInRoomDuringProcessing(false);
    setShowStreamEndedModal(true);
  }, [postStopReady, stayedInRoomDuringProcessing]);

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
      } catch (e) {
        console.error("destinations load failed", e);
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
    } catch (e) {
      // no-op
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
      } catch (e) {
        console.error("preflight failed", e);
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
    if (isHost && effectiveRoomName && roomAccessToken) {
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
    if (!postStopReady) {
      setStayedInRoomDuringProcessing(true);
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

  const handleEndStream = async () => {
    if (canManageStream && streamStatus === "live") {
      alert("⏹️ Stream is still live. Stop the stream first.");
      return;
    }
    if (canManageStream && recordingStatus === "recording") {
      alert("⏹️ Recording is still active. Stop the stream first.");
      return;
    }
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
    const destinationInputs = Array.isArray(keys.destinations) ? keys.destinations : [];
    let youtubeKey = keys.youtubeKey;
    let facebookKey = keys.facebookKey;
    let twitchKey = keys.twitchKey;
    let enabledTargetIds = Array.isArray(keys.enabledTargetIds) ? keys.enabledTargetIds.filter((id) => !!id) : [];
    let sessionKeyMap: Record<string, { rtmpUrlBase?: string; streamKey?: string }> = keys.sessionKeys ? { ...keys.sessionKeys } : {};
    const extraDestinations = Array.isArray(keys.extraDestinations) ? keys.extraDestinations : [];

    if (destinationInputs.length) {
      const fromDestinations: string[] = [];
      destinationInputs.forEach((item) => {
        const trimmed = (item.streamKey || "").trim();
        if (item.source === "main" && item.destinationId) {
          fromDestinations.push(item.destinationId);
        }
        if (item.source === "session" && trimmed) {
          if (item.destinationId || item.targetId) {
            const keyId = item.targetId || item.destinationId!;
            sessionKeyMap[keyId] = { rtmpUrlBase: item.rtmpUrlBase, streamKey: trimmed };
          } else {
            if (item.platform === "youtube") youtubeKey = trimmed;
            if (item.platform === "facebook") facebookKey = trimmed;
            if (item.platform === "twitch") twitchKey = trimmed;
            if (item.platform === "custom") {
              let base = item.rtmpUrlBase;
              let key = trimmed;
              if (!base && trimmed.startsWith("rtmp")) {
                const idx = trimmed.lastIndexOf("/");
                if (idx > 8) {
                  const maybeBase = trimmed.slice(0, idx);
                  const maybeKey = trimmed.slice(idx + 1);
                  if (maybeBase && maybeKey) {
                    base = maybeBase;
                    key = maybeKey;
                  }
                }
              }
              const keyId = `custom-${Object.keys(sessionKeyMap).length + 1}`;
              sessionKeyMap[keyId] = { rtmpUrlBase: base, streamKey: key };
            }
          }
        }
      });
      if (fromDestinations.length) {
        const merged = [...enabledTargetIds];
        fromDestinations.forEach((id) => {
          if (!merged.includes(id)) merged.push(id);
        });
        enabledTargetIds = merged;
      }
    }

    const destIds = Array.isArray(enabledTargetIds)
      ? enabledTargetIds.filter((id) => !!id)
      : [];
    const hasSessionKeys = Object.values(sessionKeyMap || {}).some((entry) => !!entry?.streamKey);
    const hasDirectKeys = !!(youtubeKey || facebookKey || twitchKey);

    if (!hasDirectKeys && !hasSessionKeys && destIds.length === 0) {
      alert("Select at least one saved stream destination or enter a stream key.");
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
          youtubeStreamKey: youtubeKey,
          facebookStreamKey: facebookKey,
          twitchStreamKey: twitchKey,
          enabledTargetIds: destIds.length ? destIds : undefined,
          sessionKeys: hasSessionKeys ? sessionKeyMap : undefined,
          userId: getOrCreateUid(),
          presetId: selectedPresetId,
          extraDestinations: extraDestinations.length ? extraDestinations : undefined,
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

  return (
    <>
      <RoleChangeToast message={roleChangeMessage} />
      {isViewer && (
        <div className="w-full bg-amber-500 text-black text-sm font-semibold px-4 py-2 flex items-center gap-2">
          👀 View-only mode — publishing controls are disabled.
        </div>
      )}
      {!isHost && roomGateStatus === "idle" && !token && (
        <div className="w-full bg-slate-900 text-white text-sm font-semibold px-4 py-2 flex items-center justify-between gap-3">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span>Not started yet — waiting for the host to start.</span>
          </div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>This page will auto-join when live.</div>
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
              Copy a participant link to invite someone on stage.
            </p>

            {isHost && roomId && roomAccessToken && (
              <div
                style={{
                  marginBottom: 14,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #1f2937",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Guest access</div>
                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: allowGuestsSaving ? "not-allowed" : "pointer" }}>
                  <input
                    type="checkbox"
                    disabled={allowGuestsLoading || allowGuestsSaving}
                    checked={allowGuests !== false}
                    onChange={(e) => {
                      const next = !!(e.target as HTMLInputElement).checked;
                      void setAllowGuestsPolicy(next);
                    }}
                  />
                  <span>Allow guests to join without signing in</span>
                </label>
                <div style={{ marginTop: 6, fontSize: 12, color: "#9ca3af", lineHeight: 1.4 }}>
                  {allowGuestsLoading
                    ? "Loading guest access policy…"
                    : allowGuests === false
                      ? "Guests are currently disabled for this room."
                      : allowGuests === true
                        ? "Guests are enabled for this room (still subject to server settings and room live status)."
                        : "Not configured yet — currently treated as enabled for compatibility."}
                </div>
              </div>
            )}

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

        /* Ensure LiveKit prefab fills the available room height */
        .sl-layout .lk-video-conference,
        .sl-layout .lk-video-conference-inner,
        .sl-layout .lk-grid-layout-wrapper,
        .sl-layout .lk-focus-layout-wrapper {
          height: 100% !important;
          min-height: 0 !important;
        }

        ${isViewer ? `
        .sl-layout.sl-viewer .lk-control-bar .lk-button-microphone,
        .sl-layout.sl-viewer .lk-control-bar .lk-button-camera,
        .sl-layout.sl-viewer .lk-control-bar .lk-button-screen-share,
        .sl-layout.sl-viewer .lk-control-bar .lk-button-start-audio,
        .sl-layout.sl-viewer .lk-control-bar [data-lk-button="toggle_mic"],
        .sl-layout.sl-viewer .lk-control-bar [data-lk-button="toggle_camera"],
        .sl-layout.sl-viewer .lk-control-bar [data-lk-button="toggle_screen_share"],
        .sl-layout.sl-viewer .lk-control-bar [data-lk-button="start_audio"],
        .sl-layout.sl-viewer .lk-control-bar button[aria-label*="Microphone"],
        .sl-layout.sl-viewer .lk-control-bar button[aria-label*="Camera"],
        .sl-layout.sl-viewer .lk-control-bar button[aria-label*="Screen"] {
          display: none !important;
        }
        ` : ""}

        /* Realtime room controls: disable screen share for roles
           whose effective controls do not allow it. */
        .sl-layout.sl-controls-no-screen .lk-control-bar .lk-button-screen-share,
        .sl-layout.sl-controls-no-screen .lk-control-bar [data-lk-button="toggle_screen_share"],
        .sl-layout.sl-controls-no-screen .lk-control-bar button[aria-label*="Screen"] {
          opacity: 0.6 !important;
          filter: grayscale(1);
        }

        /* Realtime room controls (Phase 1): disable guest mic UI */
        .sl-layout.sl-controls-no-audio .lk-control-bar .lk-button-microphone,
        .sl-layout.sl-controls-no-audio .lk-control-bar [data-lk-button="toggle_mic"],
        .sl-layout.sl-controls-no-audio .lk-control-bar button[aria-label*="Microphone"] {
          pointer-events: none !important;
          opacity: 0.35 !important;
          filter: grayscale(1);
        }

        /* Best-effort self-tile fade (LiveKit DOM varies by version) */
        .sl-layout.sl-controls-hide-self [data-lk-local-participant="true"],
        .sl-layout.sl-controls-hide-self [data-lk-participant-tile][data-lk-local-participant="true"],
        .sl-layout.sl-controls-hide-self .lk-participant-tile[data-lk-local-participant="true"] {
          opacity: 0.08 !important;
          pointer-events: none !important;
        }
      `}</style>
    </>
  );
};

export default RoomPage;