import { useEffect, useState, useRef } from "react";
import { logAuthDebugContext } from "../lib/logAuthDebug";
import { useNavigate, useParams } from "react-router-dom";
import { apiStartRecording, apiStopRecording } from "../lib/api";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";
import { fetchDestinations, preflight, type DestinationItem } from "../services/destinations";
import StreamSetupModalV2 from "../components/StreamSetupModal";
import { ErrorBoundary } from "../components/ErrorBoundary";
import RoleOverlay from "../components/RoleOverlay";
import { HostAVControls } from "../components/HostAVControls";
import { API_BASE } from "../lib/apiBase";

// Use relative paths - Vite proxy forwards /api/* to http://localhost:5137
type StreamStatus = "idle" | "starting" | "live" | "stopping";
type RecordingStatus = "idle" | "recording" | "stopping" | "stopped" | "error";

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
          {recordingCountdown && (
            <div
              style={{
                position: "absolute",
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

function StreamEndedModal({
  recordingId,
  onStartEditing,
  onExitRoom,
  onStayInRoom,
}: {
  recordingId: string;
  onStartEditing: () => void;
  onExitRoom: () => void;
  onStayInRoom: () => void;
}) {
  const [processing, setProcessing] = useState(true);
  const [ready, setReady] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);
  const MAX_POLLS = 100;

  useEffect(() => {
    if (!recordingId) return;

    const pollStatus = async () => {
      pollCountRef.current += 1;
      if (pollCountRef.current > MAX_POLLS) {
        console.warn("⚠️ Max polling attempts reached. Stopping.");
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setProcessing(false);
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/recordings/${recordingId}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to fetch recording status");

        const text = await res.text();
        if (!text) throw new Error("Empty response from server");

        let payload: any;
        try {
          payload = JSON.parse(text);
        } catch (err) {
          throw new Error(`Non-JSON poll response (possible auth/CORS): ${text.slice(0, 120)}`);
        }
        console.log("🔍 Full response:", payload);

        const status = payload?.data?.status ?? payload?.status ?? "PROCESSING";
        const downloadReady = !!payload?.data?.downloadReady;

        console.log("📊 Recording status:", status);
        console.log("📦 downloadReady:", downloadReady);

        if (downloadReady) {
          console.log("✅ downloadReady is true - enabling download button!");
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
            console.log("🛑 Polling stopped - recording is ready!");
          }
          setProcessing(false);
          setReady(true);
          return;
        }

        setProcessing(true);
      } catch (err) {
        console.error("❌ Poll error:", err);
        setProcessing(true);
      }
    };

    pollStatus();
    intervalRef.current = setInterval(pollStatus, 3000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [recordingId]);

  const handleDownload = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/recordings/${recordingId}/download-link`, {
        credentials: "include",
      });
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
      await fetch(`${API_BASE}/api/recordings/${recordingId}/download-link?confirm=true`, {
        credentials: "include",
      });
      setConfirmMessage("Great — you're all set. Save the file somewhere safe.");
    } catch (e) {
      setConfirmMessage("Noted. Thanks for confirming.");
    } finally {
      setShowConfirmModal(false);
    }
  };

  const handleConfirmNo = async () => {
    try {
      await fetch(`${API_BASE}/api/recordings/${recordingId}/report-download-issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: "user_reported_issue" }),
      });
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
            <div>Processing recording...</div>
            <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: '0.5rem' }}>
              This usually takes 1-2 minutes. The download button will activate when ready.
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', width: '100%' }}>
            <button
              onClick={onStartEditing}
              style={{
                width: '100%',
                padding: '1rem',
                background: 'linear-gradient(to right, #4b5563, #374151)',
                color: '#d1d5db',
                border: 'none',
                borderRadius: '0.5rem',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: 'not-allowed',
                transition: 'all 0.3s ease',
                opacity: 0.8,
              }}
              disabled
            >
              ✂️ Editing (Coming Soon)
            </button>
            <div style={{ fontSize: '0.8rem', color: '#9ca3af', textAlign: 'center' }}>
              Editing suite is coming soon. Stay tuned!
            </div>
          </div>
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
            🚪 Exit Room
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

