import { useState, useEffect } from "react";
import { editingApi, type Project } from "../../../lib/editingApi";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onOpen: (projectId: string) => void;
};

export default function OpenProjectModal({ isOpen, onClose, onOpen }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    editingApi.getProjects().then((list) => {
      // Sort by most recently updated
      const sorted = [...list].sort((a, b) => {
        const ta = new Date(a.lastModified || 0).getTime();
        const tb = new Date(b.lastModified || 0).getTime();
        return tb - ta;
      });
      setProjects(sorted);
      setLoading(false);
    }).catch(() => {
      setProjects([]);
      setLoading(false);
    });
  }, [isOpen]);

  if (!isOpen) return null;

  const fmtDate = (iso: string | undefined) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "min(620px, 90vw)",
          maxHeight: "80vh",
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          border: "1px solid rgba(220, 38, 38, 0.4)",
          borderRadius: "1rem",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "1.25rem 1.5rem",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <h2 style={{ color: "#fff", fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>
            📂 Open Project
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", color: "#9ca3af",
              fontSize: "1.25rem", cursor: "pointer", padding: "0.25rem",
            }}
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.5rem" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>
              <div style={{
                display: "inline-block", width: 32, height: 32,
                border: "3px solid rgba(220,38,38,0.3)", borderTop: "3px solid #dc2626",
                borderRadius: "50%", animation: "openproj-spin 1s linear infinite",
              }} />
              <p style={{ marginTop: "0.75rem" }}>Loading projects…</p>
              <style>{`@keyframes openproj-spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : projects.length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem", color: "#6b7280" }}>
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📭</div>
              <p>No projects yet. Start a new project to get started.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {projects.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "0.875rem 1rem",
                    borderRadius: "0.75rem",
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.03)",
                    transition: "all 0.2s ease",
                    cursor: "pointer",
                  }}
                  onClick={() => onOpen(p.id)}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(220, 38, 38, 0.5)";
                    (e.currentTarget as HTMLDivElement).style.background = "rgba(220, 38, 38, 0.06)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.1)";
                    (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)";
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontWeight: 600, fontSize: "0.9rem", color: "#fff",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {p.name || "Untitled Project"}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.2rem" }}>
                      Last updated: {fmtDate(p.lastModified)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpen(p.id); }}
                    style={{
                      padding: "0.5rem 1rem", borderRadius: "0.5rem",
                      background: "linear-gradient(135deg, #dc2626, #ef4444)",
                      border: "none", color: "#fff", cursor: "pointer",
                      fontWeight: 600, fontSize: "0.8rem", flexShrink: 0,
                      transition: "all 0.2s ease",
                    }}
                  >
                    Open →
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "1rem 1.5rem",
          borderTop: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          justifyContent: "flex-end",
        }}>
          <button
            onClick={onClose}
            style={{
              padding: "0.6rem 1.25rem", borderRadius: "0.5rem",
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)",
              color: "#ccc", cursor: "pointer", fontWeight: 500, fontSize: "0.875rem",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
