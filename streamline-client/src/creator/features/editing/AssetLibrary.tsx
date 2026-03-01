import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { editingApi, type Recording } from "../../../lib/editingApi";
import VideoUploadModal from "../../components/VideoUploadModal";
import { useEffectiveEntitlements } from "../../../hooks/useEffectiveEntitlements";
import { useFeatureAccess } from "../../../hooks/useFeatureAccess";

export default function AssetLibrary() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { effectiveEntitlements } = useEffectiveEntitlements();
  const { access } = useFeatureAccess(effectiveEntitlements);
  const canAssets = access.contentLibrary.allowed;
  const canMyContentRecordings = !!access?.myContentRecordings?.allowed;
  const canProjects = access.projects.allowed;
  const canEditor = access.editor.allowed;
  const [assets, setAssets] = useState<Awaited<ReturnType<typeof editingApi.getAssets>>>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'stream' | 'upload' | 'recordings'>('all');
  const [search, setSearch] = useState("");
  const [showUploadModal, setShowUploadModal] = useState(false);

  const loadData = async () => {
    const [assetsData, recordingsData] = await Promise.all([
      canAssets ? editingApi.getAssets() : Promise.resolve([]),
      canMyContentRecordings ? editingApi.getRecordings() : Promise.resolve([]),
    ]);
    setAssets(assetsData);
    setRecordings(recordingsData.filter((r) => r.status === 'ready'));
    setLoading(false);
  };

  const handleUploadComplete = (assetId: string) => {
    console.log('✅ Upload complete:', assetId);
    // Reload assets to show the new upload
    loadData();
    setFilter('upload'); // Switch to uploads tab
  };

  useEffect(() => {
    loadData();

    const newRecording = searchParams.get('newRecording');
    if (newRecording) {
      setFilter('recordings');
      setTimeout(() => {
        document
          .getElementById(`recording-${newRecording}`)
          ?.scrollIntoView({ behavior: 'smooth' });
      }, 500);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!canAssets && canMyContentRecordings && filter !== 'recordings') {
      setFilter('recordings');
    }
  }, [canAssets, canMyContentRecordings, filter]);

  const filtered = assets.filter((a) => {
    if (filter !== 'all' && a.source !== filter) return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const filteredRecordings = recordings.filter((r) => {
    if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <VideoUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUploadComplete={handleUploadComplete}
      />

      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f0f0f 0%, #1a0a0a 100%)',
        color: '#ffffff',
        padding: '2rem',
        position: 'relative',
        overflow: 'hidden'
      }}>
      {/* Animated background orbs */}
      <div style={{
        position: 'fixed',
        top: '10%',
        right: '5%',
        width: '400px',
        height: '400px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(220, 38, 38, 0.15) 0%, transparent 70%)',
        filter: 'blur(80px)',
        zIndex: 0,
        pointerEvents: 'none'
      }} />
      <div style={{
        position: 'fixed',
        bottom: '15%',
        left: '10%',
        width: '350px',
        height: '350px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(220, 38, 38, 0.1) 0%, transparent 70%)',
        filter: 'blur(70px)',
        zIndex: 0,
        pointerEvents: 'none'
      }} />

      <div style={{ maxWidth: '1400px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '3rem',
          paddingBottom: '2rem',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <div>
            <h1 style={{
              fontSize: '2.5rem',
              fontWeight: 700,
              marginBottom: '0.5rem',
              background: 'linear-gradient(to right, #ffffff, #fecaca)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              📚 Asset Library
            </h1>
            <p style={{ fontSize: '1rem', color: '#9ca3af', marginTop: '0.5rem' }}>
              {filteredRecordings.length} recordings • {filtered.length} assets
            </p>
          </div>
          <button
            onClick={() => nav('/join')}
            style={{
              fontSize: '0.875rem',
              padding: '0.75rem 1.5rem',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(220, 38, 38, 0.4)',
              borderRadius: '0.75rem',
              color: '#ef4444',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              fontWeight: '500'
            }}
            onMouseEnter={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.background = 'rgba(239, 68, 68, 0.2)';
              target.style.borderColor = 'rgba(239, 68, 68, 0.8)';
            }}
            onMouseLeave={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.background = 'rgba(239, 68, 68, 0.1)';
              target.style.borderColor = 'rgba(220, 38, 38, 0.4)';
            }}
          >
            ← Back
          </button>
        </div>

        {/* Action buttons */}
        <div style={{
          display: 'flex',
          gap: '1rem',
          marginBottom: '2rem',
          flexWrap: 'wrap'
        }}>
          {canAssets && (
            <button
              onClick={() => setShowUploadModal(true)}
              style={{
                padding: '0.75rem 1.5rem',
                background: 'linear-gradient(135deg, #dc2626, #ef4444)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '0.75rem',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                boxShadow: '0 8px 16px rgba(220, 38, 38, 0.2)'
              }}
              onMouseEnter={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'linear-gradient(135deg, #b91c1c, #dc2626)';
                target.style.boxShadow = '0 12px 24px rgba(220, 38, 38, 0.3)';
                target.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                const target = e.target as HTMLButtonElement;
                target.style.background = 'linear-gradient(135deg, #dc2626, #ef4444)';
                target.style.boxShadow = '0 8px 16px rgba(220, 38, 38, 0.2)';
                target.style.transform = 'translateY(0)';
              }}
            >
              ⬆️ Upload Video
            </button>
          )}
          <button
            onClick={() => {
              if (!canProjects) return;
              nav('/projects');
            }}
            disabled={!canProjects}
            style={{
              padding: '0.75rem 1.5rem',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '0.75rem',
              color: canProjects ? '#ffffff' : '#9ca3af',
              fontWeight: '600',
              cursor: canProjects ? 'pointer' : 'not-allowed',
              transition: 'all 0.3s ease',
              backdropFilter: 'blur(10px)'
            }}
            onMouseEnter={(e) => {
              if (!canProjects) return;
              const target = e.target as HTMLButtonElement;
              target.style.background = 'rgba(255, 255, 255, 0.1)';
              target.style.borderColor = 'rgba(220, 38, 38, 0.5)';
            }}
            onMouseLeave={(e) => {
              if (!canProjects) return;
              const target = e.target as HTMLButtonElement;
              target.style.background = 'rgba(255, 255, 255, 0.05)';
              target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            }}
          >
            📁 View Projects
          </button>
        </div>

        {/* Filter tabs */}
        <div style={{
          display: 'flex',
          gap: '0.75rem',
          marginBottom: '2rem',
          flexWrap: 'wrap',
          paddingBottom: '1.5rem',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          {(
            (() => {
              const tabs: Array<[typeof filter, string]> = [];
              if (canAssets && canMyContentRecordings) {
                tabs.push(['all', 'All Assets']);
              }
              if (canAssets) {
                tabs.push(['stream', 'From Streams']);
                tabs.push(['upload', 'Uploads']);
              }
              if (canMyContentRecordings) {
                tabs.push(['recordings', `Recent Streams (${recordings.length})`]);
              }
              if (tabs.length === 0) {
                tabs.push(['all', 'All']);
              }
              return tabs;
            })()
          ).map(([f, label]) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: filter === f ? 'none' : '1px solid rgba(255, 255, 255, 0.2)',
                background: filter === f
                  ? 'linear-gradient(135deg, #dc2626, #ef4444)'
                  : 'rgba(255, 255, 255, 0.05)',
                color: '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                fontWeight: filter === f ? '600' : '500',
                fontSize: '0.875rem'
              }}
              onMouseEnter={(e) => {
                const target = e.target as HTMLButtonElement;
                if (filter !== f) {
                  target.style.borderColor = 'rgba(255, 255, 255, 0.4)';
                  target.style.background = 'rgba(255, 255, 255, 0.1)';
                }
              }}
              onMouseLeave={(e) => {
                const target = e.target as HTMLButtonElement;
                if (filter !== f) {
                  target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                  target.style.background = 'rgba(255, 255, 255, 0.05)';
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search bar */}
        <div style={{ marginBottom: '2rem' }}>
          <input
            type="text"
            placeholder="🔍 Search assets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '1rem',
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '0.75rem',
              color: '#ffffff',
              fontSize: '1rem',
              outline: 'none',
              transition: 'all 0.3s ease',
              backdropFilter: 'blur(10px)'
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.6)';
              e.currentTarget.style.background = 'rgba(0, 0, 0, 0.6)';
              e.currentTarget.style.boxShadow = '0 0 20px rgba(220, 38, 38, 0.2)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
              e.currentTarget.style.background = 'rgba(0, 0, 0, 0.4)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
        </div>

        {/* Recordings Section */}
        {(filter === 'all' || filter === 'recordings') && filteredRecordings.length > 0 && (
          <div style={{ marginBottom: '3rem' }}>
            <h2 style={{
              fontSize: '1.5rem',
              fontWeight: '600',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              🎬 Recent Stream Recordings
            </h2>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: '1.5rem'
            }}>
              {filteredRecordings.map((recording) => (
                <RecordingCard
                  key={recording.id}
                  recording={recording}
                  id={`recording-${recording.id}`}
                  onCreateProject={() => {
                    if (!canEditor) {
                      alert("Editor is currently disabled.");
                      return;
                    }
                    nav(`/editing/editor/new?recordingId=${recording.id}`);
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Assets Section */}
        {(filter === 'all' || filter === 'stream' || filter === 'upload') && (
          <div>
            <h2 style={{
              fontSize: '1.5rem',
              fontWeight: '600',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              📦 {filter === 'all' ? 'All Assets' : filter === 'stream' ? 'From Streams' : 'Uploads'}
            </h2>
            {loading ? (
              <div style={{
                textAlign: 'center',
                padding: '3rem',
                color: '#9ca3af'
              }}>
                <div style={{
                  display: 'inline-block',
                  width: '40px',
                  height: '40px',
                  border: '3px solid rgba(220, 38, 38, 0.3)',
                  borderTop: '3px solid #dc2626',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }} />
                <p style={{ marginTop: '1rem' }}>Loading assets...</p>
                <style>{`
                  @keyframes spin {
                    to { transform: rotate(360deg); }
                  }
                `}</style>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '3rem',
                color: '#6b7280',
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '1rem',
                border: '1px dashed rgba(255, 255, 255, 0.1)'
              }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📭</div>
                <p>No assets found</p>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: '1.5rem'
              }}>
                {filtered.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    onCreateProject={() => {
                      if (!canEditor) {
                        alert("Editor is currently disabled.");
                        return;
                      }
                      nav(`/editing/editor/new?assetId=${asset.id}`);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      </div>
      </>
  );
}

function RecordingCard({
  recording,
  id,
  onCreateProject,
}: {
  recording: Recording;
  id: string;
  onCreateProject: () => void;
}) {
  const mins = Math.floor(recording.duration / 60);
  const secs = recording.duration % 60;

  return (
    <div
      id={id}
      style={{
        background: 'linear-gradient(135deg, rgba(31, 41, 55, 0.6) 0%, rgba(15, 23, 42, 0.6) 100%)',
        borderRadius: '1rem',
        overflow: 'hidden',
        border: '1px solid rgba(220, 38, 38, 0.3)',
        transition: 'all 0.3s ease',
        cursor: 'pointer',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column'
      }}
      onMouseEnter={(e) => {
        const target = e.currentTarget as HTMLDivElement;
        target.style.borderColor = 'rgba(220, 38, 38, 0.8)';
        target.style.boxShadow = '0 12px 48px rgba(220, 38, 38, 0.25)';
        target.style.transform = 'translateY(-4px)';
        target.querySelector('img')!.style.opacity = '0.7';
      }}
      onMouseLeave={(e) => {
        const target = e.currentTarget as HTMLDivElement;
        target.style.borderColor = 'rgba(220, 38, 38, 0.3)';
        target.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.3)';
        target.style.transform = 'translateY(0)';
        target.querySelector('img')!.style.opacity = '1';
      }}
    >
      <div style={{ position: 'relative', overflow: 'hidden', aspectRatio: '16 / 9' }}>
        <img
          src={recording.thumbnailUrl}
          alt={recording.title}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transition: 'opacity 0.3s ease'
          }}
        />
        <div style={{
          position: 'absolute',
          top: '0.75rem',
          right: '0.75rem',
          background: 'rgba(34, 197, 94, 0.9)',
          color: '#ffffff',
          padding: '0.25rem 0.5rem',
          borderRadius: '0.375rem',
          fontSize: '0.75rem',
          fontWeight: '700',
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem'
        }}>
          <span style={{
            display: 'inline-block',
            width: '6px',
            height: '6px',
            background: '#ffffff',
            borderRadius: '50%',
            animation: 'pulse 2s infinite'
          }} />
          Ready
        </div>
      </div>
      <div style={{ padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <h3 style={{
          fontWeight: '600',
          fontSize: '0.875rem',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: '#22c55e',
          marginBottom: '0.5rem'
        }}>
          ✓ {recording.title}
        </h3>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.75rem',
          color: '#9ca3af',
          marginBottom: '1rem'
        }}>
          <span>
            {mins}:{String(secs).padStart(2, '0')}
          </span>
        </div>
        <button
          onClick={onCreateProject}
          style={{
            marginTop: 'auto',
            padding: '0.75rem',
            background: 'linear-gradient(135deg, #22c55e, #16a34a)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '0.5rem',
            fontSize: '0.75rem',
            fontWeight: '700',
            cursor: 'pointer',
            transition: 'all 0.3s ease'
          }}
          onMouseEnter={(e) => {
            const target = e.target as HTMLButtonElement;
            target.style.background = 'linear-gradient(135deg, #16a34a, #15803d)';
            target.style.boxShadow = '0 8px 16px rgba(34, 197, 94, 0.3)';
            target.style.transform = 'translateY(-2px)';
          }}
          onMouseLeave={(e) => {
            const target = e.target as HTMLButtonElement;
            target.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
            target.style.boxShadow = 'none';
            target.style.transform = 'translateY(0)';
          }}
        >
          ✂️ Edit This
        </button>
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

function AssetCard({ asset, onCreateProject }: any) {
  const mins = Math.floor(asset.duration / 60);
  const secs = asset.duration % 60;

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(31, 41, 55, 0.6) 0%, rgba(15, 23, 42, 0.6) 100%)',
        borderRadius: '1rem',
        overflow: 'hidden',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        transition: 'all 0.3s ease',
        cursor: 'pointer',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column'
      }}
      onMouseEnter={(e) => {
        const target = e.currentTarget as HTMLDivElement;
        target.style.borderColor = 'rgba(220, 38, 38, 0.6)';
        target.style.boxShadow = '0 12px 48px rgba(220, 38, 38, 0.2)';
        target.style.transform = 'translateY(-4px)';
        target.querySelector('img')!.style.opacity = '0.7';
      }}
      onMouseLeave={(e) => {
        const target = e.currentTarget as HTMLDivElement;
        target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        target.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.3)';
        target.style.transform = 'translateY(0)';
        target.querySelector('img')!.style.opacity = '1';
      }}
    >
      <div style={{ position: 'relative', overflow: 'hidden', aspectRatio: '16 / 9' }}>
        <img
          src={asset.thumbnail}
          alt={asset.name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transition: 'opacity 0.3s ease'
          }}
        />
        <div style={{
          position: 'absolute',
          top: '0.75rem',
          right: '0.75rem',
          background: 'rgba(0, 0, 0, 0.7)',
          color: '#9ca3af',
          padding: '0.25rem 0.5rem',
          borderRadius: '0.375rem',
          fontSize: '0.625rem',
          fontWeight: '600',
          textTransform: 'capitalize'
        }}>
          {asset.source === "stream" ? "📡 Stream" : "⬆️ Upload"}
        </div>
      </div>
      <div style={{ padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <h3 style={{
          fontWeight: '600',
          fontSize: '0.875rem',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: '#ffffff',
          marginBottom: '0.75rem'
        }}>
          {asset.name}
        </h3>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.75rem',
          color: '#9ca3af',
          marginBottom: '1rem'
        }}>
          <span>
            {mins}:{String(secs).padStart(2, '0')}
          </span>
        </div>
        <button
          onClick={onCreateProject}
          style={{
            marginTop: 'auto',
            padding: '0.75rem',
            background: 'linear-gradient(135deg, #dc2626, #ef4444)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '0.5rem',
            fontSize: '0.75rem',
            fontWeight: '700',
            cursor: 'pointer',
            transition: 'all 0.3s ease'
          }}
          onMouseEnter={(e) => {
            const target = e.target as HTMLButtonElement;
            target.style.background = 'linear-gradient(135deg, #b91c1c, #dc2626)';
            target.style.boxShadow = '0 8px 16px rgba(220, 38, 38, 0.3)';
            target.style.transform = 'translateY(-2px)';
          }}
          onMouseLeave={(e) => {
            const target = e.target as HTMLButtonElement;
            target.style.background = 'linear-gradient(135deg, #dc2626, #ef4444)';
            target.style.boxShadow = 'none';
            target.style.transform = 'translateY(0)';
          }}
        >
          📦 Create Project
        </button>
      </div>
    </div>
  );
}
