import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  roomName: string;
  
  // Stream state
  streamStatus: "idle" | "starting" | "live" | "stopping";
  onStartStream: (params: {
    youtubeKey?: string;
    facebookKey?: string;
    twitchKey?: string;
  }) => Promise<void>;
  onStopStream: () => Promise<void>;
  
  // Recording state (independent from stream)
  recordingStatus: "idle" | "recording" | "stopping" | "stopped" | "error";
  onStartRecording: (layout: "speaker" | "grid") => Promise<void>;
  onStopRecording: () => Promise<void>;
}

export default function StreamSetupModalV2({
  open,
  onClose,
  roomName,
  streamStatus,
  onStartStream,
  onStopStream,
  recordingStatus,
  onStartRecording,
  onStopRecording,
}: Props) {
  const [useYouTube, setUseYouTube] = useState(false);
  const [useFacebook, setUseFacebook] = useState(false);
  const [useTwitch, setUseTwitch] = useState(false);

  const [youtubeKey, setYoutubeKey] = useState("");
  const [facebookKey, setFacebookKey] = useState("");
  const [twitchKey, setTwitchKey] = useState("");

  const [layout, setLayout] = useState<"speaker" | "grid">("speaker");

  if (!open) return null;

  const streamIsLive = streamStatus === "live";
  const streamIsBusy = streamStatus === "starting" || streamStatus === "stopping";
  
  const recordingIsActive = recordingStatus === "recording";
  const recordingIsBusy = recordingStatus === "stopping";

  const handleStartStream = async () => {
    const yt = useYouTube ? youtubeKey.trim() : "";
    const fb = useFacebook ? facebookKey.trim() : "";
    const tw = useTwitch ? twitchKey.trim() : "";

    if (!yt && !fb && !tw) {
      alert("Enter at least one stream key (YouTube, Facebook, or Twitch).");
      return;
    }

    await onStartStream({
      youtubeKey: yt || undefined,
      facebookKey: fb || undefined,
      twitchKey: tw || undefined,
    });
  };

  const handleStartRecording = async () => {
    if (!streamIsLive) {
      alert("Start streaming first before recording!");
      return;
    }
    await onStartRecording(layout);
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: '80px',
      right: '20px',
      zIndex: 50,
      pointerEvents: 'auto'
    }}>
      {/* Floating Menu Card */}
      <div style={{
        background: 'rgba(20, 20, 20, 0.98)',
        borderRadius: '0.75rem',
        border: '1px solid rgba(220, 38, 38, 0.5)',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 20px 60px rgba(220, 38, 38, 0.2)',
        width: '380px',
        maxHeight: '70vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: '#ffffff'
      }}>
        {/* Header */}
        <div style={{
          padding: '1rem',
          borderBottom: '2px solid rgba(220, 38, 38, 0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, rgba(220, 38, 38, 0.1), rgba(239, 68, 68, 0.05))'
        }}>
          <div>
            <div style={{ fontWeight: '700', fontSize: '0.95rem', color: '#ef4444', letterSpacing: '0.5px' }}>
              STREAM CONTROL
            </div>
            <div style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.5)', marginTop: '0.25rem' }}>
              Stream & Recording are independent
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={streamIsBusy || recordingIsBusy}
            style={{
              background: 'rgba(220, 38, 38, 0.2)',
              border: '1px solid rgba(220, 38, 38, 0.5)',
              borderRadius: '0.375rem',
              color: '#ef4444',
              padding: '0.4rem 0.6rem',
              cursor: (streamIsBusy || recordingIsBusy) ? 'not-allowed' : 'pointer',
              fontSize: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              transition: 'all 0.3s ease',
              fontWeight: 'bold',
              opacity: (streamIsBusy || recordingIsBusy) ? 0.5 : 1
            }}
          >
            ×
          </button>
        </div>

        {/* Content - Scrollable */}
        <div style={{
          padding: '1rem',
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          
          {/* SECTION 1: STREAM PLATFORMS */}
          <div style={{
            background: 'rgba(59, 130, 246, 0.05)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
            borderRadius: '0.5rem',
            padding: '0.75rem'
          }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#3b82f6', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
              📡 Stream Destinations
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {/* YouTube */}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={useYouTube}
                  onChange={() => setUseYouTube(v => !v)}
                  disabled={streamIsLive}
                  style={{ marginTop: '0.25rem', cursor: streamIsLive ? 'not-allowed' : 'pointer', accentColor: '#ef4444' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>YouTube Live</div>
                  <input
                    type="text"
                    value={youtubeKey}
                    onChange={(e) => setYoutubeKey(e.target.value)}
                    placeholder="Stream Key"
                    disabled={!useYouTube || streamIsLive}
                    style={{
                      width: '100%',
                      padding: '0.4rem 0.5rem',
                      background: 'rgba(31, 41, 55, 0.7)',
                      border: '1px solid rgba(75, 85, 99, 0.5)',
                      borderRadius: '0.25rem',
                      color: '#ffffff',
                      fontSize: '0.75rem',
                      outline: 'none',
                      opacity: (!useYouTube || streamIsLive) ? 0.5 : 1,
                      cursor: (!useYouTube || streamIsLive) ? 'not-allowed' : 'text'
                    }}
                  />
                </div>
              </label>

              {/* Facebook */}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={useFacebook}
                  onChange={() => setUseFacebook(v => !v)}
                  disabled={streamIsLive}
                  style={{ marginTop: '0.25rem', cursor: streamIsLive ? 'not-allowed' : 'pointer', accentColor: '#ef4444' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>Facebook Live</div>
                  <input
                    type="text"
                    value={facebookKey}
                    onChange={(e) => setFacebookKey(e.target.value)}
                    placeholder="Stream Key"
                    disabled={!useFacebook || streamIsLive}
                    style={{
                      width: '100%',
                      padding: '0.4rem 0.5rem',
                      background: 'rgba(31, 41, 55, 0.7)',
                      border: '1px solid rgba(75, 85, 99, 0.5)',
                      borderRadius: '0.25rem',
                      color: '#ffffff',
                      fontSize: '0.75rem',
                      outline: 'none',
                      opacity: (!useFacebook || streamIsLive) ? 0.5 : 1,
                      cursor: (!useFacebook || streamIsLive) ? 'not-allowed' : 'text'
                    }}
                  />
                </div>
              </label>

              {/* Twitch */}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={useTwitch}
                  onChange={() => setUseTwitch(v => !v)}
                  disabled={streamIsLive}
                  style={{ marginTop: '0.25rem', cursor: streamIsLive ? 'not-allowed' : 'pointer', accentColor: '#ef4444' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>Twitch</div>
                  <input
                    type="text"
                    value={twitchKey}
                    onChange={(e) => setTwitchKey(e.target.value)}
                    placeholder="Stream Key"
                    disabled={!useTwitch || streamIsLive}
                    style={{
                      width: '100%',
                      padding: '0.4rem 0.5rem',
                      background: 'rgba(31, 41, 55, 0.7)',
                      border: '1px solid rgba(75, 85, 99, 0.5)',
                      borderRadius: '0.25rem',
                      color: '#ffffff',
                      fontSize: '0.75rem',
                      outline: 'none',
                      opacity: (!useTwitch || streamIsLive) ? 0.5 : 1,
                      cursor: (!useTwitch || streamIsLive) ? 'not-allowed' : 'text'
                    }}
                  />
                </div>
              </label>
            </div>

            {/* Stream Control Button */}
            <div style={{ marginTop: '0.75rem' }}>
              {(streamStatus === "idle" || streamStatus === "starting") ? (
                <button
                  onClick={handleStartStream}
                  disabled={streamIsBusy}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    borderRadius: '0.5rem',
                    background: streamIsBusy ? 'rgba(59, 130, 246, 0.5)' : 'linear-gradient(135deg, #22c55e, #16a34a)',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: '600',
                    cursor: streamIsBusy ? 'not-allowed' : 'pointer',
                    transition: 'all 0.3s ease',
                  }}
                >
                  {streamStatus === "starting" ? "🔄 Starting Stream..." : "📡 Start Stream"}
                </button>
              ) : (
                <button
                  onClick={onStopStream}
                  disabled={streamIsBusy}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    borderRadius: '0.5rem',
                    background: streamIsBusy ? 'rgba(239, 68, 68, 0.5)' : 'linear-gradient(135deg, #dc2626, #b91c1c)',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: '600',
                    cursor: streamIsBusy ? 'not-allowed' : 'pointer',
                    transition: 'all 0.3s ease',
                  }}
                >
                  {streamStatus === "stopping" ? "🔄 Stopping Stream..." : "⏹️ Stop Stream"}
                </button>
              )}
            </div>
          </div>

          {/* SECTION 2: RECORDING CONTROL */}
          <div style={{
            background: 'rgba(220, 38, 38, 0.05)',
            border: '1px solid rgba(220, 38, 38, 0.2)',
            borderRadius: '0.5rem',
            padding: '0.75rem'
          }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#ef4444', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
              🎬 Recording Control
            </div>

            {/* Layout Selector */}
            <label style={{ fontSize: '0.875rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontWeight: 600 }}>Layout:</span>
              <select
                value={layout}
                onChange={e => setLayout(e.target.value as "speaker" | "grid")}
                disabled={recordingIsActive || !streamIsLive}
                style={{
                  padding: '0.4rem 0.7rem',
                  borderRadius: '0.3rem',
                  border: '1px solid #ef4444',
                  background: '#18181b',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  outline: 'none',
                  cursor: (recordingIsActive || !streamIsLive) ? 'not-allowed' : 'pointer',
                  opacity: (recordingIsActive || !streamIsLive) ? 0.5 : 1
                }}
              >
                <option value="speaker">Speaker</option>
                <option value="grid">Grid</option>
              </select>
            </label>

            {/* Status */}
            {!streamIsLive && (
              <div style={{ 
                fontSize: '0.75rem', 
                color: 'rgba(255, 255, 255, 0.5)', 
                marginBottom: '0.75rem',
                fontStyle: 'italic'
              }}>
                ⚠️ Start stream first to enable recording
              </div>
            )}

            {recordingStatus === "error" && (
              <div style={{ 
                fontSize: '0.75rem', 
                color: '#ef4444', 
                marginBottom: '0.75rem',
                padding: '0.5rem',
                background: 'rgba(220, 38, 38, 0.1)',
                borderRadius: '0.25rem'
              }}>
                ❌ Recording failed to start. Check server logs.
              </div>
            )}

            {/* Recording Control Button */}
            {!recordingIsActive ? (
              <button
                onClick={handleStartRecording}
                disabled={!streamIsLive || recordingIsBusy}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  fontSize: '0.875rem',
                  borderRadius: '0.5rem',
                  background: (!streamIsLive || recordingIsBusy) ? 'rgba(220, 38, 38, 0.3)' : 'linear-gradient(135deg, #dc2626, #b91c1c)',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: '600',
                  cursor: (!streamIsLive || recordingIsBusy) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.3s ease',
                  opacity: (!streamIsLive || recordingIsBusy) ? 0.6 : 1
                }}
              >
                🎬 Start Recording
              </button>
            ) : (
              <button
                onClick={onStopRecording}
                disabled={recordingIsBusy}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  fontSize: '0.875rem',
                  borderRadius: '0.5rem',
                  background: recordingIsBusy ? 'rgba(220, 38, 38, 0.5)' : 'linear-gradient(135deg, #7c2d12, #991b1b)',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: '600',
                  cursor: recordingIsBusy ? 'not-allowed' : 'pointer',
                  transition: 'all 0.3s ease',
                }}
              >
                {recordingIsBusy ? "🔄 Stopping Recording..." : "⏹️ Stop Recording"}
              </button>
            )}

            {recordingIsActive && (
              <div style={{
                marginTop: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.75rem',
                color: '#ef4444'
              }}>
                <div style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#ef4444',
                  animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                }} />
                <span>Recording in progress...</span>
              </div>
            )}
          </div>

          {/* Help Text */}
          <div style={{ 
            fontSize: '0.7rem', 
            color: 'rgba(255, 255, 255, 0.4)', 
            lineHeight: 1.4,
            fontStyle: 'italic'
          }}>
            💡 Tip: You can stream without recording, or record without streaming to platforms. They're independent!
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
    </div>
  );
}