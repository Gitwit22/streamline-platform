import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";
import StreamSetupModalV2 from "../components/StreamSetupModal";
import RoleOverlay from "../components/RoleOverlay";
import { HostAVControls } from "../components/HostAVControls";



// Use relative paths - Vite proxy forwards /api/* to http://localhost:5137
const API_BASE = import.meta.env.VITE_API_BASE || "";

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
}: {
  recordingId: string;
  onStartEditing: () => void;
  onExitRoom: () => void;
}) {
  const [processing, setProcessing] = useState(true);
const [ready, setReady] = useState(false);
const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
const pollCountRef = useRef(0);
  const MAX_POLLS = 100; // Stop after 5 minutes (100 * 3 seconds)

  useEffect(() => {
  if (!recordingId) return;

  const pollStatus = async () => {
    // ✅ Safety limit: Stop after MAX_POLLS attempts
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
      const res = await fetch(`${API_BASE}/api/recordings/${recordingId}`);
      if (!res.ok) throw new Error("Failed to fetch recording status");

      const text = await res.text();
      if (!text) throw new Error("Empty response from server");

      const payload = JSON.parse(text);
      console.log("🔍 Full response:", payload);

      const status = payload?.data?.status ?? payload?.status ?? "PROCESSING";
      const downloadReady = !!payload?.data?.downloadReady;

      console.log("📊 Recording status:", status);
      console.log("📦 downloadReady:", downloadReady);
      console.log("📊 Current state - Processing:", processing, "Ready:", ready);

      // ✅ NEW SOURCE OF TRUTH: only unlock when downloadReady === true
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

      // Not ready yet — keep processing indicator on
      if (status === "RECORDING") {
        setProcessing(true);
      } else if (status === "STOP_REQUESTED" || status === "PROCESSING") {
        setProcessing(true);
      } else {
        // Unknown status, still keep it "processing" until downloadReady flips
        setProcessing(true);
      }
    } catch (err) {
      console.error("❌ Poll error:", err);
      setProcessing(true);
    }
  };

  // Run once immediately, then poll
  pollStatus();
  intervalRef.current = setInterval(pollStatus, 3000);

  return () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };
}, [API_BASE, recordingId]);


    
  // ✅ UPDATED download handler (this is the only change)
  const handleDownload = async () => {
    try {
      // 1️⃣ Ask backend for a one-time download link
      const res = await fetch(
        `${API_BASE}/api/recordings/${recordingId}/download-link`
      );

      if (!res.ok) {
        throw new Error("Failed to get download link");
      }

      const data = await res.json();

      if (!data?.success || !data?.data?.path) {
        throw new Error(data?.error || "Invalid download link response");
      }

      // 2️⃣ Open the real download URL (includes token)
      window.open(`${API_BASE}${data.data.path}`, "_blank");
    } catch (err) {
      console.error(err);
      alert("Failed to download recording.");
    }
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
    <div className="processing-text">Processing recording<span className="dots"></span></div>
    <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: '0.5rem' }}>
      This usually takes 1-2 minutes. The download button will activate when ready.
    </div>
  </div>
)}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <button
  onClick={onStartEditing}
  style={{
    width: '100%',
    padding: '1rem',
    background: 'linear-gradient(to right, #dc2626, #ef4444)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '0.5rem',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
  }}
  disabled={processing}
>
  ✂️ Start Editing
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
    background: ready ? "#16a34a" : "#374151",  // ✅ green vs gray
    color: "#fff",
  }}
>
  {ready ? "⬇️ Download Recording" : "⏳ Processing..."}
</button>




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
        </div>
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

