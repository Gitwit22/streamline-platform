import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  listProjects,
  listProjectAssets,
  createProject,
  deleteProject,
  type Project,
  type ProjectAsset,
} from "../../../lib/projectsApi";

export default function ProjectsDashboard() {
  const nav = useNavigate();

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectAssets, setProjectAssets] = useState<Record<string, ProjectAsset[]>>({});
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [projectName, setProjectName] = useState("");

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    setLoading(true);
    try {
      const list = await listProjects();
      setProjects(list);
      const assetMap: Record<string, ProjectAsset[]> = {};
      await Promise.all(
        list.map(async (p) => {
          try {
            assetMap[p.id] = await listProjectAssets(p.id);
          } catch {
            assetMap[p.id] = [];
          }
        }),
      );
      setProjectAssets(assetMap);
    } catch (err) {
      console.error("Failed to load projects:", err);
    } finally {
      setLoading(false);
    }
  }

  const handleCreate = async () => {
    if (!projectName.trim()) return;
    try {
      const newProj = await createProject(projectName.trim());
      setProjects((prev) => [newProj, ...prev]);
      setProjectAssets((prev) => ({ ...prev, [newProj.id]: [] }));
      setShowCreateModal(false);
      setProjectName("");
      nav(`/editing/editor/${newProj.id}`);
    } catch (err) {
      console.error("Failed to create project:", err);
      alert("Failed to create project. Please try again.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this project and all its recordings?")) return;
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setProjectAssets((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
  };

  function formatDuration(sec: number | null): string {
    if (!sec) return "";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function formatSize(bytes: number | null): string {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f0f0f 0%, #1a0a0a 100%)',
      color: '#ffffff',
      padding: '2rem',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Background orbs */}
      <div style={{
        position: 'fixed', top: '10%', right: '5%', width: '400px', height: '400px',
        borderRadius: '50%', background: 'radial-gradient(circle, rgba(220,38,38,0.15) 0%, transparent 70%)',
        filter: 'blur(80px)', zIndex: 0, pointerEvents: 'none'
      }} />
      <div style={{
        position: 'fixed', bottom: '15%', left: '10%', width: '350px', height: '350px',
        borderRadius: '50%', background: 'radial-gradient(circle, rgba(220,38,38,0.1) 0%, transparent 70%)',
        filter: 'blur(70px)', zIndex: 0, pointerEvents: 'none'
      }} />

      <div style={{ maxWidth: '1400px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '3rem', paddingBottom: '2rem',
          borderBottom: '1px solid rgba(255,255,255,0.1)'
        }}>
          <div>
            <h1 style={{
              fontSize: '2.5rem', fontWeight: '700', marginBottom: '0.5rem',
              background: 'linear-gradient(to right, #ffffff, #fecaca)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
            }}>
              🎬 Saved Projects
            </h1>
            <p style={{ fontSize: '1rem', color: '#9ca3af', marginTop: '0.5rem' }}>
              {projects.length} project{projects.length !== 1 ? 's' : ''} · Recordings auto-attach from your rooms
            </p>
          </div>
          <button
            onClick={() => nav('/content')}
            style={{
              fontSize: '0.875rem', padding: '0.75rem 1.5rem',
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(220,38,38,0.4)',
              borderRadius: '0.75rem', color: '#ef4444', cursor: 'pointer',
              transition: 'all 0.3s ease', fontWeight: '500'
            }}
          >
            ← My Content
          </button>
        </div>

        {/* Projects Grid */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af' }}>
            <div style={{
              display: 'inline-block', width: '40px', height: '40px',
              border: '3px solid rgba(220,38,38,0.3)', borderTop: '3px solid #dc2626',
              borderRadius: '50%', animation: 'spin 1s linear infinite'
            }} />
            <p style={{ marginTop: '1rem' }}>Loading projects...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : projects.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '4rem 2rem',
            background: 'rgba(255,255,255,0.02)', borderRadius: '1rem',
            border: '1px dashed rgba(255,255,255,0.1)'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎥</div>
            <p style={{ fontSize: '1.1rem', color: '#6b7280', marginBottom: '0.5rem' }}>
              No projects yet
            </p>
            <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>
              Start a recording in any room — a project is created automatically.
              <br />Or create an empty project above.
            </p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '1.5rem'
          }}>
            {projects.map((proj) => {
              const assets = projectAssets[proj.id] || [];
              const recordings = assets.filter((a) => a.type === 'recording');
              const readyCount = recordings.filter((a) => a.processingStatus === 'ready').length;
              const processingCount = recordings.filter((a) => a.processingStatus === 'processing' || a.processingStatus === 'pending').length;
              const totalDuration = recordings.reduce((sum, r) => sum + (r.duration || 0), 0);

              return (
                <ProjectCard
                  key={proj.id}
                  project={proj}
                  recordings={recordings}
                  readyCount={readyCount}
                  processingCount={processingCount}
                  totalDuration={totalDuration}
                  formatDuration={formatDuration}
                  formatSize={formatSize}
                  onOpen={() => nav(`/editing/editor/${proj.id}`)}
                  onEdit={() => nav(`/editing/editor/${proj.id}`)}
                  onDelete={() => handleDelete(proj.id)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 50, backdropFilter: 'blur(5px)'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(31,41,55,0.9) 0%, rgba(15,23,42,0.9) 100%)',
            borderRadius: '1rem', padding: '2rem', width: '100%', maxWidth: '420px',
            border: '1px solid rgba(220,38,38,0.3)', backdropFilter: 'blur(20px)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
          }}>
            <h2 style={{
              fontSize: '1.5rem', fontWeight: '700', marginBottom: '1.5rem',
              background: 'linear-gradient(to right, #ffffff, #fecaca)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
            }}>
              ✨ New Project
            </h2>

            <div>
              <label style={{
                display: 'block', fontSize: '0.875rem', fontWeight: '500',
                color: '#9ca3af', marginBottom: '0.5rem',
                textTransform: 'uppercase', letterSpacing: '0.05em'
              }}>
                Project Name
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="e.g., Episode 1 Highlights"
                autoFocus
                style={{
                  width: '100%', padding: '0.875rem',
                  background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '0.75rem', color: '#ffffff', fontSize: '1rem',
                  outline: 'none', transition: 'all 0.3s ease', backdropFilter: 'blur(10px)'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(220,38,38,0.6)';
                  e.currentTarget.style.background = 'rgba(0,0,0,0.6)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                  e.currentTarget.style.background = 'rgba(0,0,0,0.4)';
                }}
              />
              <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.5rem' }}>
                Tip: Recordings from rooms automatically create projects. You can also create one manually here.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
              <button
                onClick={() => { setShowCreateModal(false); setProjectName(""); }}
                style={{
                  flex: 1, padding: '0.875rem', border: '1px solid rgba(255,255,255,0.2)',
                  background: 'transparent', borderRadius: '0.75rem', color: '#ffffff',
                  fontWeight: '600', cursor: 'pointer', transition: 'all 0.3s ease'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                style={{
                  flex: 1, padding: '0.875rem',
                  background: 'linear-gradient(135deg, #dc2626, #ef4444)',
                  color: '#ffffff', border: 'none', borderRadius: '0.75rem',
                  fontWeight: '600', cursor: 'pointer', transition: 'all 0.3s ease',
                  boxShadow: '0 8px 16px rgba(220,38,38,0.2)',
                  opacity: projectName.trim() ? 1 : 0.5
                }}
                disabled={!projectName.trim()}
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function ProjectCard({
  project,
  recordings,
  readyCount,
  processingCount,
  totalDuration,
  formatDuration,
  formatSize,
  onOpen,
  onEdit,
  onDelete,
}: {
  project: Project;
  recordings: ProjectAsset[];
  readyCount: number;
  processingCount: number;
  totalDuration: number;
  formatDuration: (s: number | null) => string;
  formatSize: (b: number | null) => string;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasRecordings = recordings.length > 0;

  return (
    <div
      onClick={onEdit}
      style={{
        background: 'linear-gradient(135deg, rgba(31,41,55,0.6) 0%, rgba(15,23,42,0.6) 100%)',
        borderRadius: '1rem', overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.1)',
        transition: 'all 0.3s ease', cursor: 'pointer',
        backdropFilter: 'blur(10px)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'rgba(220,38,38,0.6)';
        e.currentTarget.style.boxShadow = '0 12px 48px rgba(220,38,38,0.2)';
        e.currentTarget.style.transform = 'translateY(-4px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
        e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.3)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Thumbnail / recording preview area */}
      <div style={{
        position: 'relative', aspectRatio: '16 / 9',
        background: 'linear-gradient(135deg, #1e1e2e, #111827)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        {hasRecordings ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem' }}>🎥</div>
            <div style={{ fontSize: '0.8rem', color: '#d1d5db', marginTop: '0.25rem' }}>
              {recordings.length} recording{recordings.length !== 1 ? 's' : ''}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', opacity: 0.4 }}>📁</div>
            <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
              No recordings yet
            </div>
          </div>
        )}

        {/* Status badges */}
        <div style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', display: 'flex', gap: '0.5rem' }}>
          {readyCount > 0 && (
            <span style={{
              background: 'rgba(16,185,129,0.2)', color: '#10b981',
              padding: '0.25rem 0.5rem', borderRadius: '0.375rem', fontSize: '0.7rem',
              fontWeight: '700', border: '1px solid rgba(16,185,129,0.4)'
            }}>
              ✓ {readyCount} ready
            </span>
          )}
          {processingCount > 0 && (
            <span style={{
              background: 'rgba(245,158,11,0.2)', color: '#f59e0b',
              padding: '0.25rem 0.5rem', borderRadius: '0.375rem', fontSize: '0.7rem',
              fontWeight: '700', border: '1px solid rgba(245,158,11,0.4)'
            }}>
              ⏳ {processingCount} processing
            </span>
          )}
        </div>

        {/* Duration badge */}
        {totalDuration > 0 && (
          <div style={{
            position: 'absolute', bottom: '0.75rem', right: '0.75rem',
            background: 'rgba(0,0,0,0.7)', color: '#fff',
            padding: '0.25rem 0.5rem', borderRadius: '0.25rem',
            fontSize: '0.75rem', fontWeight: '600'
          }}>
            {formatDuration(totalDuration)}
          </div>
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ fontWeight: '700', fontSize: '1.1rem', marginBottom: '0.25rem', color: '#fff' }}>
          {project.name}
        </h3>

        {project.sourceRoomName && (
          <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: '0.5rem' }}>
            📡 {project.sourceRoomName}
          </div>
        )}

        {/* Recording summary */}
        {hasRecordings && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '0.5rem',
            marginBottom: '0.75rem'
          }}>
            {recordings.slice(0, 3).map((rec) => (
              <div key={rec.id} style={{
                fontSize: '0.75rem', color: '#d1d5db',
                background: 'rgba(255,255,255,0.06)', padding: '0.25rem 0.5rem',
                borderRadius: '0.375rem', border: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', alignItems: 'center', gap: '0.25rem'
              }}>
                <span style={{
                  display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
                  background: rec.processingStatus === 'ready' ? '#10b981'
                    : rec.processingStatus === 'failed' ? '#ef4444' : '#f59e0b'
                }} />
                {formatDuration(rec.duration) || '—'}
                {rec.size ? ` · ${formatSize(rec.size)}` : ''}
              </div>
            ))}
            {recordings.length > 3 && (
              <div style={{
                fontSize: '0.75rem', color: '#6b7280',
                padding: '0.25rem 0.5rem'
              }}>
                +{recordings.length - 3} more
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.75rem' }}>
          Created {new Date(project.createdAt).toLocaleDateString()}
        </div>

        {/* Action buttons */}
        <div style={{ marginTop: 'auto', display: 'flex', gap: '0.5rem' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onOpen}
            style={{
              flex: 1, padding: '0.625rem 0.75rem',
              background: 'rgba(255,255,255,0.06)', color: '#d1d5db',
              border: '1px solid rgba(255,255,255,0.15)', borderRadius: '0.5rem',
              fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s', fontSize: '0.8rem'
            }}
          >
            📂 View
          </button>
          {hasRecordings && (
            <button
              onClick={onEdit}
              style={{
                flex: 1, padding: '0.625rem 0.75rem',
                background: 'linear-gradient(135deg, #dc2626, #ef4444)', color: '#fff',
                border: 'none', borderRadius: '0.5rem',
                fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s', fontSize: '0.8rem'
              }}
            >
              ✂️ Timeline
            </button>
          )}
          <button
            onClick={onDelete}
            style={{
              padding: '0.625rem 0.75rem',
              border: '1px solid rgba(220,38,38,0.4)', background: 'transparent',
              borderRadius: '0.5rem', color: '#ef4444', cursor: 'pointer',
              transition: 'all 0.2s', fontSize: '0.8rem'
            }}
            title="Delete project"
          >
            🗑️
          </button>
        </div>
      </div>
    </div>
  );
}
