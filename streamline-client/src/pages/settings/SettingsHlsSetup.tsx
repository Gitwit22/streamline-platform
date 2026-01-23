import { useEffect, useMemo, useState, type FormEvent } from "react";
import { API_BASE } from "../../lib/apiBase";
import { S } from "../SettingsBilling.styles";

type SavedEmbed = {
  embedId: string;
  label: string;
  roomId: string;
  // Viewer path provided by the API, e.g. /live/:savedEmbedId
  viewerPath: string;
  // Optional description (if present in the API response)
  description?: string;
  // Optional: current active room bound to this embed
  activeRoomId?: string | null;
};

type HlsCreateDraft = {
  // Back-compat: label may exist from older localStorage drafts.
  name?: string;
  description?: string;
  label?: string;
};

const HLS_CREATE_DRAFT_KEY = "sl_hls_create_draft_v1";
const HLS_SELECTED_EMBED_KEY = "sl_hls_selected_embed_v1";

function loadCreateDraft(): HlsCreateDraft | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(HLS_CREATE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as HlsCreateDraft;
  } catch {
    return null;
  }
}

function persistCreateDraft(draft: HlsCreateDraft) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(HLS_CREATE_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // ignore
  }
}

function getAuthToken(): string | null {
  try {
    return window.localStorage.getItem("sl_token") || window.localStorage.getItem("auth_token");
  } catch {
    return null;
  }
}

function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(extra || {}),
  };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function absoluteViewerUrlFromPath(viewerPath: string, fallbackId?: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const base = origin.replace(/\/$/, "");
  const rawPath = viewerPath || (fallbackId ? `/live/${encodeURIComponent(fallbackId)}` : "/live");
  const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return `${base}${normalizedPath}`;
}

