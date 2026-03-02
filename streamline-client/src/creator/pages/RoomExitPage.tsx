import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { apiFetchAuth } from "../../lib/api";
import { editingApi } from "../../lib/editingApi";
import { useEffectiveEntitlements } from "../../hooks/useEffectiveEntitlements";
import { useFeatureAccess } from "../../hooks/useFeatureAccess";
// downloadService no longer used for direct downloads; we rely on signed links

/**
 * STREAMLINE ROOM EXIT PAGE - REDESIGNED
 * Glassmorphism black/red/white theme
 * Shows different content for host vs guest
 */

export default function RoomExitPage() {
  const nav = useNavigate();
  const location = useLocation();
  const { recordingId } = useParams<{ recordingId: string }>();
  const { effectiveEntitlements } = useEffectiveEntitlements();
  const { access } = useFeatureAccess(effectiveEntitlements);
  const canMyContentRecordings = !!access?.myContentRecordings?.allowed;
  const [recording, setRecording] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [sessionDuration, setSessionDuration] = useState<number>(0);
  
  const exitRole = (location.state as any)?.exitRole as "guest" | "host" | undefined;
  const hasRecording = !!recordingId && recordingId !== "unknown";
  const isHost = exitRole === "host" || hasRecording;

  // Guests should be done-done: no navigation back into the app.
  useEffect(() => {
    if (isHost) return;

    const pushState = () => {
      try {
        window.history.pushState(null, "", window.location.href);
      } catch {
        // no-op
      }
    };

    pushState();
    const onPopState = () => pushState();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [isHost]);

  const handleDownload = async () => {
    if (!hasRecording) {
      alert("Recording not ready for download");
      return;
    }

    setDownloading(true);

    try {
      const res = await apiFetchAuth(`/api/recordings/${recordingId}/download-link`, {}, { allowNonOk: true });
      if (res.status === 410) {
        alert("This recording link expired. Use Settings → Usage → Latest video to generate a fresh 1-hour link.");
        setDownloading(false);
        return;
      }
      if (res.status === 402) {
        alert("Upgrade required to download this recording.");
        setDownloading(false);
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

      setDownloading(false);
    } catch (error) {
      console.error("Download failed:", error);
      setDownloading(false);
      alert(`Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleConfirmYes = async () => {
    try {
      await apiFetchAuth(`/api/recordings/${recordingId}/download-link?confirm=true`, {}, { allowNonOk: true });
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
        `/api/recordings/${recordingId}/report-download-issue`,
        {
          method: "POST",
          body: JSON.stringify({ reason: "user_reported_issue" }),
        },
        { allowNonOk: true }
      );
    } catch {}
    setConfirmMessage("Use Settings → Usage → Latest video if you're having trouble.");
    setShowConfirmModal(false);
  };

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const fetchRecording = async () => {
      if (!recordingId || recordingId === "unknown") {
        setRecording(null);
        return;
      }

      try {
        const rec = await editingApi.getRecording(recordingId);
        if (!cancelled) setRecording(rec);

        const status = String((rec as any)?.status ?? "").toLowerCase();
        const downloadReady = (rec as any)?.downloadReady === true || status === "ready";

        if (downloadReady && interval) {
          clearInterval(interval);
          interval = null;
        }
      } catch (error) {
        console.error("Failed to fetch recording:", error);
        if (!cancelled) setRecording(null);
      }
    };

    // Calculate session duration from sessionStart stored in localStorage
    try {
      const sessionStartStr = localStorage.getItem("sl_sessionStart");
      if (sessionStartStr) {
        const sessionStart = parseInt(sessionStartStr, 10);
        const sessionEnd = Date.now();
        const duration = Math.floor((sessionEnd - sessionStart) / 1000);
        setSessionDuration(duration);
      }
    } catch {
      // ignore
    }

    (async () => {
      await fetchRecording();
      if (!cancelled) setLoading(false);

      // If not ready yet, keep polling so the exit page updates automatically.
      interval = setInterval(() => {
        void fetchRecording();
      }, 3000);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [recordingId]);

  if (loading) {
    return (
      <div 
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000000',
          color: '#ffffff'
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div 
            style={{
              width: '48px',
              height: '48px',
              border: '4px solid rgba(220, 38, 38, 0.3)',
              borderTop: '4px solid #ef4444',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px'
            }}
          />
          <p style={{ color: '#9ca3af' }}>Loading...</p>
        </div>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // GUEST VIEW
  if (!isHost) {
    return (
      <div 
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000000',
          color: '#ffffff',
          padding: '24px',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        
        {/* ANIMATED BACKGROUND */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          <div 
            style={{
              position: 'absolute',
              top: '20%',
              left: '20%',
              width: '500px',
              height: '500px',
              background: 'rgba(220, 38, 38, 0.15)',
              borderRadius: '50%',
              filter: 'blur(120px)',
              animation: 'pulse 4s ease-in-out infinite'
            }}
          />
          <div 
            style={{
              position: 'absolute',
              bottom: '20%',
              right: '20%',
              width: '600px',
              height: '600px',
              background: 'rgba(239, 68, 68, 0.1)',
              borderRadius: '50%',
              filter: 'blur(150px)',
              animation: 'pulse 4s ease-in-out infinite',
              animationDelay: '2s'
            }}
          />
        </div>

        {/* CONTENT */}
        <div style={{ position: 'relative', zIndex: 10, textAlign: 'center', maxWidth: '480px' }}>
          
          {/* Icon */}
          <div 
            style={{
              width: '80px',
              height: '80px',
              background: 'rgba(34, 197, 94, 0.2)',
              border: '2px solid rgba(34, 197, 94, 0.4)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '40px',
              margin: '0 auto 32px'
            }}
          >
            👋
          </div>

          <h1 
            style={{
              fontSize: '36px',
              fontWeight: 700,
              marginBottom: '16px',
              background: 'linear-gradient(to right, #ffffff, #fecaca, #ffffff)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}
          >
            Thanks for joining!
          </h1>
          
          <p style={{ fontSize: '16px', color: '#9ca3af', marginBottom: '0px', lineHeight: '1.6' }}>
            The stream has ended. You can now close this tab.
          </p>
        </div>

        {/* CSS ANIMATIONS */}
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 0.15; transform: scale(1); }
            50% { opacity: 0.25; transform: scale(1.05); }
          }
        `}</style>
      </div>
    );
  }

  // HOST VIEW
  return (
    <div 
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000000',
        color: '#ffffff',
        padding: '40px 24px',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      
      {/* ANIMATED BACKGROUND */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <div 
          style={{
            position: 'absolute',
            top: '15%',
            left: '10%',
            width: '600px',
            height: '600px',
            background: 'rgba(220, 38, 38, 0.15)',
            borderRadius: '50%',
            filter: 'blur(120px)',
            animation: 'pulse 4s ease-in-out infinite'
          }}
        />
        <div 
          style={{
            position: 'absolute',
            bottom: '15%',
            right: '10%',
            width: '700px',
            height: '700px',
            background: 'rgba(239, 68, 68, 0.1)',
            borderRadius: '50%',
            filter: 'blur(150px)',
            animation: 'pulse 4s ease-in-out infinite',
            animationDelay: '2s'
          }}
        />
      </div>

      {/* CONTENT */}
      <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: '520px' }}>
        
        {/* Success Icon */}
        <div 
          style={{
            width: '80px',
            height: '80px',
            background: 'rgba(34, 197, 94, 0.2)',
            border: '2px solid rgba(34, 197, 94, 0.4)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '40px',
            margin: '0 auto 32px'
          }}
        >
          ✅
        </div>

        {/* RECORDING INFO CARD */}
        <div
          style={{
            background: 'rgba(15, 15, 15, 0.7)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '20px',
            padding: '32px',
            marginBottom: '24px'
          }}
        >
          <h1 
            style={{
              fontSize: '28px',
              fontWeight: 700,
              marginBottom: '12px',
              background: 'linear-gradient(to right, #ffffff, #fecaca)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}
          >
            Stream Ended
          </h1>
          <p style={{ fontSize: '15px', color: '#9ca3af', marginBottom: '24px', lineHeight: '1.6' }}>
            {canMyContentRecordings
              ? 'Your recording is being processed. It will appear in My Content when ready.'
              : 'Your recording is being processed. The download button will activate when ready.'}
          </p>

          {recording && (
            <div 
              style={{
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '16px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: '#6b7280' }}>Title:</span>
                <span style={{ fontSize: '13px', color: '#ffffff', fontWeight: 500 }}>
                  {recording.title}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: '#6b7280' }}>Duration:</span>
                <span style={{ fontSize: '13px', color: '#ffffff', fontWeight: 500 }}>
                  {Math.round(recording.duration / 60)}m
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: '#6b7280' }}>Status:</span>
                <span 
                  style={{
                    fontSize: '13px',
                    color: '#22c55e',
                    fontWeight: 600,
                    textTransform: 'capitalize'
                  }}
                >
                  {recording.status}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px', color: '#6b7280' }}>Room Duration:</span>
                <span style={{ fontSize: '13px', color: '#ffffff', fontWeight: 500 }}>
                  {Math.floor(sessionDuration / 60)}m {sessionDuration % 60}s
                </span>
              </div>
              {recording.progress !== undefined && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '13px', color: '#6b7280' }}>Progress:</span>
                  <span style={{ fontSize: '13px', color: '#ffffff', fontWeight: 500 }}>
                    {recording.progress}%
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ACTION BUTTONS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* View in My Content */}
          {canMyContentRecordings && (
            <button
              onClick={() => nav('/content')}
              style={{
                width: '100%',
                padding: '16px 24px',
                background: 'rgba(34, 197, 94, 0.18)',
                border: '1px solid rgba(34, 197, 94, 0.35)',
                color: '#ffffff',
                borderRadius: '12px',
                fontSize: '16px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.3s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(34, 197, 94, 0.28)';
                e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.55)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(34, 197, 94, 0.18)';
                e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.35)';
              }}
            >
              📁 View in My Content
            </button>
          )}

          {/* Download (only when a real recording exists) */}
          {recordingId !== 'unknown' && hasRecording && (
            <button
              onClick={handleDownload}
              disabled={downloading || !recording || recording.status !== 'ready'}
              style={{
                width: '100%',
                padding: '16px 24px',
                background: downloading ? 'rgba(107, 114, 128, 0.3)' : 'rgba(220, 38, 38, 0.2)',
                border: downloading ? '1px solid rgba(107, 114, 128, 0.4)' : '1px solid rgba(220, 38, 38, 0.4)',
                color: downloading ? '#6b7280' : '#ffffff',
                borderRadius: '12px',
                fontSize: '16px',
                fontWeight: 600,
                cursor: downloading ? 'not-allowed' : 'pointer',
                transition: 'all 0.3s ease',
                opacity: downloading ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                if (!downloading && (!recording || recording.status === 'ready')) {
                  e.currentTarget.style.background = 'rgba(220, 38, 38, 0.3)';
                  e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.6)';
                }
              }}
              onMouseLeave={(e) => {
                if (!downloading) {
                  e.currentTarget.style.background = 'rgba(220, 38, 38, 0.2)';
                  e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.4)';
                }
              }}
            >
              <div style={{ marginBottom: downloading ? '0' : '4px' }}>
                {downloading ? '⬇️ Downloading…' : '⬇️ Download recording'}
              </div>
              {!downloading && (
                <div style={{ fontSize: '11px', color: '#fca5a5' }}>
                  Download links expire in 1 hour. Generate a fresh link in Settings → Usage → Latest video.
                </div>
              )}
            </button>
          )}

              {showConfirmModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}>
                  <div style={{ background: '#111', border: '1px solid #333', borderRadius: 12, padding: 20, width: 320 }}>
                    <h4 style={{ margin: 0, marginBottom: 10, color: '#fff' }}>Did your download start?</h4>
                    <p style={{ margin: 0, marginBottom: 16, color: '#d1d5db', fontSize: 14 }}>If not, try Settings → Usage → Latest video.</p>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={handleConfirmNo} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #444', background: '#1f2937', color: '#fff', cursor: 'pointer' }}>No</button>
                      <button onClick={handleConfirmYes} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#dc2626,#ef4444)', color: '#fff', cursor: 'pointer' }}>Yes</button>
                    </div>
                  </div>
                </div>
              )}
              {confirmMessage && (
                <div style={{ color: '#d1d5db', fontSize: 13 }}>{confirmMessage}</div>
              )}

          {/* Back to Join */}
          <button
            onClick={() => nav("/join")}
            style={{
              width: '100%',
              padding: '14px 24px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#9ca3af',
              borderRadius: '12px',
              fontSize: '15px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.color = '#9ca3af';
            }}
          >
            Back to Join
          </button>
        </div>
      </div>

      {/* DOWNLOAD PROGRESS MODAL */}
      {downloading && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: 'rgba(15, 15, 15, 0.95)',
              border: '1px solid rgba(220, 38, 38, 0.3)',
              borderRadius: '20px',
              padding: '40px',
              maxWidth: '400px',
              width: '90%',
              backdropFilter: 'blur(20px)',
              textAlign: 'center',
            }}
          >
            <h2
              style={{
                fontSize: '24px',
                fontWeight: 700,
                marginBottom: '8px',
                color: '#ffffff',
              }}
            >
              Preparing download…
            </h2>
            <p style={{ color: '#9ca3af', marginBottom: '8px', fontSize: '14px' }}>
              Your recording is being prepared.
            </p>
            <p style={{ color: '#6b7280', fontSize: '12px' }}>
              Keep this tab open until the download starts.
            </p>
          </div>
        </div>
      )}

      {/* CSS ANIMATIONS */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 0.25; transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}