export default function Room() {

    
    // Separate ref for stream egress id
    const streamEgressRef = useRef<string | null>(null);
  
  const nav = useNavigate();
  const { roomName } = useParams<{ roomName: string }>();
  const onExitRoom = () => nav("/dashboard");
  const onStartEditing = () => nav("/editor");

  

  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem("sl_displayName") ?? ""
  );
  const [pendingName, setPendingName] = useState(displayName);
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [showStreamSetup, setShowStreamSetup] = useState(false);
  const [egressId, setEgressId] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [showGoodbye, setShowGoodbye] = useState(false);
  // First person to join is the host (based on stored host ID for this room)
  const currentUserId = getOrCreateUid();
  const [isHost, setIsHost] = useState(false);
  const [userRole, setUserRole] = useState<string>("guest");
  const [debugInfo, setDebugInfo] = useState({ roomName: '', userId: '', isHost: false, role: '' });

  // Effect to determine host status based on room creation
  useEffect(() => {
    if (!roomName) return;
    
    // Check if user created this room (stored when they created it from /join)
    const createdRooms = JSON.parse(localStorage.getItem("sl_created_rooms") || "[]");
    const willBeHost = createdRooms.includes(roomName);
    setIsHost(willBeHost);

    // Get role from localStorage (set during join process)
    const currentRole = localStorage.getItem("sl_current_role") || "guest";
    setUserRole(currentRole);
    
    console.log('🏠 Host Check:', { roomName, createdRooms, isHost: willBeHost, role: currentRole });
    
    // Update debug info
    setDebugInfo({ 
      roomName: roomName || 'none', 
      userId: currentUserId.slice(-4) || 'none', 
      isHost: willBeHost,
      role: currentRole
    });
  }, [roomName, currentUserId]);

  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>("idle");
  const recordingRef = useRef<string | null>(null);
  const [viewerCount] = useState(Math.floor(Math.random() * 200) + 10);
  const [elapsedTime, setElapsedTime] = useState(0);
  const streamStartTimeRef = useRef<number | null>(null);
  const [didStreamThisSession, setDidStreamThisSession] = useState(false);
  const [showExitOptions, setShowExitOptions] = useState(false);

  useEffect(() => {
    if (!roomName || !displayName) return;

    const fetchToken = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/roomToken`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomName,
            identity: displayName,
            uid: getOrCreateUid(),
          }),
        });

        if (!res.ok) {
          console.error("roomToken HTTP error", res.status);
          return;
        }

        const data = await res.json();
        const tokenFromApi =
          data.token || data.accessToken || data.jwt || data.roomToken;
        const serverUrlFromApi =
          data.serverUrl || data.server_url || data.url || data.livekitUrl;

        if (tokenFromApi && serverUrlFromApi) {
          setToken(tokenFromApi);
          setServerUrl(serverUrlFromApi);
        }
      } catch (err) {
        console.error("fetchToken error:", err);
      }
    };

    fetchToken();
  }, [roomName, displayName]);

  // Timer effect - runs when stream goes live
  useEffect(() => {
    if (streamStatus === "live") {
      if (!streamStartTimeRef.current) {
        streamStartTimeRef.current = Date.now();
      }

      const interval = setInterval(() => {
        if (streamStartTimeRef.current) {
          const elapsed = Math.floor((Date.now() - streamStartTimeRef.current) / 1000);
          setElapsedTime(elapsed);
        }
      }, 1000);

      return () => clearInterval(interval);
    } else {
      // Reset when stream ends
      streamStartTimeRef.current = null;
      setElapsedTime(0);
    }
  }, [streamStatus]);

  const handleLeftRoom = () => {
    setShowGoodbye(true);
  };

  const handleHomeClick = () => {
    nav('/join', { replace: true });
  };

 async function apiStartRecording(roomName: string, layout: "speaker" | "grid" = "grid") {
  console.log("🔧 apiStartRecording called:", { roomName, layout });
  
  const res = await fetch(`${API_BASE}/api/recordings/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomName, layout }),
  });

  console.log("🔧 Response status:", res.status);

  // ✅ FIX: Read as text first (more reliable than res.json())
  const text = await res.text();
  console.log("🔧 Raw response:", text);

  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }

  // Now parse the text
  const json = JSON.parse(text);
  console.log("🔧 Parsed JSON:", json);
  
  return json;
}
  
  // UPDATED: Return the full response (bulletproof format)
  