function iframeCode(viewerUrl: string): string {
  const src = viewerUrl || "";
  if (!src) return "";
  return `<iframe src="${src}" style="width:100%;height:100%;border:0;" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
}

async function safeCopy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function SettingsHlsSetup({
  platformEnabled,
  canCustomize: _canCustomize,
  onUpgrade: _onUpgrade,
}: {
  platformEnabled: boolean;
  canCustomize: boolean;
  onUpgrade?: () => void;
}) {
  const [embeds, setEmbeds] = useState<SavedEmbed[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [listMessage, setListMessage] = useState<string | null>(null);

  // Edit modal state
  const [editingEmbed, setEditingEmbed] = useState<SavedEmbed | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [editDescription, setEditDescription] = useState<string>("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [selectedEmbedId, setSelectedEmbedId] = useState<string | null>(() => {
    try {
      if (typeof window === "undefined") return null;
      return window.localStorage.getItem(HLS_SELECTED_EMBED_KEY) || null;
    } catch {
      return null;
    }
  });

  const setSelectedEmbedIdAndPersist = (embedId: string | null) => {
    setSelectedEmbedId(embedId);
    try {
      if (typeof window === "undefined") return;
      if (embedId) {
        window.localStorage.setItem(HLS_SELECTED_EMBED_KEY, embedId);
      } else {
        window.localStorage.removeItem(HLS_SELECTED_EMBED_KEY);
      }
    } catch {
      // ignore
    }
  };
  const selectedEmbed = useMemo(() => embeds.find((e) => e.embedId === selectedEmbedId) || null, [embeds, selectedEmbedId]);

  // Create form
  const [createName, setCreateName] = useState(() => {
    const draft = loadCreateDraft();
    return draft?.name ?? draft?.label ?? "";
  });
  const [createDescription, setCreateDescription] = useState(() => {
    const draft = loadCreateDraft();
    return draft?.description ?? "";
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  const trimmedCreateName = (createName || "").trim();
  const trimmedCreateDescription = (createDescription || "").trim();
  const isCreateNameEmpty = trimmedCreateName.length === 0;
  const isCreateNameTooLong = trimmedCreateName.length > 60;
  const isCreateDescriptionTooLong = trimmedCreateDescription.length > 200;
  const isCreateInvalid = isCreateNameEmpty || isCreateNameTooLong || isCreateDescriptionTooLong;

  useEffect(() => {
    const draft: HlsCreateDraft = {
      name: createName,
      description: createDescription,
    };
    persistCreateDraft(draft);
  }, [createName, createDescription]);

  const loadEmbeds = async (opts?: { keepSelection?: boolean }) => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch(`${API_BASE}/api/saved-embeds`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: buildAuthHeaders(),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const code = payload?.error || "server_error";
        throw new Error(String(code));
      }
      const next = Array.isArray(payload?.embeds) ? payload.embeds : [];
      setEmbeds(next);

      if (!opts?.keepSelection) {
        setSelectedEmbedIdAndPersist(next?.[0]?.embedId || null);
      } else {
        const stillExists = next.some((e: any) => e.embedId === selectedEmbedId);
        if (!stillExists) setSelectedEmbedIdAndPersist(next?.[0]?.embedId || null);
      }
    } catch (e: any) {
      setListError(e?.message || "Failed to load saved embeds");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadEmbeds({ keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleArchive = async (embedId: string) => {
    const ok = window.confirm("Archive this embed? It will be removed from the list.");
    if (!ok) return;

    setListMessage(null);
    setListError(null);
    try {
      const res = await fetch(`${API_BASE}/api/saved-embeds/${encodeURIComponent(embedId)}`, {
        method: "PUT",
        credentials: "include",
        headers: buildAuthHeaders(),
        body: JSON.stringify({ archived: true }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to archive");
      }
      setListMessage("Archived");
      await loadEmbeds({ keepSelection: false });
    } catch (e: any) {
      setListError(e?.message || "Failed to archive");
    }
  };

  const handleDelete = async (embed: SavedEmbed) => {
    const message = embed.activeRoomId
      ? "This embed is currently active. Deleting will break the viewer link anywhere it’s posted and disconnect your active show."
      : "Deleting will break the viewer link anywhere it’s posted. You’ll need to replace the embed code on your site.";

    const ok = window.confirm(message);
    if (!ok) return;

    if (!embed || !embed.embedId) {
      setListError("Missing embed id");
      return;
    }

    setListMessage(null);
    setListError(null);
    try {
      const res = await fetch(`${API_BASE}/api/saved-embeds/${encodeURIComponent(embed.embedId)}`, {
        method: "PUT",
        credentials: "include",
        headers: buildAuthHeaders(),
        body: JSON.stringify({ archived: true }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to delete");
      }
      setListMessage("Deleted");
      await loadEmbeds({ keepSelection: false });
    } catch (e: any) {
      setListError(e?.message || "Failed to delete");
    }
  };

  const openEditModal = (embed: SavedEmbed) => {
    setEditingEmbed(embed);
    setEditName(embed.label || "");
    setEditDescription(embed.description || "");
    setEditError(null);
  };

  const originalEditName = (editingEmbed?.label || "").trim();
  const originalEditDescription = (editingEmbed?.description || "").trim();
  const trimmedEditName = (editName || "").trim();
  const trimmedEditDescription = (editDescription || "").trim();
  const isEditUnchanged = !editingEmbed || (originalEditName === trimmedEditName && originalEditDescription === trimmedEditDescription);

  const handleEditSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingEmbed) return;

    setEditError(null);

    const name = String(editName || "").trim();
    const description = String(editDescription || "").trim();

    if (originalEditName === name && originalEditDescription === description) {
      setEditError("No changes to save");
      return;
    }

    if (!name) {
      setEditError("Name is required");
      return;
    }
    if (name.length > 60) {
      setEditError("Name must be 60 characters or less");
      return;
    }
    if (description.length > 200) {
      setEditError("Description must be 200 characters or less");
      return;
    }

    if (!editingEmbed.embedId) {
      setEditError("Missing embed id");
      return;
    }

    setEditSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/saved-embeds/${encodeURIComponent(editingEmbed.embedId)}`, {
        method: "PUT",
        credentials: "include",
        headers: buildAuthHeaders(),
        body: JSON.stringify({
          name,
          description: description || "",
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to update embed");
      }

      setListMessage("Updated");
      setEditingEmbed(null);
      setEditName("");
      setEditDescription("");
      await loadEmbeds({ keepSelection: true });
    } catch (err: any) {
      setEditError(err?.message || "Failed to update embed");
    } finally {
      setEditSaving(false);
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreateMessage(null);

    const name = String(createName || "").trim();
    const description = String(createDescription || "").trim();
    if (!name) {
      setCreateError("Name is required");
      return;
    }
    if (name.length > 60) {
      setCreateError("Name must be 60 characters or less");
      return;
    }
    if (description.length > 200) {
      setCreateError("Description must be 200 characters or less");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/saved-embeds`, {
        method: "POST",
        credentials: "include",
        headers: buildAuthHeaders(),
        body: JSON.stringify({
          name,
          description: description || undefined,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to create embed");
      }

      const created = payload?.embed as SavedEmbed | undefined;
      setCreateMessage("Created");

      await loadEmbeds({ keepSelection: true });

      if (created?.embedId) {
        setSelectedEmbedId(created.embedId);
        setCreateName("");
        setCreateDescription("");
      }
    } catch (e: any) {
      setCreateError(e?.message || "Failed to create embed");
    } finally {
      setCreating(false);
    }
  };


  const panelStyle = {
    border: "1px solid rgba(63,63,70,0.45)",
    borderRadius: 14,
    padding: 16,
    background: "rgba(255,255,255,0.02)",
  } as const;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 1.1fr) minmax(280px, 0.9fr)", gap: 16 }}>
      {/* Left column: Create + Branding editor */}
      <div style={{ display: "grid", gap: 16 }}>
        {/* B) Create new embed */}
        <div style={panelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800, color: "#e5e7eb" }}>Create new embed</div>
            {createMessage && (
              <div style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(34,197,94,0.35)", background: "rgba(34,197,94,0.10)", color: "#bbf7d0", fontSize: 12, fontWeight: 800 }}>
                {createMessage}
              </div>
            )}
          </div>

          {createError && (
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 10, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", color: "#fca5a5", fontSize: 13 }}>
              {createError}
            </div>
          )}

          <form onSubmit={handleCreate} style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 12, color: "#9ca3af", fontWeight: 800 }}>Name</label>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Weekly Live Show"
                maxLength={60}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(63,63,70,0.6)",
                  background: "rgba(0,0,0,0.25)",
                  color: "#e5e7eb",
                  fontSize: 13,
                }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 12, color: "#9ca3af", fontWeight: 800 }}>Description (optional)</label>
              <textarea
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="Short description for this viewer page"
                maxLength={200}
                rows={2}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(63,63,70,0.6)",
                  background: "rgba(0,0,0,0.25)",
                  color: "#e5e7eb",
                  fontSize: 13,
                  resize: "vertical",
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>
              Branding (title, logo, colors, offline message) is coming soon.
              For now, each embed uses a default viewer page you can share.
            </div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>
              <span>{60 - createName.length}</span> name characters left · <span>{200 - createDescription.length}</span> description characters left
            </div>

            <button type="submit" disabled={creating || isCreateInvalid} style={{ ...S.primaryBtn, padding: "12px 16px", fontSize: 14 }}>
              {creating ? "Creating…" : "Create Embed"}
            </button>
          </form>

          {!platformEnabled && (
            <div style={{ marginTop: 10, color: "#fde68a", fontSize: 12, fontWeight: 800 }}>
              Note: HLS is disabled platform-wide right now. Viewer pages still work (offline) and links are still shareable.
            </div>
          )}
        </div>

        {/* C) Branding (coming soon) */}
        <div style={panelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800, color: "#e5e7eb" }}>Branding (coming soon)</div>
          </div>

          {!selectedEmbed && (
            <div style={{ marginTop: 10, color: "#9ca3af", fontSize: 13 }}>
              Select an embed from the list on the right to see its viewer link.
            </div>
          )}

          {selectedEmbed && (
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 13, color: "#9ca3af" }}>
                Selected embed: <span style={{ color: "#e5e7eb", fontWeight: 800 }}>{selectedEmbed.label}</span>
              </div>

              <div style={{ fontSize: 12, color: "#9ca3af" }}>
                Embed page URL: <span style={{ color: "#e5e7eb" }}>{absoluteViewerUrlFromPath(selectedEmbed.viewerPath, selectedEmbed.embedId)}</span>
              </div>

              <div
                style={{
                  marginTop: 4,
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: "rgba(30,64,175,0.25)",
                  border: "1px solid rgba(59,130,246,0.6)",
                  color: "#dbeafe",
                  fontSize: 13,
                }}
              >
                Branding controls (title, logo, colors, offline message) are coming soon.
                For now, share the viewer link or embed code from the Saved Embeds list on the right.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right column: Saved Embeds list */}
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 800, color: "#e5e7eb" }}>Saved Embeds</div>
          <button
            type="button"
            style={{ ...S.secondaryBtn, padding: "8px 12px", fontSize: 13 }}
            onClick={() => loadEmbeds({ keepSelection: true })}
            disabled={loadingList}
          >
            {loadingList ? "Loading…" : "Refresh"}
          </button>
        </div>

        {listError && (
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 10, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", color: "#fca5a5", fontSize: 13 }}>
            {listError}
          </div>
        )}
        {listMessage && (
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 10, background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.35)", color: "#bbf7d0", fontSize: 13 }}>
            {listMessage}
          </div>
        )}

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {embeds.length === 0 && (
            <div style={{ color: "#9ca3af", fontSize: 13 }}>No saved embeds yet. Create one first.</div>
          )}

          {embeds.map((embed) => {
            const viewerUrl = absoluteViewerUrlFromPath(embed.viewerPath, embed.embedId);
            const selected = embed.embedId === selectedEmbedId;
            return (
              <div
                key={embed.embedId}
                style={{
                  border: `1px solid ${selected ? "rgba(239,68,68,0.55)" : "rgba(63,63,70,0.4)"}`,
                  borderRadius: 12,
                  padding: 12,
                  background: selected ? "rgba(239,68,68,0.06)" : "rgba(0,0,0,0.15)",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: "#e5e7eb" }}>{embed.label}</div>
                    {embed.description && (
                      <div
                        style={{
                          marginTop: 2,
                          fontSize: 12,
                          color: "#9ca3af",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical" as any,
                          overflow: "hidden",
                        }}
                      >
                        {embed.description}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    {embed.activeRoomId && (
                      <div
                        title="Currently connected to an active room."
                        style={{
                          padding: "2px 8px",
                          borderRadius: 999,
                          border: "1px solid rgba(34,197,94,0.6)",
                          background: "rgba(22,163,74,0.16)",
                          color: "#bbf7d0",
                          fontSize: 11,
                          fontWeight: 800,
                        }}
                      >
                        Active
                      </div>
                    )}
                    <button
                      type="button"
                      style={{ ...S.secondaryBtn, padding: "8px 10px", fontSize: 12 }}
                      onClick={() => setSelectedEmbedIdAndPersist(embed.embedId)}
                    >
                      {selected ? "Selected" : "Select"}
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, color: "#9ca3af", fontWeight: 800 }}>Embed link</div>
                  <input
                    type="text"
                    readOnly
                    value={viewerUrl}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(63,63,70,0.6)",
                      background: "rgba(0,0,0,0.25)",
                      color: "#e5e7eb",
                      fontSize: 13,
                    }}
                  />
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={{ ...S.secondaryBtn, padding: "8px 12px", fontSize: 13 }}
                    onClick={() => openEditModal(embed)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    style={{ ...S.secondaryBtn, padding: "8px 12px", fontSize: 13 }}
                    onClick={async () => {
                      const ok = await safeCopy(viewerUrl);
                      setListMessage(ok ? "Viewer link copied" : "Copy failed");
                    }}
                  >
                    Copy Viewer Link
                  </button>
                  <button
                    type="button"
                    style={{ ...S.secondaryBtn, padding: "8px 12px", fontSize: 13 }}
                    onClick={async () => {
                      const ok = await safeCopy(iframeCode(viewerUrl));
                      setListMessage(ok ? "Embed code copied" : "Copy failed");
                    }}
                  >
                    Copy Embed Code
                  </button>
                  <button
                    type="button"
                    style={{ ...S.secondaryBtn, padding: "8px 12px", fontSize: 13 }}
                    onClick={() => {
                      const name = embed.label || "this embed";
                      const ok = window.confirm(
                        `Duplicate ${name}? This will create a new viewer link with the same name and description.`,
                      );
                      if (!ok) return;
                      (async () => {
                        setListMessage(null);
                        setListError(null);
                        try {
                          const res = await fetch(`${API_BASE}/api/saved-embeds`, {
                            method: "POST",
                            credentials: "include",
                            headers: buildAuthHeaders(),
                            body: JSON.stringify({
                              name: `${embed.label} (Copy)`,
                            }),
                          });
                          const payload = await res.json().catch(() => null);
                          if (!res.ok) {
                            throw new Error(payload?.error || "Failed to duplicate embed");
                          }
                          setListMessage("Duplicated");
                          await loadEmbeds({ keepSelection: true });
                        } catch (e: any) {
                          setListError(e?.message || "Failed to duplicate embed");
                        }
                      })();
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    style={{ ...S.secondaryBtn, padding: "8px 12px", fontSize: 13, borderColor: "rgba(239,68,68,0.7)", color: "#fecaca" }}
                    onClick={() => handleDelete(embed)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit Saved Embed Modal */}
      {editingEmbed && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(8px)",
          }}
          onClick={() => {
            if (!editSaving) {
              setEditingEmbed(null);
            }
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 420,
              background: "rgba(15,15,15,0.95)",
              borderRadius: 16,
              padding: 20,
              border: "1px solid rgba(148,163,184,0.5)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
              color: "#e5e7eb",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Edit Saved Embed</div>
              <button
                type="button"
                onClick={() => !editSaving && setEditingEmbed(null)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#9ca3af",
                  cursor: editSaving ? "not-allowed" : "pointer",
                  fontSize: 18,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            {editError && (
              <div
                style={{
                  marginBottom: 10,
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "rgba(239,68,68,0.12)",
                  border: "1px solid rgba(239,68,68,0.35)",
                  color: "#fca5a5",
                  fontSize: 13,
                }}
              >
                {editError}
              </div>
            )}

            <form onSubmit={handleEditSave} style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ fontSize: 12, color: "#9ca3af", fontWeight: 800 }}>Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={60}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(63,63,70,0.6)",
                    background: "rgba(0,0,0,0.25)",
                    color: "#e5e7eb",
                    fontSize: 13,
                  }}
                />
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ fontSize: 12, color: "#9ca3af", fontWeight: 800 }}>Description (optional)</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  maxLength={200}
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(63,63,70,0.6)",
                    background: "rgba(0,0,0,0.25)",
                    color: "#e5e7eb",
                    fontSize: 13,
                    resize: "vertical",
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                <div style={{ fontSize: 11, color: "#6b7280" }}>
                  <span>{60 - editName.length}</span> name characters left · <span>{200 - editDescription.length}</span> description characters left
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => !editSaving && setEditingEmbed(null)}
                    style={{
                      ...S.secondaryBtn,
                      padding: "8px 14px",
                      fontSize: 13,
                    }}
                    disabled={editSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editSaving || isEditUnchanged}
                    style={{
                      ...S.primaryBtn,
                      padding: "8px 16px",
                      fontSize: 13,
                    }}
                  >
                    {editSaving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
