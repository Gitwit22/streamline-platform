import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRecordingProgress } from '../hooks/useRecordingProgress';
import { editingApi } from '../lib/editingApi';

/**
 * STREAMLINE STREAM SUMMARY PAGE - REDESIGNED
 * Glassmorphism black/red/white theme
 * Shows recording status and action buttons
 */

export default function StreamSummaryPage() {
  const { recordingId } = useParams<{ recordingId: string }>();
  const nav = useNavigate();
  const { recording, loading } = useRecordingProgress(recordingId);
  const [showMetadataEditor, setShowMetadataEditor] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPrivacy, setEditPrivacy] = useState('public');

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
          <p style={{ color: '#9ca3af' }}>Loading summary...</p>
        </div>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (!recording) {
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
          <p style={{ color: '#ef4444', marginBottom: '16px', fontSize: '16px' }}>
            ❌ Recording not found
          </p>
          <button
            onClick={() => nav('/join')}
            style={{
              padding: '12px 24px',
              background: 'linear-gradient(to right, #dc2626, #ef4444)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const handleOpenMetadataEditor = () => {
    setEditTitle(recording.title);
    setEditDescription((recording as any).description || '');
    setEditPrivacy((recording as any).privacy || 'public');
    setShowMetadataEditor(true);
  };

  const handleSaveMetadata = () => {
    const updatedRecording = {
      ...recording,
      title: editTitle,
      description: editDescription,
      privacy: editPrivacy,
    };

    const recordings = JSON.parse(localStorage.getItem('sl_recordings') || '[]');
    const idx = recordings.findIndex((r: any) => r.id === recording.id);
    if (idx !== -1) {
      recordings[idx] = updatedRecording;
      localStorage.setItem('sl_recordings', JSON.stringify(recordings));
    }

    setShowMetadataEditor(false);
    window.location.reload();
  };

  const statusConfig = {
    recording: {
      label: '🔴 Recording',
      color: '#ef4444',
      bgColor: 'rgba(239, 68, 68, 0.2)',
      borderColor: 'rgba(239, 68, 68, 0.4)',
      animate: true,
    },
    processing: {
      label: '⏳ Processing',
      color: '#eab308',
      bgColor: 'rgba(234, 179, 8, 0.2)',
      borderColor: 'rgba(234, 179, 8, 0.4)',
      animate: true,
    },
    ready: {
      label: '✅ Ready!',
      color: '#22c55e',
      bgColor: 'rgba(34, 197, 94, 0.2)',
      borderColor: 'rgba(34, 197, 94, 0.4)',
      animate: false,
    },
    failed: {
      label: '❌ Failed',
      color: '#ef4444',
      bgColor: 'rgba(239, 68, 68, 0.2)',
      borderColor: 'rgba(239, 68, 68, 0.4)',
      animate: false,
    },
  };

  const config = statusConfig[recording.status];
  const mins = Math.floor(recording.duration / 60);
  const secs = recording.duration % 60;

  return (
    <div 
      style={{
        minHeight: '100vh',
        backgroundColor: '#000000',
        color: '#ffffff',
        padding: '24px',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      
      {/* ANIMATED BACKGROUND */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
        <div 
          style={{
            position: 'absolute',
            top: '10%',
            left: '10%',
            width: '600px',
            height: '600px',
            background: 'rgba(220, 38, 38, 0.1)',
            borderRadius: '50%',
            filter: 'blur(140px)',
            animation: 'pulse 5s ease-in-out infinite'
          }}
        />
        <div 
          style={{
            position: 'absolute',
            bottom: '10%',
            right: '10%',
            width: '700px',
            height: '700px',
            background: 'rgba(239, 68, 68, 0.08)',
            borderRadius: '50%',
            filter: 'blur(160px)',
            animation: 'pulse 5s ease-in-out infinite',
            animationDelay: '2.5s'
          }}
        />
      </div>

      {/* CONTENT */}
      <div style={{ position: 'relative', zIndex: 10, maxWidth: '1000px', margin: '0 auto' }}>
        
        {/* BACK BUTTON */}
        <button
          onClick={() => nav('/dashboard')}
          style={{
            marginBottom: '32px',
            padding: '10px 20px',
            background: 'rgba(220, 38, 38, 0.2)',
            border: '1px solid rgba(220, 38, 38, 0.4)',
            borderRadius: '10px',
            color: '#ef4444',
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.3s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(220, 38, 38, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(220, 38, 38, 0.2)';
          }}
        >
          ← Back to Dashboard
        </button>

        {/* TITLE */}
        <div style={{ marginBottom: '32px' }}>
          <h1 
            style={{
              fontSize: '36px',
              fontWeight: 700,
              marginBottom: '8px',
              background: 'linear-gradient(to right, #ffffff, #fecaca)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}
          >
            {recording.title}
          </h1>
          <p style={{ color: '#6b7280', fontSize: '14px' }}>
            {new Date(recording.createdAt).toLocaleString()}
          </p>
        </div>

        {/* RECORDING STATUS CARD */}
        <div
          style={{
            background: 'rgba(15, 15, 15, 0.7)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '20px',
            padding: '32px',
            marginBottom: '32px'
          }}
        >
          <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '24px' }}>
            🎬 Recording Status
          </h2>

          <div style={{ display: 'flex', alignItems: 'start', gap: '24px', marginBottom: '24px' }}>
            
            {/* Status Icon */}
            <div 
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: config.bgColor,
                border: `2px solid ${config.borderColor}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '32px',
                flexShrink: 0,
                animation: config.animate ? 'spin 2s linear infinite' : 'none'
              }}
            >
              {recording.status === 'processing' ? '⏳' : recording.status === 'ready' ? '✅' : recording.status === 'failed' ? '❌' : '🔴'}
            </div>

            {/* Status Info */}
            <div style={{ flex: 1 }}>
              <p 
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  marginBottom: '8px',
                  color: config.color
                }}
              >
                {config.label}
              </p>

              {/* Processing Progress Bar */}
              {recording.status === 'processing' && (
                <div style={{ marginTop: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <p style={{ fontSize: '13px', color: '#9ca3af' }}>Encoding video...</p>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#eab308' }}>
                      {recording.progress}%
                    </span>
                  </div>
                  <div 
                    style={{
                      width: '100%',
                      height: '8px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      borderRadius: '4px',
                      overflow: 'hidden',
                      border: '1px solid rgba(255, 255, 255, 0.05)'
                    }}
                  >
                    <div 
                      style={{
                        height: '100%',
                        width: `${recording.progress}%`,
                        background: 'linear-gradient(to right, #eab308, #fbbf24)',
                        borderRadius: '4px',
                        transition: 'width 0.3s ease'
                      }}
                    />
                  </div>
                  <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
                    This usually takes 3-5 minutes for longer videos
                  </p>
                </div>
              )}

              {/* Error Message */}
              {recording.status === 'failed' && (
                <div 
                  style={{
                    marginTop: '16px',
                    padding: '12px',
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px'
                  }}
                >
                  <p style={{ fontSize: '13px', color: '#fca5a5' }}>{recording.error}</p>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons - Show when ready */}
          {recording.status === 'ready' && (
            <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '24px' }}>
              <div 
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '16px',
                  padding: '12px',
                  background: 'rgba(34, 197, 94, 0.1)',
                  borderRadius: '10px'
                }}
              >
                <div 
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    background: '#22c55e',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px'
                  }}
                >
                  ✓
                </div>
                <p style={{ fontSize: '14px', color: '#86efac', fontWeight: 500 }}>
                  Your recording is ready to edit!
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                
                <button
                  onClick={() => nav(`/editing/assets?newRecording=${recording.id}`)}
                  style={{
                    width: '100%',
                    padding: '16px 24px',
                    background: 'linear-gradient(to right, #dc2626, #ef4444)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '12px',
                    fontSize: '16px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 8px 32px rgba(220, 38, 38, 0.3)',
                    transition: 'all 0.3s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(to right, #ef4444, #f87171)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(to right, #dc2626, #ef4444)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  ✂️ Edit in StreamLine
                </button>

                <button
                  onClick={handleOpenMetadataEditor}
                  style={{
                    width: '100%',
                    padding: '14px 24px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(220, 38, 38, 0.3)',
                    color: '#ffffff',
                    borderRadius: '12px',
                    fontSize: '15px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.3s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(220, 38, 38, 0.1)';
                    e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.5)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                    e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.3)';
                  }}
                >
                  ✏️ Edit Details
                </button>

                <button
                  onClick={() => nav('/editing/assets')}
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
                  📚 View Asset Library
                </button>

                <a
                  href={recording.videoUrl}
                  download={`${recording.title}.mp4`}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '14px 24px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#9ca3af',
                    borderRadius: '12px',
                    fontSize: '15px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    textAlign: 'center',
                    textDecoration: 'none',
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
                  📥 Download MP4
                </a>
              </div>
            </div>
          )}
        </div>

        {/* STATS GRID */}
        <div 
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
            marginBottom: '32px'
          }}
        >
          <StatCard label="Duration" value={`${mins}m ${secs}s`} icon="⏱️" />
          <StatCard label="Viewers" value={recording.viewerCount.toString()} icon="👥" />
          <StatCard label="Peak Viewers" value={recording.peakViewers.toString()} icon="📈" />
          <StatCard label="Status" value={config.label} icon="🎬" />
        </div>

        {/* RECORDING DETAILS */}
        <div
          style={{
            background: 'rgba(15, 15, 15, 0.7)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '20px',
            padding: '24px'
          }}
        >
          <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px' }}>
            📋 Recording Details
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px' }}>
            <DetailRow label="Recording ID" value={recording.id} copyable />
            <DetailRow label="Room" value={recording.roomName} />
            <DetailRow label="Created" value={new Date(recording.createdAt).toLocaleString()} />
            <DetailRow label="Video URL" value={recording.videoUrl} copyable />
          </div>
        </div>

        {/* METADATA EDITOR MODAL */}
        {showMetadataEditor && (
          <div 
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.7)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50,
              padding: '24px'
            }}
            onClick={() => setShowMetadataEditor(false)}
          >
            <div 
              style={{
                background: 'rgba(15, 15, 15, 0.95)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '20px',
                maxWidth: '480px',
                width: '100%',
                padding: '32px'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '24px' }}>
                Edit Recording Details
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '8px' }}>
                    Title
                  </label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '10px',
                      color: '#ffffff',
                      fontSize: '14px',
                      outline: 'none'
                    }}
                    placeholder="Recording title"
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '8px' }}>
                    Description
                  </label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '10px',
                      color: '#ffffff',
                      fontSize: '14px',
                      outline: 'none',
                      height: '96px',
                      resize: 'none'
                    }}
                    placeholder="Add notes or description (optional)"
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '8px' }}>
                    Privacy
                  </label>
                  <select
                    value={editPrivacy}
                    onChange={(e) => setEditPrivacy(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '10px',
                      color: '#ffffff',
                      fontSize: '14px',
                      outline: 'none'
                    }}
                  >
                    <option value="public">🌐 Public</option>
                    <option value="unlisted">🔗 Unlisted</option>
                    <option value="private">🔒 Private</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                <button
                  onClick={() => setShowMetadataEditor(false)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#9ca3af',
                    borderRadius: '10px',
                    fontSize: '14px',
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveMetadata}
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: 'linear-gradient(to right, #dc2626, #ef4444)',
                    border: 'none',
                    color: '#ffffff',
                    borderRadius: '10px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* CSS ANIMATIONS */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.1; transform: scale(1); }
          50% { opacity: 0.15; transform: scale(1.05); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div 
      style={{
        background: 'rgba(15, 15, 15, 0.7)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        padding: '20px',
        transition: 'all 0.3s ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.3)';
        e.currentTarget.style.transform = 'translateY(-4px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>
        {icon} {label}
      </p>
      <p style={{ fontSize: '24px', fontWeight: 700 }}>{value}</p>
    </div>
  );
}

function DetailRow({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div 
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: '12px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
      }}
    >
      <span style={{ color: '#6b7280', fontSize: '13px' }}>{label}:</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span 
          style={{
            color: '#9ca3af',
            fontSize: '13px',
            maxWidth: '300px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'right'
          }}
        >
          {value.length > 40 ? value.substring(0, 40) + '...' : value}
        </span>
        {copyable && (
          <button
            onClick={handleCopy}
            style={{
              fontSize: '11px',
              padding: '4px 8px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#9ca3af',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
            }}
          >
            {copied ? '✓' : '📋'}
          </button>
        )}
      </div>
    </div>
  );
}