async function apiStopRecording(recordingId: string) {
  console.log("🛑 apiStopRecording called:", { recordingId });
  
  const res = await fetch(`${API_BASE}/api/recordings/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recordingId }),
  });

  console.log("🛑 API response status:", res.status);

  if (!res.ok) {
    try {
      const errorData = await res.json();
      console.error("🛑 API error:", errorData);
      throw new Error(errorData.error || `HTTP ${res.status}`);
    } catch (parseError) {
      const text = await res.text();
      console.error("🛑 API error (text):", text);
      throw new Error(text || `HTTP ${res.status}`);
    }
  }

  const json = await res.json();
  console.log("🛑 API response JSON:", json);
  
  // UPDATED: Return the full response
  return json;
}

const startRecording = async (layout: "speaker" | "grid" = "grid") => {
  if (!roomName) {
    console.log("❌ No roomName, can't start recording");
    return;
  }
  if (recordingRef.current) {
    console.log("⏳ Recording already in progress, skipping startRecording call.");
    return;
  }

  console.log("🎬 startRecording called. roomName:", roomName, "layout:", layout);
  setRecordingStatus("recording");
  
  try {  // ✅ ADD THIS LINE if missing
    console.log("📡 Calling apiStartRecording...");
    const response = await apiStartRecording(roomName, layout);
    console.log("📡 Got response:", response);
    
    const { recordingId } = response.data;
    console.log("🎬 Extracted recordingId:", recordingId);
    
    if (!recordingId || recordingId === "unknown") {
      console.error("❌ Invalid recordingId:", recordingId);
      setRecordingStatus("error");
      return;
    }
    
    recordingRef.current = recordingId;
    setRecordingId(recordingId);
    streamStartTimeRef.current = Date.now();
    
    console.log("✅ Recording started!");
    console.log("   recordingRef.current:", recordingRef.current);
    console.log("   recordingId state:", recordingId);
  } catch (e) {  // ✅ Line 581
    console.error("❌ Failed to start recording:", e);
    setRecordingStatus("error");
        alert(`Failed to start recording: ${(e as Error).message || "Unknown error"}`);

  }
};

const stopRecording = async () => {
  console.log("🛑 stopRecording called");
  console.log("   recordingRef.current:", recordingRef.current);
  console.log("   recordingId state:", recordingId);
  
  const id = recordingRef.current;
  
  if (!id || id === "unknown") {
    console.error("❌ No valid recording ID to stop!");
    console.error("   recordingRef.current:", recordingRef.current);
    console.error("   This means recording never started properly");
    setRecordingStatus("error");
    return;
  }

  console.log("🛑 Stopping recording with ID:", id);
  setRecordingStatus("stopping");
  
  try {
    const response = await apiStopRecording(id);
    console.log("✅ Recording stopped successfully:", response);
    
    // UPDATED: Check for success
    if (!response.success) {
      throw new Error(response.error || "Stop recording failed");
    }
    
    setRecordingStatus("stopped");
    setRecordingId(id);  // Set this so modal can poll!

  } catch (e) {
    console.error("❌ Failed to stop recording:", e);
    setRecordingStatus("error");
        alert(`Failed to start recording: ${(e as Error).message || "Unknown error"}`);

  }
};

  useEffect(() => {
    if (isHost && token && !recordingRef.current) {
      // Recording now starts when stream goes live, not on join
    }
  }, [isHost, token]);

  const handleEndStream = async () => {
    // For hosts: if stream is still live, show message and wait
    if (isHost && streamStatus === "live") {
      alert("⏹️ Stream is still live. Stop the stream first.");
      return;
    }

    // For hosts: if recording is still active, show message and wait
    if (isHost && recordingStatus === "recording") {
      alert("⏹️ Recording is still active. Stop the stream first.");
      return;
    }

    // For hosts: show exit options menu
    if (isHost && didStreamThisSession) {
      setShowExitOptions(true);
      return;
    }

    // For hosts who never streamed - just show goodbye
    if (isHost) {
      console.log('👋 User never streamed - showing goodbye');
      setShowGoodbye(true);
      return;
    }

    // For guests: just leave the room with goodbye screen
    handleLeftRoom();
  };

  const handleStayAndRecord = () => {
    // Reset recording state for next stream
    setRecordingId(null);
    setRecordingStatus("idle");
    recordingRef.current = null;
    setShowExitOptions(false);
    // User stays in room, ready to click "Go Live" again
    console.log('🎬 Ready to record another session');
  };

  const handleViewSummary = () => {
    const finalRecordingId = recordingId || recordingRef.current;
    setShowExitOptions(false);
    
    if (finalRecordingId && finalRecordingId !== 'unknown') {
      nav('/thanks', { replace: true });
    } else {
      // Fallback to thanks page
      nav('/thanks', { replace: true });
    }
  };

  const handleLeaveRoom = () => {
    setShowExitOptions(false);
    handleLeftRoom();
  };

  const handleStartMultistream = async (keys: {
    youtubeKey?: string;
    facebookKey?: string;
    twitchKey?: string;
    record?: boolean;
    layout?: "speaker" | "grid";
  }) => {
    if (streamStatus === "starting" || streamStatus === "live") return;
    if (!roomName) {
      alert("No room name");
      return;
    }

    // Debug logging
    console.log("🎬 Room.tsx - handleStartMultistream called");
    console.log("   Room:", roomName);
    console.log("   Keys received:", {
      youtube: keys.youtubeKey ? "✓ provided" : "✗ empty",
      facebook: keys.facebookKey ? "✓ provided" : "✗ empty",
      twitch: keys.twitchKey ? "✓ provided" : "✗ empty",
      record: keys.record,
      layout: keys.layout,
    });

    // Validate at least one key
    if (!keys.youtubeKey && !keys.facebookKey && !keys.twitchKey) {
      alert("At least one stream key is required");
      return;
    }

    try {
      setStreamStatus("starting");

      const requestBody = {
        youtubeStreamKey: keys.youtubeKey,
        facebookStreamKey: keys.facebookKey,
        twitchStreamKey: keys.twitchKey,
        userId: getOrCreateUid(),
        guestCount: viewerCount,
      };

      console.log("   Sending to API:", requestBody);

      const res = await fetch(
        `${API_BASE}/api/rooms/${encodeURIComponent(roomName)}/start-multistream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        }
      );

      // Bulletproof: try to parse as JSON, fallback to text
      let data;
      try {
        data = await res.json();
      } catch (e) {
        const text = await res.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }

      // Log the full response for debugging
      console.log("🔍 startMultistream full response:", data);

      if (!res.ok) {
        console.error("Start multistream failed", data);
        alert(`Failed to start multistream: ${data.error || data.message || "Unknown error"}`);
        setStreamStatus("idle");
        return;
      }

      // Bulletproof egressId extraction
      const egressId =
        data?.data?.egressId ??
        data?.egressId ??
        data?.data?.id ??
        data?.id;

     
      streamEgressRef.current = egressId || null;
      setStreamStatus("live");
      streamStartTimeRef.current = Date.now();
      setDidStreamThisSession(true);
      // Start recording using passed-in values
      if (keys.record) {
        await startRecording(keys.layout ?? "grid");
      }
      console.log("✅ Stream started! Egress ID:", egressId);
    } catch (err) {
      console.error("Error starting multistream:", err);
      alert("Error starting multistream");
      setStreamStatus("idle");
    }
  };

  const handleStopMultistream = async () => {
    // Use streamEgressRef for stopping stream
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

      // ✅ DON'T stop recording - let user control that separately
      // Recording continues even after stream ends

      const res = await fetch(
        `${API_BASE}/api/rooms/${encodeURIComponent(roomName)}/stop-multistream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ egressId: streamEgressId }),
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
      
      // ✅ Show alert that recording is still active
      if (recordingStatus === "recording") {
        console.log("ℹ️ Stream stopped but recording still active");
      }
        
    } catch (err) {
      console.error("Error stopping multistream", err);
      alert("Error stopping multistream");
      setStreamStatus("live");
    }
  };

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
        {/* Animated Background Orbs */}
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
          <h1 style={{
            fontSize: '1.5rem',
            fontWeight: '600',
            textAlign: 'center',
            marginBottom: '0.5rem',
            color: '#ffffff'
          }}>
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
              background: !pendingName.trim() ? 'rgba(75, 85, 99, 0.5)' : 'linear-gradient(135deg, #dc2626, #ef4444)',
              color: '#ffffff',
              fontWeight: '600',
              border: 'none',
              cursor: !pendingName.trim() ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s ease',
              opacity: !pendingName.trim() ? 0.6 : 1
            }}
            onMouseEnter={(e) => {
              if (pendingName.trim()) {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'linear-gradient(135deg, #b91c1c, #dc2626)';
                target.style.boxShadow = '0 0 20px rgba(220, 38, 38, 0.4)';
              }
            }}
            onMouseLeave={(e) => {
              if (pendingName.trim()) {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'linear-gradient(135deg, #dc2626, #ef4444)';
                target.style.boxShadow = 'none';
              }
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

  // Exit Options Modal for hosts who streamed
  if (showExitOptions) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        backdropFilter: 'blur(5px)'
      }}>
        <div style={{
          background: 'linear-gradient(135deg, rgba(31, 41, 55, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%)',
          borderRadius: '1.5rem',
          padding: '2.5rem',
          width: '100%',
          maxWidth: '500px',
          border: '1px solid rgba(220, 38, 38, 0.3)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 25px 50px rgba(0, 0, 0, 0.5)'
        }}>
          <div style={{
            textAlign: 'center',
            marginBottom: '2rem'
          }}>
            <div style={{
              fontSize: '3rem',
              marginBottom: '1rem'
            }}>
              🎬
            </div>
            <h2 style={{
              fontSize: '1.75rem',
              fontWeight: '700',
              color: '#ffffff',
              marginBottom: '0.5rem',
              background: 'linear-gradient(to right, #ffffff, #fecaca)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              Recording Complete!
            </h2>
            <p style={{
              fontSize: '0.95rem',
              color: '#9ca3af',
              marginTop: '0.75rem'
            }}>
              What would you like to do next?
            </p>
          </div>

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}>
            {/* Stay & Record Another */}
            <button
              onClick={handleStayAndRecord}
              style={{
                padding: '1.25rem',
                background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(16, 185, 129, 0.1) 100%)',
                border: '2px solid rgba(34, 197, 94, 0.5)',
                borderRadius: '0.75rem',
                color: '#10b981',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                backdropFilter: 'blur(10px)',
                fontSize: '1rem',
                fontWeight: '600',
                textAlign: 'left'
              }}
              onMouseEnter={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.25) 0%, rgba(16, 185, 129, 0.2) 100%)';
                target.style.borderColor = 'rgba(34, 197, 94, 0.8)';
                target.style.boxShadow = '0 0 20px rgba(34, 197, 94, 0.3)';
              }}
              onMouseLeave={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(16, 185, 129, 0.1) 100%)';
                target.style.borderColor = 'rgba(34, 197, 94, 0.5)';
                target.style.boxShadow = 'none';
              }}
            >
              <div style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>🎯 Stay & Record Another</div>
              <div style={{ fontSize: '0.85rem', color: '#6ee7b7', opacity: 0.9 }}>
                Perfect for multiple episodes, series, or batch recording
              </div>
            </button>

            {/* View Summary & Edit */}
            <button
              onClick={handleViewSummary}
              style={{
                padding: '1.25rem',
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(37, 99, 235, 0.1) 100%)',
                border: '2px solid rgba(59, 130, 246, 0.5)',
                borderRadius: '0.75rem',
                color: '#3b82f6',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                backdropFilter: 'blur(10px)',
                fontSize: '1rem',
                fontWeight: '600',
                textAlign: 'left'
              }}
              onMouseEnter={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(37, 99, 235, 0.2) 100%)';
                target.style.borderColor = 'rgba(59, 130, 246, 0.8)';
                target.style.boxShadow = '0 0 20px rgba(59, 130, 246, 0.3)';
              }}
              onMouseLeave={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(37, 99, 235, 0.1) 100%)';
                target.style.borderColor = 'rgba(59, 130, 246, 0.5)';
                target.style.boxShadow = 'none';
              }}
            >
              <div style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>📊 View Summary & Edit</div>
              <div style={{ fontSize: '0.85rem', color: '#60a5fa', opacity: 0.9 }}>
                See stats and edit your recording in the timeline editor
              </div>
            </button>

            {/* Leave Room */}
            <button
              onClick={handleLeaveRoom}
              style={{
                padding: '1.25rem',
                background: 'rgba(107, 114, 128, 0.15)',
                border: '2px solid rgba(107, 114, 128, 0.5)',
                borderRadius: '0.75rem',
                color: '#d1d5db',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                backdropFilter: 'blur(10px)',
                fontSize: '1rem',
                fontWeight: '600',
                textAlign: 'left'
              }}
              onMouseEnter={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'rgba(107, 114, 128, 0.25)';
                target.style.borderColor = 'rgba(107, 114, 128, 0.8)';
                target.style.boxShadow = '0 0 20px rgba(107, 114, 128, 0.3)';
              }}
              onMouseLeave={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'rgba(107, 114, 128, 0.15)';
                target.style.borderColor = 'rgba(107, 114, 128, 0.5)';
                target.style.boxShadow = 'none';
              }}
            >
              <div style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>🚪 Leave Room</div>
              <div style={{ fontSize: '0.85rem', color: '#9ca3af', opacity: 0.9 }}>
                Exit without viewing summary or recording another
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
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

          {/* Invite Menu - only for hosts */}
          {isHost && (
            <button
              onClick={() => {
                const inviteUrl = `${window.location.origin}/join?room=${encodeURIComponent(roomName)}`;
                navigator.clipboard.writeText(inviteUrl);
                alert(`Invite link copied to clipboard!\n${inviteUrl}`);
              }}
              style={{
                fontSize: '0.75rem',
                padding: '0.5rem 0.75rem',
                border: '1px solid rgba(34, 197, 94, 0.4)',
                borderRadius: '0.375rem',
                background: 'rgba(34, 197, 94, 0.05)',
                color: '#22c55e',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                backdropFilter: 'blur(10px)',
                fontWeight: '500'
              }}
              onMouseEnter={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'rgba(34, 197, 94, 0.1)';
                target.style.borderColor = 'rgba(220, 38, 38, 0.6)';
              }}
              onMouseLeave={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'rgba(34, 197, 94, 0.05)';
                target.style.borderColor = 'rgba(34, 197, 94, 0.4)';
                target.style.boxShadow = 'none';
              }}
              title="Copy invite link to clipboard"
            >
              🔗 Invite
            </button>
          )}

          {/* Stream Timer - only show when streaming */}
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
                backdropFilter: 'blur(10px)',
                fontWeight: '500',
                fontFamily: 'monospace',
                animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
              }}
            >
              🔴 {`${Math.floor(elapsedTime / 60)}:${String(elapsedTime % 60).padStart(2, '0')}`}
            </div>
          )}
        </div>

        {isHost && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
              onClick={() => setDashboardOpen(true)}
              style={{
                fontSize: '0.75rem',
                padding: '0.5rem 0.75rem',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                borderRadius: '0.375rem',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                backdropFilter: 'blur(10px)'
              }}
              onMouseEnter={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'rgba(255, 255, 255, 0.1)';
                target.style.borderColor = 'rgba(220, 38, 38, 0.6)';
              }}
              onMouseLeave={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'rgba(255, 255, 255, 0.05)';
                target.style.borderColor = 'rgba(255, 255, 255, 0.4)';
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
              onClick={() => setShowStreamSetup(true)}
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
              onMouseEnter={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'linear-gradient(135deg, #b91c1c, #dc2626)';
                target.style.boxShadow = '0 0 15px rgba(220, 38, 38, 0.4)';
              }}
              onMouseLeave={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'linear-gradient(135deg, #dc2626, #ef4444)';
                target.style.boxShadow = 'none';
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
          className="sl-layout"
          token={token}
          serverUrl={serverUrl}
          connect={true}
          onDisconnected={handleLeftRoom}
          style={{
            width: "100%",
            height: "calc(100vh - 60px)",
            position: "relative",
          }}
        >
          <div style={{ width: "100%", height: "100%", position: "relative" }}>
            {isHost && <HostAVControls />}
            <VideoConference />
            {/* On-stream logo for hosts - visible to viewers */}
            {isHost && (
              <img
                src="/logo.png"
                alt="StreamLine"
                style={{
                  position: "absolute",
                  top: "20px",
                  right: "20px",
                  width: "120px",
                  height: "auto",
                  opacity: "0.75",
                  zIndex: 10,
                  pointerEvents: "none",
                }}
              />
            )}
          </div>

          <RoleOverlay
            open={dashboardOpen}
            onClose={() => setDashboardOpen(false)}
            role={isHost ? "host" : (userRole === "moderator" ? "moderator" : "participant")}
            roomName={roomName}
          />
        </LiveKitRoom>
      )}

      <StreamSetupModalV2
        open={showStreamSetup}
        onClose={() => setShowStreamSetup(false)}
        roomName={roomName ?? ""}
        streamStatus={streamStatus}
        onStartStream={handleStartMultistream}
        onStopStream={handleStopMultistream}
        recordingStatus={recordingStatus}
        onStartRecording={startRecording}
        onStopRecording={stopRecording}
      />

      {recordingStatus === "stopped" && recordingId && (
        <StreamEndedModal
          recordingId={recordingId}
          onStartEditing={() => nav('/edit', { replace: true })}
          onExitRoom={() => nav('/thanks', { replace: true })}

          
        />
      )} 

      <style>{`
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
  
  @keyframes dots {
    0%, 20% { content: '.'; }
    40% { content: '..'; }
    60%, 100% { content: '...'; }
  }
  
  .processing-text {
    display: inline-block;
  }
  
  .dots::after {
    content: '';
    animation: dots 1.5s steps(1) infinite;
  }
`}</style>
    </>
  );
}