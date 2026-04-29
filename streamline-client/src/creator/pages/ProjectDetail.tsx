import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getProject,
  listProjectAssets,
  deleteProjectAsset,
  getAssetDownloadUrl,
  type Project,
  type ProjectAsset,
} from "../../lib/projectsApi";

/**
 * ProjectDetail — Displays a single project with its recordings and assets.
 * Primary CTA: "Open Timeline" to start editing recordings.
 *
 * Route: /projects/:projectId
 */
export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const nav = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([getProject(projectId), listProjectAssets(projectId)])
      .then(([proj, assetList]) => {
        if (cancelled) return;
        setProject(proj);
        setAssets(assetList);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Failed to load project");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const [copiedAssetId, setCopiedAssetId] = useState<string | null>(null);

  const handleDeleteAsset = async (assetId: string) => {
    if (!projectId) return;
    if (!window.confirm("Remove this recording from the project?")) return;
    try {
      await deleteProjectAsset(projectId, assetId);
      setAssets((prev) => prev.filter((a) => a.id !== assetId));
      setProject((prev) =>
        prev ? { ...prev, assetCount: Math.max(0, prev.assetCount - 1) } : prev,
      );
    } catch {
      // silent
    }
  };

  const handleDownload = async (asset: ProjectAsset) => {
    if (!projectId) return;
    try {
      const result = await getAssetDownloadUrl(projectId, asset.id);
      if (result.downloadUrl) {
        try {
          window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
        } catch {
          window.open(result.downloadUrl, "_blank");
        }
      }
    } catch {
      // silent
    }
  };

  const handleCopyCid = async (asset: ProjectAsset) => {
    const key = asset.storageKey;
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopiedAssetId(asset.id);
      setTimeout(() => setCopiedAssetId(null), 2000);
    } catch {
      // silent
    }
  };

  function formatSize(bytes: number | null): string {
    if (!bytes) return "—";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatDuration(sec: number | null): string {
    if (!sec) return "—";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={{ color: "#9ca3af", textAlign: "center", paddingTop: "120px" }}>
          Loading project…
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div style={pageStyle}>
        <div style={{ color: "#ef4444", textAlign: "center", paddingTop: "120px" }}>
          {error || "Project not found"}
        </div>
        <div style={{ textAlign: "center", marginTop: "16px" }}>
          <button onClick={() => nav("/projects")} style={linkBtnStyle}>
            ← Back to Projects
          </button>
        </div>
      </div>
    );
  }

  const recordings = assets.filter((a) => a.type === "recording");
  const otherAssets = assets.filter((a) => a.type !== "recording");
  const hasReadyRecordings = recordings.some((r) => r.processingStatus === "ready");

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: "800px", margin: "0 auto", padding: "48px 24px 24px" }}>
        {/* Back link */}
        <button onClick={() => nav("/projects")} style={linkBtnStyle}>
          ← Back to Projects
        </button>

        {/* Project header */}
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          marginTop: "16px", marginBottom: "24px", flexWrap: "wrap", gap: "16px"
        }}>
          <div>
            <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#fff", margin: "0 0 4px" }}>
              {project.name}
            </h1>
            <div style={{ fontSize: "13px", color: "#9ca3af" }}>
              {recordings.length} recording{recordings.length !== 1 ? "s" : ""}
              {otherAssets.length > 0 && <> · {otherAssets.length} other asset{otherAssets.length !== 1 ? "s" : ""}</>}
              {project.sourceRoomName && <> · Room: {project.sourceRoomName}</>}
            </div>
          </div>

          {/* Primary CTA */}
          {hasReadyRecordings && (
            <button
              onClick={() => nav(`/editing/editor/${project.id}`)}
              style={{
                padding: "12px 28px",
                background: "linear-gradient(135deg, #dc2626, #ef4444)",
                border: "none", borderRadius: "10px", color: "#fff",
                fontWeight: 700, fontSize: "15px", cursor: "pointer",
                transition: "all 0.3s ease",
                boxShadow: "0 8px 20px rgba(220,38,38,0.25)",
              }}
            >
              ✂️ Open Timeline
            </button>
          )}
        </div>

        {/* Recordings section */}
        <div style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#fff", marginBottom: "12px" }}>
            🎥 Recordings
          </h2>

          {recordings.length === 0 ? (
            <div style={{
              color: "#6b7280", fontSize: "13px", textAlign: "center",
              padding: "32px 16px", background: "rgba(255,255,255,0.03)",
              borderRadius: "12px", border: "1px solid rgba(255,255,255,0.06)",
            }}>
              No recordings yet. Start recording in a room — they'll appear here automatically.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {recordings.map((rec) => (
                <div
                  key={rec.id}
                  style={{
                    display: "flex", alignItems: "center", gap: "14px",
                    padding: "14px 18px",
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${rec.processingStatus === "ready" ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.08)"}`,
                    borderRadius: "12px",
                    transition: "border-color 0.2s",
                  }}
                >
                  {/* Status indicator */}
                  <div style={{
                    width: "10px", height: "10px", borderRadius: "50%", flexShrink: 0,
                    background: rec.processingStatus === "ready" ? "#10b981"
                      : rec.processingStatus === "failed" ? "#ef4444" : "#f59e0b",
                  }} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: "14px", fontWeight: 600, color: "#fff",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {rec.filename}
                    </div>
                    <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "2px" }}>
                      {formatDuration(rec.duration)} · {formatSize(rec.size)}
                      {rec.processingStatus !== "ready" && (
                        <span style={{
                          marginLeft: "8px",
                          color: rec.processingStatus === "failed" ? "#ef4444" : "#f59e0b",
                        }}>
                          ({rec.processingStatus})
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: "6px" }}>
                    {rec.processingStatus === "ready" && (
                      <button
                        onClick={() => nav(`/editing/editor/${project.id}`)}
                        style={{ ...actionBtnStyle, color: "#ef4444", borderColor: "rgba(220,38,38,0.3)" }}
                        title="Open in Timeline"
                      >
                        ✂️
                      </button>
                    )}
                    {rec.processingStatus === "ready" && (
                      <button
                        onClick={() => handleDownload(rec)}
                        style={actionBtnStyle}
                        title="Download"
                      >
                        ⬇
                      </button>
                    )}
                    {rec.storageKey && (
                      <button
                        onClick={() => handleCopyCid(rec)}
                        style={{
                          ...actionBtnStyle,
                          color: copiedAssetId === rec.id ? "#10b981" : "#d1d5db",
                        }}
                        title={copiedAssetId === rec.id ? "Copied!" : "Copy CID"}
                      >
                        {copiedAssetId === rec.id ? "✓" : "📋"}
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteAsset(rec.id)}
                      style={{ ...actionBtnStyle, color: "#ef4444" }}
                      title="Remove recording"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Other assets section (uploads, renders, etc.) */}
        {otherAssets.length > 0 && (
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#fff", marginBottom: "12px" }}>
              📁 Other Assets
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {otherAssets.map((asset) => (
                <div
                  key={asset.id}
                  style={{
                    display: "flex", alignItems: "center", gap: "12px",
                    padding: "12px 16px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "10px",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: "14px", fontWeight: 500, color: "#fff",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {asset.type} — {asset.filename}
                    </div>
                    <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "2px" }}>
                      {formatDuration(asset.duration)} · {formatSize(asset.size)}
                    </div>
                  </div>
                  {asset.processingStatus === "ready" && (
                    <button onClick={() => handleDownload(asset)} style={actionBtnStyle} title="Download">
                      ⬇
                    </button>
                  )}
                  {asset.storageKey && (
                    <button
                      onClick={() => handleCopyCid(asset)}
                      style={{
                        ...actionBtnStyle,
                        color: copiedAssetId === asset.id ? "#10b981" : "#d1d5db",
                      }}
                      title={copiedAssetId === asset.id ? "Copied!" : "Copy CID"}
                    >
                      {copiedAssetId === asset.id ? "✓" : "📋"}
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteAsset(asset.id)}
                    style={{ ...actionBtnStyle, color: "#ef4444" }}
                    title="Remove asset"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0a0a0a",
  color: "#fff",
  fontFamily: "Inter, system-ui, sans-serif",
};

const linkBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#9ca3af",
  fontSize: "13px",
  cursor: "pointer",
  padding: 0,
  textDecoration: "underline",
};

const actionBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "6px",
  color: "#d1d5db",
  cursor: "pointer",
  fontSize: "14px",
  padding: "6px 10px",
  transition: "all 0.2s",
};
