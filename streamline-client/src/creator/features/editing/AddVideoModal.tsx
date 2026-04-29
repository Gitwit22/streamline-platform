import { useState, useEffect } from "react";
import { editingApi, type Recording } from "../../../lib/editingApi";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
};

export default function AddVideoModal({ isOpen, onClose, onAdded }: Props) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelected(new Set());
    setError(null);
    setLoading(true);
    editingApi.getRecordings().then((all) => {
      setRecordings(all);
      setLoading(false);
    }).catch(() => {
      setRecordings([]);
      setLoading(false);
    });
  }, [isOpen]);

  if (!isOpen) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (selected.size === 0) return;
    setAdding(true);
    setError(null);
    try {
      for (const id of selected) {
        await editingApi.addContentItem(id);
      }
      onAdded();
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to add videos");
    } finally {
      setAdding(false);
    }
  };

  const fmtDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const fmtDate = (iso: string) => {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "Unknown Date";
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return "Unknown Date";
    }
  };

  const statusColor = (s: string) => {
    if (s === "ready") return "#22c55e";
    if (s === "processing") return "#f59e0b";
    return "#ef4444";
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
          width: "min(720px, 90vw)",
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
            🎬 Add Video from StreamLine Recordings
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", color: "#9ca3af",
              fontSize: "1.25rem", cursor: "pointer", padding: "0.25rem",
            }}
          >✕</button>
        </div>

        {/* Body – scrollable list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.5rem" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af" }}>
              <div style={{
                display: "inline-block", width: 32, height: 32,
                border: "3px solid rgba(220,38,38,0.3)", borderTop: "3px solid #dc2626",
                borderRadius: "50%", animation: "addvid-spin 1s linear infinite",
              }} />
              <p style={{ marginTop: "0.75rem" }}>Loading recordings…</p>
              <style>{`@keyframes addvid-spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : recordings.length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem", color: "#6b7280" }}>
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📭</div>
              <p>No recordings found. Start a stream to create recordings.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {recordings.map((r) => {
                const checked = selected.has(r.id);
                return (
                  <label
                    key={r.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                      padding: "0.75rem",
                      borderRadius: "0.75rem",
                      border: checked
                        ? "1px solid rgba(220, 38, 38, 0.7)"
                        : "1px solid rgba(255,255,255,0.1)",
                      background: checked
                        ? "rgba(220, 38, 38, 0.08)"
                        : "rgba(255,255,255,0.03)",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                  >
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(r.id)}
                      style={{ accentColor: "#dc2626", width: 18, height: 18, cursor: "pointer" }}
                    />

                    {/* Thumbnail */}
                    <div style={{
                      width: 96, height: 54, borderRadius: "0.5rem", overflow: "hidden",
                      background: "#111", flexShrink: 0,
                    }}>
                      {r.thumbnailUrl ? (
                        <img src={r.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#555" }}>🎬</div>
                      )}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontWeight: 600, fontSize: "0.875rem", color: "#fff",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {r.title}
                      </div>
                      <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.25rem", flexWrap: "wrap" }}>
                        {r.roomName && <span>📡 {r.roomName}</span>}
                        <span>⏱ {fmtDuration(r.duration)}</span>
                        <span>📅 {fmtDate(r.createdAt)}</span>
                      </div>
                    </div>

                    {/* Status badge */}
                    <span style={{
                      fontSize: "0.7rem", fontWeight: 700, padding: "0.2rem 0.5rem",
                      borderRadius: "0.375rem", textTransform: "capitalize",
                      background: `${statusColor(r.status)}22`,
                      color: statusColor(r.status),
                      border: `1px solid ${statusColor(r.status)}44`,
                      flexShrink: 0,
                    }}>
                      {r.status}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {error && (
            <div style={{
              marginTop: "1rem", padding: "0.75rem", borderRadius: "0.5rem",
              background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
              color: "#fca5a5", fontSize: "0.85rem",
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "1rem 1.5rem",
          borderTop: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          justifyContent: "flex-end",
          gap: "0.75rem",
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
          <button
            onClick={handleAdd}
            disabled={selected.size === 0 || adding}
            style={{
              padding: "0.6rem 1.25rem", borderRadius: "0.5rem",
              background: selected.size === 0 || adding
                ? "rgba(220,38,38,0.3)"
                : "linear-gradient(135deg, #dc2626, #ef4444)",
              border: "none", color: "#fff", cursor: selected.size === 0 || adding ? "not-allowed" : "pointer",
              fontWeight: 600, fontSize: "0.875rem",
              transition: "all 0.2s ease",
              opacity: selected.size === 0 || adding ? 0.5 : 1,
            }}
          >
            {adding ? "Adding…" : `Add Selected (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
