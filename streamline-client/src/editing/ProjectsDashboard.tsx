import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { editingApi, type Project as EditProject, type Asset } from "../lib/editingApi";
import { useEffectiveEntitlements } from "../hooks/useEffectiveEntitlements";
import { useFeatureAccess } from "../hooks/useFeatureAccess";

type Project = EditProject;

export default function ProjectsDashboard() {
  const nav = useNavigate();
  const { effectiveEntitlements } = useEffectiveEntitlements();
  const { access } = useFeatureAccess(effectiveEntitlements);
  const canEditor = access.editor.allowed;

  const [projects, setProjects] = useState<Project[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [projectName, setProjectName] = useState("");

  useEffect(() => {
    const loadData = async () => {
      const [projectsData, assetsData] = await Promise.all([
        editingApi.getProjects(),
        editingApi.getAssets(),
      ]);
      setProjects(projectsData);
      setAssets(assetsData);
      setLoading(false);
    };
    loadData();
  }, []);

  const handleCreate = async () => {
    if (!projectName.trim() || !selectedAssetId) {
      alert("Please fill in all fields");
      return;
    }

    const newProject = await editingApi.createProject({
      name: projectName,
      assetId: selectedAssetId,
    });

    setProjects([...projects, newProject]);
    setShowCreateModal(false);
    setProjectName("");
    setSelectedAssetId("");

    if (canEditor) {
      nav(`/editing/editor/${newProject.id}`);
    } else {
      alert("Project created. Editor is currently disabled.");
    }
  };

  return (
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
              fontWeight: '700',
              marginBottom: '0.5rem',
              background: 'linear-gradient(to right, #ffffff, #fecaca)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              🎬 Your Projects
            </h1>
            <p style={{ fontSize: '1rem', color: '#9ca3af', marginTop: '0.5rem' }}>
              {projects.length} / 100 projects used
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

        {/* New Project Button */}
        <button
          onClick={() => setShowCreateModal(true)}
          style={{
            padding: '0.875rem 1.75rem',
            background: 'linear-gradient(135deg, #dc2626, #ef4444)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '0.75rem',
            fontWeight: '600',
            cursor: 'pointer',
            marginBottom: '2rem',
            transition: 'all 0.3s ease',
            boxShadow: '0 8px 16px rgba(220, 38, 38, 0.2)',
            fontSize: '1rem'
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
          ➕ New Project
        </button>

        {/* Projects Grid */}
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
            <p style={{ marginTop: '1rem' }}>Loading projects...</p>
            <style>{`
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        ) : projects.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '4rem 2rem',
            background: 'rgba(255, 255, 255, 0.02)',
            borderRadius: '1rem',
            border: '1px dashed rgba(255, 255, 255, 0.1)'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📭</div>
            <p style={{ fontSize: '1.1rem', color: '#6b7280', marginBottom: '1rem' }}>No projects yet</p>
            <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>Create your first project to get started with video editing</p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: '1.5rem'
          }}>
            {projects.map((proj) => (
              <ProjectCard 
                key={proj.id} 
                project={proj} 
                canEditor={canEditor}
                onDelete={async () => {
                  try {
                    await editingApi.deleteProject(proj.id);
                    setProjects(projects.filter((p) => p.id !== proj.id));
                  } catch (err) {
                    console.error('Failed to delete project:', err);
                    alert('Failed to delete project. Please try again.');
                  }
                }} 
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
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
            background: 'linear-gradient(135deg, rgba(31, 41, 55, 0.9) 0%, rgba(15, 23, 42, 0.9) 100%)',
            borderRadius: '1rem',
            padding: '2rem',
            width: '100%',
            maxWidth: '420px',
            border: '1px solid rgba(220, 38, 38, 0.3)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.4)'
          }}>
            <h2 style={{
              fontSize: '1.5rem',
              fontWeight: '700',
              marginBottom: '1.5rem',
              background: 'linear-gradient(to right, #ffffff, #fecaca)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              ✨ Create New Project
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  color: '#9ca3af',
                  marginBottom: '0.5rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Select Asset
                </label>
                <select
                  value={selectedAssetId}
                  onChange={(e) => setSelectedAssetId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.875rem',
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '0.75rem',
                    color: '#ffffff',
                    fontSize: '1rem',
                    outline: 'none',
                    transition: 'all 0.3s ease',
                    backdropFilter: 'blur(10px)',
                    cursor: 'pointer'
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(220, 38, 38, 0.6)';
                    e.currentTarget.style.background = 'rgba(0, 0, 0, 0.6)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                    e.currentTarget.style.background = 'rgba(0, 0, 0, 0.4)';
                  }}
                >
                  <option value="" style={{ background: '#1a1a1a', color: '#ffffff' }}>Choose an asset...</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id} style={{ background: '#1a1a1a', color: '#ffffff' }}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  color: '#9ca3af',
                  marginBottom: '0.5rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Project Name
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g., Highlight Reel"
                  style={{
                    width: '100%',
                    padding: '0.875rem',
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
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                    e.currentTarget.style.background = 'rgba(0, 0, 0, 0.4)';
                  }}
                />
              </div>
            </div>

            <div style={{
              display: 'flex',
              gap: '1rem',
              marginTop: '2rem'
            }}>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setProjectName("");
                  setSelectedAssetId("");
                }}
                style={{
                  flex: 1,
                  padding: '0.875rem',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  background: 'transparent',
                  borderRadius: '0.75rem',
                  color: '#ffffff',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
                onMouseEnter={(e) => {
                  const target = e.target as HTMLButtonElement;
                  target.style.background = 'rgba(255, 255, 255, 0.1)';
                  target.style.borderColor = 'rgba(255, 255, 255, 0.4)';
                }}
                onMouseLeave={(e) => {
                  const target = e.target as HTMLButtonElement;
                  target.style.background = 'transparent';
                  target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                style={{
                  flex: 1,
                  padding: '0.875rem',
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
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  canEditor,
  onDelete,
}: {
  project: Project;
  canEditor: boolean;
  onDelete: () => Promise<void>;
}) {
  const nav = useNavigate();
  
  const statusConfig = {
    draft: { color: '#6b7280', label: 'Draft', icon: '✏️' },
    rendering: { color: '#f59e0b', label: 'Rendering', icon: '⏳' },
    complete: { color: '#10b981', label: 'Ready', icon: '✓' },
  };

  const status = statusConfig[project.status as keyof typeof statusConfig] || statusConfig.draft;
  const mins = Math.floor(project.duration / 60);
  const secs = project.duration % 60;

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
        display: 'flex',
        flexDirection: 'column'
      }}
      onMouseEnter={(e) => {
        const target = e.currentTarget as HTMLDivElement;
        target.style.borderColor = 'rgba(220, 38, 38, 0.6)';
        target.style.boxShadow = '0 12px 48px rgba(220, 38, 38, 0.2)';
        target.style.transform = 'translateY(-4px)';
      }}
      onMouseLeave={(e) => {
        const target = e.currentTarget as HTMLDivElement;
        target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        target.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.3)';
        target.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ position: 'relative', overflow: 'hidden', aspectRatio: '16 / 9', background: 'linear-gradient(135deg, #2d3748, #1a202c)' }}>
        <img
          src="https://placehold.co/400x225?text=Project+Preview"
          alt={project.name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transition: 'opacity 0.3s ease'
          }}
          onMouseEnter={(e) => (e.currentTarget as HTMLImageElement).style.opacity = '0.7'}
          onMouseLeave={(e) => (e.currentTarget as HTMLImageElement).style.opacity = '1'}
        />
        <div style={{
          position: 'absolute',
          top: '0.75rem',
          right: '0.75rem',
          background: `rgba(${status.color}, 0.2)`,
          color: status.color,
          padding: '0.375rem 0.75rem',
          borderRadius: '0.375rem',
          fontSize: '0.75rem',
          fontWeight: '700',
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          border: `1px solid ${status.color}50`
        }}>
          {status.icon} {status.label}
        </div>
      </div>

      <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <h3 style={{
          fontWeight: '700',
          fontSize: '1.1rem',
          marginBottom: '0.5rem',
          color: '#ffffff'
        }}>
          {project.name}
        </h3>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.875rem',
          color: '#9ca3af',
          marginBottom: '0.75rem'
        }}>
          <span>⏱️ {mins}:{String(secs).padStart(2, '0')}</span>
          <span style={{ fontSize: '0.75rem' }}>📅 {new Date(project.lastModified).toLocaleDateString()}</span>
        </div>

        <div style={{
          marginTop: 'auto',
          display: 'flex',
          gap: '0.75rem'
        }}>
          <button
            onClick={() => {
              if (!canEditor) return;
              nav(`/editing/editor/${project.id}`);
            }}
            disabled={!canEditor}
            style={{
              flex: 1,
              padding: '0.75rem 1rem',
              background: canEditor
                ? 'linear-gradient(135deg, #dc2626, #ef4444)'
                : 'rgba(107, 114, 128, 0.2)',
              color: canEditor ? '#ffffff' : '#9ca3af',
              border: 'none',
              borderRadius: '0.5rem',
              fontWeight: '600',
              cursor: canEditor ? 'pointer' : 'not-allowed',
              transition: 'all 0.3s ease',
              fontSize: '0.875rem'
            }}
            onMouseEnter={(e) => {
              if (!canEditor) return;
              const target = e.target as HTMLButtonElement;
              target.style.background = 'linear-gradient(135deg, #b91c1c, #dc2626)';
              target.style.boxShadow = '0 8px 16px rgba(220, 38, 38, 0.3)';
              target.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              if (!canEditor) return;
              const target = e.target as HTMLButtonElement;
              target.style.background = 'linear-gradient(135deg, #dc2626, #ef4444)';
              target.style.boxShadow = 'none';
              target.style.transform = 'translateY(0)';
            }}
          >
            {canEditor ? '✏️ Open' : '🚫 Editor disabled'}
          </button>
          <button
            onClick={() => alert("Duplicate coming soon")}
            style={{
              padding: '0.75rem 1rem',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              background: 'transparent',
              borderRadius: '0.5rem',
              color: '#ffffff',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              fontSize: '0.875rem'
            }}
            onMouseEnter={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.borderColor = 'rgba(255, 255, 255, 0.4)';
              target.style.background = 'rgba(255, 255, 255, 0.05)';
            }}
            onMouseLeave={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
              target.style.background = 'transparent';
            }}
            title="Duplicate coming soon"
          >
            📋 Dup
          </button>
          <button
            onClick={() => {
              if (window.confirm("Delete this project?")) onDelete();
            }}
            style={{
              padding: '0.75rem 1rem',
              border: '1px solid rgba(220, 38, 38, 0.4)',
              background: 'transparent',
              borderRadius: '0.5rem',
              color: '#ef4444',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              fontSize: '0.875rem'
            }}
            onMouseEnter={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.borderColor = 'rgba(220, 38, 38, 0.8)';
              target.style.background = 'rgba(220, 38, 38, 0.1)';
            }}
            onMouseLeave={(e) => {
              const target = e.target as HTMLButtonElement;
              target.style.borderColor = 'rgba(220, 38, 38, 0.4)';
              target.style.background = 'transparent';
            }}
            title="Delete project"
          >
            🗑️ Del
          </button>
        </div>
      </div>
    </div>
  );
}