export default function Room() {
  useEffect(() => {
    logAuthDebugContext("Arrive Room Page");
  }, []);

  useEffect(() => {
    return () => {
      recordingCountdownTimersRef.current.forEach(clearTimeout);
      recordingCountdownTimersRef.current = [];
      liveCountdownTimersRef.current.forEach(clearTimeout);
      liveCountdownTimersRef.current = [];
    };
  }, []);

  const streamEgressRef = useRef<string | null>(null);
  const nav = useNavigate();
  const { roomName } = useParams<{ roomName: string }>();

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
  const [egressId, setEgressId] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [showGoodbye, setShowGoodbye] = useState(false);
  const [showStreamEndedModal, setShowStreamEndedModal] = useState(false);
  const currentUserId = getOrCreateUid();
  const [isHost, setIsHost] = useState(false);
  const [userRole, setUserRole] = useState<string>("guest");
  const [isViewer, setIsViewer] = useState(false);
  const [recordingCountdown, setRecordingCountdown] = useState<string | null>(null);
  const [isRecordingCountdown, setIsRecordingCountdown] = useState(false);
  const recordingCountdownTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const [liveCountdown, setLiveCountdown] = useState<string | null>(null);
  const [isLiveCountdown, setIsLiveCountdown] = useState(false);
  const liveCountdownTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => {
    if (!roomName) return;
    const createdRooms = JSON.parse(localStorage.getItem("sl_created_rooms") || "[]");
    const willBeHost = createdRooms.includes(roomName);
    setIsHost(willBeHost);
    const currentRole = localStorage.getItem("sl_current_role") || "guest";
    setUserRole(currentRole);
    console.log('🏠 Host Check:', { roomName, createdRooms, isHost: willBeHost, role: currentRole });
  }, [roomName, currentUserId]);

  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>("idle");
  const recordingRef = useRef<string | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const lastRecordingStatusRef = useRef<RecordingStatus>("idle");
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [recordingPlanId, setRecordingPlanId] = useState<string | null>(null);
  const [maxRecordingMinutesPerClip, setMaxRecordingMinutesPerClip] = useState<number | null>(null);
  const [recordingToast, setRecordingToast] = useState<string | null>(null);
  const lastStopWasAutoRef = useRef<boolean>(false);
  const autoStopTriggeredRef = useRef(false);
  const [viewerCount] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const streamStartTimeRef = useRef<number | null>(null);
  const lastElapsedRef = useRef(0);
  const usagePostedRef = useRef(false);
  const [didStreamThisSession, setDidStreamThisSession] = useState(false);
  const [canMultistream, setCanMultistream] = useState<boolean>(false);
  const [recordingEnabled, setRecordingEnabled] = useState<boolean>(true);
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
  const [defaultLayoutPref, setDefaultLayoutPref] = useState<"speaker" | "grid">("speaker");
  const [defaultRecordingModePref, setDefaultRecordingModePref] = useState<"cloud" | "dual">("cloud");

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

  useEffect(() => {
    if (!roomName || !displayName) return;
    const role = localStorage.getItem("sl_current_role") || userRole;
    const isGuest = role === "guest";

    const fetchToken = async () => {
      try {
        console.log(`[Room] Fetching room token (role=${role || "host"})...`);
        const buildRoomTokenRequest = (mode: "auth" | "guest") => {
          const endpoint = mode === "guest" ? `${API_BASE}/api/roomToken/guest` : `${API_BASE}/api/roomToken`;
          const payload: any = { roomName, identity: displayName };

          if (mode === "guest") {
            payload.displayName = displayName;
            payload.guestId = getOrCreateUid();
          } else {
            payload.uid = getOrCreateUid();
            // Pass invite role through so cohost/moderator links work for logged-in users.
            // Never send "host" (localStorage can be spoofed; host is derived separately).
            if (role === "participant" || role === "cohost" || role === "moderator") {
              payload.role = role;
            }
          }

          return { endpoint, payload };
        };

        const tryFetch = async (mode: "auth" | "guest") => {
          const { endpoint, payload } = buildRoomTokenRequest(mode);
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            credentials: "include",
          });
          return { res, mode };
        };

        // Primary: if role is not guest, try auth token first. If it fails due to auth, fall back to guest token.
        let attempt = await tryFetch(isGuest ? "guest" : "auth");
        if (!attempt.res.ok && !isGuest && (attempt.res.status === 401 || attempt.res.status === 403)) {
          console.warn("[Room] auth roomToken denied; falling back to guest token", attempt.res.status);
          attempt = await tryFetch("guest");
        }

        const res = attempt.res;
        console.log("[Room] roomToken status:", res.status, "mode:", attempt.mode);

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
        const { token, serverUrl } = data;
        const finalServerUrl = serverUrl || import.meta.env.VITE_LIVEKIT_URL;
        console.log("[Room] token received:", !!token, "serverUrl:", finalServerUrl);
        setToken(token);
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
        if (!token || !finalServerUrl) {
          console.error("[Room] Missing token or serverUrl", { token, serverUrl });
        }
      } catch (err) {
        console.error("[Room] fetchToken error:", err);
      }
    };

    fetchToken();
  }, [roomName, displayName]);

  useEffect(() => {
    if (isViewer && showStreamSetup) {
      setShowStreamSetup(false);
    }
  }, [isViewer, showStreamSetup]);

  // Load effective entitlements + media presets (hosts only)
  useEffect(() => {
    const role = localStorage.getItem("sl_current_role") || userRole;
    if (role === "guest") return;

    let cancelled = false;

    (async () => {
      try {
        const [presetsRes, meRes] = await Promise.all([
          fetch(`${API_BASE}/api/account/presets`, { credentials: "include" }),
          fetch(`${API_BASE}/api/account/me`, { credentials: "include" }),
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

        if (!cancelled && meRes.ok) {
          const me = await meRes.json();
          const prefs = me?.mediaPrefs || {};
          if (prefs.defaultLayout === "grid" || prefs.defaultLayout === "speaker") {
            setDefaultLayoutPref(prefs.defaultLayout);
          }
          if (prefs.defaultRecordingMode === "cloud" || prefs.defaultRecordingMode === "dual") {
            setDefaultRecordingModePref(prefs.defaultRecordingMode);
          }
          if (prefs.defaultPresetId) {
            setSelectedPresetId(prefs.defaultPresetId);
            setEffectivePresetId(prefs.defaultPresetId);
          }

          const eff = (me as any)?.effectiveEntitlements;
          if (eff && typeof eff === "object") {
            const features = eff.features || {};
            const limits = eff.limits || {};
            if (typeof eff.planId === "string") {
              setRecordingPlanId(eff.planId);
            }
            if (typeof features.recording === "boolean") {
              setRecordingEnabled(features.recording);
            }
            if (typeof features.dualRecording === "boolean") {
              setDualRecordingAllowed(features.dualRecording);
            }
            if (typeof features.watermark === "boolean") {
              setWatermarkEnabled(features.watermark);
            }
            if (typeof features.rtmpMultistream === "boolean") {
              setCanMultistream(features.rtmpMultistream);
            }
            if (typeof limits.maxGuests === "number") {
              setMaxGuestsAllowed(limits.maxGuests);
            }
            if (typeof limits.maxRecordingMinutesPerClip === "number" && limits.maxRecordingMinutesPerClip > 0) {
              setMaxRecordingMinutesPerClip(limits.maxRecordingMinutesPerClip);
            } else {
              setMaxRecordingMinutesPerClip(null);
            }
          }
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
  }, [API_BASE, userRole]);

  useEffect(() => {
    if (
      recordingStatus === "stopped" &&
      recordingId &&
      lastRecordingStatusRef.current !== "stopped" &&
      streamStatus !== "live"
    ) {
      setShowStreamEndedModal(true);
    } else if (recordingStatus !== "stopped") {
      setShowStreamEndedModal(false);
    }

    lastRecordingStatusRef.current = recordingStatus;
  }, [recordingStatus, recordingId, streamStatus]);

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

  // Load destinations (soft gate) - hosts only
  useEffect(() => {
    const role = localStorage.getItem("sl_current_role") || userRole;
    if (role === "guest") return;

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
  }, [userRole]);

  async function refreshDestinations() {
    const role = localStorage.getItem("sl_current_role") || userRole;
    if (role === "guest") return;
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
  }, [showStreamSetup, userRole]);

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
      const res = await fetch(`${API_BASE}/api/usage/streamEnded`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      console.log("[usage] streamEnded response", { status: res.status, body: text });
    } catch (e) {
      console.error("Failed to post usage", e);
    }
  };

  const handleLeftRoom = () => {
    sendUsageOnExit();
    if (isHost) {
      nav('/join', { replace: true });
    } else {
      setShowGoodbye(true);
    }
  };

  const handleHomeClick = () => {
    nav('/join', { replace: true });
  };

  const handleStayInRoom = () => {
    setShowStreamEndedModal(false);
  };

  const activePresetId = effectivePresetId || selectedPresetId;
  const activePresetLabel = presetLabelFor(activePresetId);

  const startRecording = async ({
    layout = "grid",
    mode = "cloud",
    presetId,
  }: { layout?: "speaker" | "grid"; mode?: "cloud" | "dual"; presetId?: string }) => {
    if (isViewer) {
      console.warn("startRecording blocked for viewer role");
      return;
    }
    if (!roomName) {
      console.log("❌ No roomName, can't start recording");
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

    console.log("🎬 startRecording called. roomName:", roomName, "layout:", layout, "mode:", requestedMode);

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
        const response = await apiStartRecording(roomName, layout, requestedMode, presetId || selectedPresetId);
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
        alert(`Failed to start recording: ${(e as Error).message || "Unknown error"}`);
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
      await apiStopRecording(id);
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
    if (isHost && streamStatus === "live") {
      alert("⏹️ Stream is still live. Stop the stream first.");
      return;
    }
    if (isHost && recordingStatus === "recording") {
      alert("⏹️ Recording is still active. Stop the stream first.");
      return;
    }
    // At this point stream/recording are stopped. Post usage then exit.
    sendUsageOnExit();
    if (isHost) {
      nav('/join', { replace: true });
    } else {
      setShowGoodbye(true);
    }
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

  const handleStartMultistream = async (keys: {
    youtubeKey?: string;
    facebookKey?: string;
    twitchKey?: string;
    record?: boolean;
    layout?: "speaker" | "grid";
    enabledTargetIds?: string[];
    sessionKeys?: Record<string, { rtmpUrlBase?: string; streamKey?: string }>;
    destinations?: EffectiveDestinationInput[];
  }) => {
    if (isViewer) {
      alert("View-only mode: publishing controls are disabled.");
      return;
    }
    if (streamStatus === "starting" || streamStatus === "live") return;
    if (isLiveCountdown) return;
    if (!roomName) {
      alert("No room name");
      return;
    }
    if (!canMultistream) {
      alert("Multistream is not available on your current plan. Please upgrade to enable streaming to external platforms.");
      return;
    }
    console.log("🎬 Room.tsx - handleStartMultistream called");
    const destinationInputs = Array.isArray(keys.destinations) ? keys.destinations : [];
    let youtubeKey = keys.youtubeKey;
    let facebookKey = keys.facebookKey;
    let twitchKey = keys.twitchKey;
    let enabledTargetIds = Array.isArray(keys.enabledTargetIds) ? keys.enabledTargetIds.filter((id) => !!id) : [];
    let sessionKeyMap: Record<string, { rtmpUrlBase?: string; streamKey?: string }> = keys.sessionKeys ? { ...keys.sessionKeys } : {};

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
      alert("Select at least one saved destination or enter a stream key.");
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
        };
        console.log("   Sending to API:", requestBody);
        const res = await fetch(
          `${API_BASE}/api/rooms/${encodeURIComponent(roomName)}/start-multistream`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            credentials: 'include',
          }
        );
        const raw = await res.text();
        let data: any = {};
        if (raw && raw.trim().length > 0) {
          try {
            data = JSON.parse(raw);
          } catch (parseErr) {
            console.error("start-multistream parse error", parseErr, raw);
            data = { raw };
          }
        } else {
          console.warn("start-multistream empty response body");
          data = { raw: "" };
        }
        console.log("🔍 startMultistream full response:", data);
        if (!res.ok) {
          console.error("Start multistream failed", data);
          alert(`Failed to start multistream: ${data.error || data.message || "Unknown error"}`);
          setStreamStatus("idle");
          return;
        }
        if (data?.success === false || data?.error) {
          console.error("Start multistream API indicated failure", data);
          alert(`Failed to start multistream: ${data.error || data.message || "Unknown error"}`);
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
        alert("Error starting multistream");
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
    const streamEgressId = streamEgressRef.current;
    if (!streamEgressId) {
      alert("No active stream");
      return;
    }
    if (!roomName) {
      alert("No room name");
      return;
    }
    try {
      setStreamStatus("stopping");
      const res = await fetch(
        `${API_BASE}/api/rooms/${encodeURIComponent(roomName)}/stop-multistream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ egressId: streamEgressId }),
          credentials: 'include',
        }
      );
      if (!res.ok) {
        alert("Failed to stop multistream");
        setStreamStatus("live");
        return;
      }
      setEgressId(null);
      setStreamStatus("idle");
      streamEgressRef.current = null;
      if (recordingStatus === "recording") {
        console.log("ℹ️ Stream stopped but recording still active");
      }
    } catch (err) {
      console.error("Error stopping multistream", err);
      alert("Error stopping multistream");
      setStreamStatus("live");
    }
  };

  const [roleProfiles, setRoleProfiles] = useState<Array<{ id: string; label: string }>>([]);
  const [quickRoleIds, setQuickRoleIds] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/account/roles`, { credentials: "include" });
        if (!res.ok) throw new Error("roles failed");
        const data = await res.json();
        if (Array.isArray(data?.roles)) setRoleProfiles(data.roles);
        if (Array.isArray(data?.quickRoleIds)) setQuickRoleIds(data.quickRoleIds);
      } catch (err) {
        console.warn("roles load failed, using defaults", err);
        setRoleProfiles([
          { id: "participant", label: "Participant" },
          { id: "cohost", label: "Co-host" },
          { id: "moderator", label: "Moderator" },
        ]);
        setQuickRoleIds(["participant", "cohost", "moderator"]);
      }
    })();
  }, []);

  const copyInviteLink = (role: string, label: string) => {
    const url = `${window.location.origin}/join?room=${encodeURIComponent(roomName || '')}&role=${encodeURIComponent(role)}`;
    navigator.clipboard.writeText(url);
    alert(`${label} link copied!\n${url}`);
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
  const entitlementSummary = `Rec:${recordingEnabled ? "on" : "off"} • Dual:${dualRecordingAllowed ? "on" : "off"} • Multi:${canMultistream ? "on" : "off"} • Guests:${guestCapLabel}`;

  return (
    <>
      {isViewer && (
        <div className="w-full bg-amber-500 text-black text-sm font-semibold px-4 py-2 flex items-center gap-2">
          👀 View-only mode — publishing controls are disabled.
        </div>
      )}
      {recordingStatus === "recording" && (
        <div className="fixed bottom-4 left-4 flex items-center gap-2 bg-red-600 px-4 py-3 rounded-lg shadow-lg z-40">
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

          {isHost && (
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

        {isHost && !isViewer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
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
          </div>
        )}
      </div>

      {token && serverUrl && (
        <LiveKitRoom
          data-lk-theme="default"
          className={`sl-layout${isViewer ? " sl-viewer" : ""}`}
          token={token}
          serverUrl={serverUrl}
          connect={true}
          connectOptions={isViewer ? { audio: false, video: false } : undefined}
          onDisconnected={handleLeftRoom}
          style={{
            width: "100%",
            height: "calc(100vh - 60px)",
            position: "relative",
          }}
        >
          <div style={{ width: "100%", height: "100%", position: "relative" }}>
            {isHost && !isViewer && <HostAVControls />}
            <VideoConference />
            {watermarkEnabled && (
              <img
                src="/logo.png"
                alt="StreamLine watermark"
                className="sl-watermark"
                style={{
                  top: "12px",
                  right: "12px",
                  width: "96px",
                  opacity: 0.8,
                }}
              />
            )}
          </div>

          <RoleOverlay
            open={dashboardOpen}
            onClose={() => setDashboardOpen(false)}
            role={isHost ? "host" : (userRole === "moderator" ? "moderator" : "participant")}
            roomName={roomName || ''}
          />
        </LiveKitRoom>
      )}

      {inviteModalOpen && isHost && (
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
              Copy the right link for your guest role. Moderator requires admin access; we’ll downgrade if missing.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(quickRoleIds.length ? quickRoleIds : ["participant", "cohost", "moderator"]).map((roleId) => {
                const roleLabel = roleProfiles.find((r) => r.id === roleId)?.label || roleId;
                return { role: roleId, label: roleLabel };
              }).map((item) => (
                <div
                  key={item.role}
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
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{item.label}</span>
                    <span style={{ fontSize: 12, color: "#9ca3af" }}>{item.role === "participant" ? "Standard guest join" : item.role === "cohost" ? "Co-host profile" : item.role === "moderator" ? "Moderator controls" : "Custom role (uses participant token)"}</span>
                  </div>
                  <button
                    onClick={() => copyInviteLink(item.role, item.label)}
                    style={{
                      fontSize: 12,
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid rgba(34, 197, 94, 0.4)",
                      background: "rgba(34, 197, 94, 0.08)",
                      color: "#22c55e",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Copy link
                  </button>
                </div>
              ))}
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
          </div>
        }
      >
        <StreamSetupModalV2
          open={showStreamSetup && !isViewer}
          onClose={() => setShowStreamSetup(false)}
          roomName={roomName ?? ""}
          selectedPresetId={selectedPresetId}
          defaultLayout={defaultLayoutPref}
          defaultRecordingMode={defaultRecordingModePref}
          streamStatus={streamStatus}
          onStartStream={handleStartMultistream}
          onStopStream={handleStopMultistream}
          recordingStatus={recordingStatus}
          onStartRecording={startRecording}
          onStopRecording={stopRecording}
          recordingEnabled={recordingEnabled}
          multistreamAllowed={canMultistream}
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
          onStartEditing={() => nav('/edit', { replace: true })}
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

        ${isViewer ? `
        .sl-layout.sl-viewer .lk-control-bar .lk-button-microphone,
        .sl-layout.sl-viewer .lk-control-bar .lk-button-camera,
        .sl-layout.sl-viewer .lk-control-bar .lk-button-screen-share,
        .sl-layout.sl-viewer .lk-control-bar .lk-button-start-audio,
        .sl-layout.sl-viewer .lk-control-bar [data-lk-button="toggle_mic"],
        .sl-layout.sl-viewer .lk-control-bar [data-lk-button="toggle_camera"],
        .sl-layout.sl-viewer .lk-control-bar [data-lk-button="toggle_screen_share"],
        .sl-layout.sl-viewer .lk-control-bar button[aria-label*="Microphone"],
        .sl-layout.sl-viewer .lk-control-bar button[aria-label*="Camera"],
        .sl-layout.sl-viewer .lk-control-bar button[aria-label*="Screen"] {
          display: none !important;
        }
        ` : ""}
      `}</style>
    </>
  );
};