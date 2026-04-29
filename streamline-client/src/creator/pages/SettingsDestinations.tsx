import { useEffect, useState } from "react";
import { fetchDestinations, createDestination, validateDestinationPreCreate, preflight, updateDestination, deleteDestination, type DestinationItem } from "../../services/destinations";
import { getMeCached } from "../../lib/meCache";
import { useFeatureAccess } from "../../hooks/useFeatureAccess";

function StatusBadge({ status, reason }: { status: string; reason?: string | null }) {
  const color = status === "connected" ? "#16a34a" : status === "disconnected" ? "#6b7280" : "#f59e0b";
  return (
    <span style={{ padding: "2px 8px", borderRadius: 12, background: color, color: "white", fontSize: 12 }}>
      {status}{reason ? ` • ${reason}` : ""}
    </span>
  );
}

export default function SettingsDestinations(
  props: {
    locked?: boolean;
    lockReason?: string;
    onUpgrade?: () => void;
  } = {}
) {
  const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
  const [effectiveEntitlements, setEffectiveEntitlements] = useState<any | null>(null);
  const { access } = useFeatureAccess(effectiveEntitlements);

  const locked = props.locked ?? !access.plan.destinations;
  const lockReason = props.lockReason || "Stream Destinations are not included in your current plan.";
  const [items, setItems] = useState<DestinationItem[]>([]);
  const [usedCount, setUsedCount] = useState<number | undefined>(undefined);
  const [limit, setLimit] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectedPlatforms, setConnectedPlatforms] = useState<{ youtube: boolean; facebook: boolean; twitch: boolean }>({ youtube: false, facebook: false, twitch: false });

  const platformDisabled = access.platform.transcodeEnabled === false;

  const [platform, setPlatform] = useState("youtube");
  const [mode, setMode] = useState<"manual" | "connected">("manual");
  const [name, setName] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [persistent, setPersistent] = useState(true);
  const [validation, setValidation] = useState<{ status: string; statusReason?: string | null } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ platform: string; name: string; rtmpUrlBase: string; streamKeyPlain: string; persistent: boolean; mode: "manual" | "connected" }>(
    { platform: "youtube", name: "", rtmpUrlBase: "", streamKeyPlain: "", persistent: true, mode: "manual" }
  );

  function getDefaultRtmpBase(p: string): string {
    switch (p) {
      case "youtube":
        return "rtmp://a.rtmp.youtube.com/live2";
      case "facebook":
        return "rtmps://live-api-s.facebook.com:443/rtmp/";
      case "twitch":
        return "rtmp://live.twitch.tv/app";
      default:
        return "rtmp://example.com/live";
    }
  }

  async function load() {
    try {
      setLoading(true);
      const res = await fetchDestinations({ includeDisabled: true });
      setItems(res.items);
      setUsedCount(res.usedCount);
      setLimit(res.limit);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!locked && !platformDisabled) {
      load();
    }
    const loadAccount = async () => {
      try {
        const data = await getMeCached();
        if (typeof props.locked === "undefined") {
          setEffectiveEntitlements(data?.effectiveEntitlements || data?.entitlements || null);
        }
        if (data?.connectedPlatforms) {
          setConnectedPlatforms({
            youtube: !!data.connectedPlatforms.youtube,
            facebook: !!data.connectedPlatforms.facebook,
            twitch: !!data.connectedPlatforms.twitch,
          });
        }
      } catch {
        // ignore
      }
    };
    loadAccount();
  }, [locked, platformDisabled, props.locked]);

  if (platformDisabled) {
    return (
      <div
        style={{
          border: "1px solid rgba(148,163,184,0.25)",
          borderRadius: 12,
          padding: 16,
          background: "rgba(15,23,42,0.35)",
          color: "#e5e7eb",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Stream Destinations</div>
        <div
          style={{
            fontSize: 13,
            color: "#cbd5e1",
            lineHeight: 1.4,
          }}
        >
          Stream Destinations are temporarily disabled by the platform.
        </div>
      </div>
    );
  }

  if (locked) {
    return (
      <div style={{
        border: "1px solid rgba(148,163,184,0.25)",
        borderRadius: 12,
        padding: 16,
        background: "rgba(15,23,42,0.35)",
        color: "#e5e7eb",
      }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>Stream Keys</div>
        <div style={{
          fontSize: 13,
          color: "#cbd5e1",
          lineHeight: 1.4,
          marginBottom: 12,
        }}>
          {lockReason}
        </div>
        <button
          type="button"
          onClick={() => props.onUpgrade?.()}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(59,130,246,0.45)",
            background: "rgba(37,99,235,0.20)",
            color: "#bfdbfe",
            fontWeight: 800,
            cursor: props.onUpgrade ? "pointer" : "default",
          }}
          disabled={!props.onUpgrade}
        >
          Upgrade
        </button>
      </div>
    );
  }

  async function onValidate() {
    setError(null);
    try {
      const base = getDefaultRtmpBase(platform);
      const res = await validateDestinationPreCreate({ platform, rtmpUrlBase: base, streamKeyPlain: streamKey || undefined });
      setValidation({ status: res.status, statusReason: res.statusReason ?? null });
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const base = getDefaultRtmpBase(platform);
      const res = await createDestination({ platform, name, rtmpUrlBase: base, streamKeyPlain: streamKey || undefined, mode, persistent });
      // After creating, clear validation so the form is "fresh" for the next key
      setValidation(null);
      setUsedCount(res.usedCount);
      setLimit(res.limit);
      setPlatform("youtube");
      setMode("manual");
      setName("");
      setStreamKey("");
      setPersistent(true);
      await load();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function onDelete(id: string) {
    setError(null);
    try {
      await deleteDestination(id);
      setItems(prev => {
        const filtered = prev.filter(i => i.id !== id);
        const newUsed = filtered.filter(i => i.enabled).length;
        setUsedCount(newUsed);
        return filtered;
      });
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  function onStartEdit(item: DestinationItem) {
    setError(null);
    setEditingId(item.id);
    setEditForm({
      platform: item.platform,
      name: item.name || "",
      rtmpUrlBase: item.rtmpUrlBase,
      streamKeyPlain: "",
      persistent: item.persistent !== false,
      mode: item.mode === "connected" ? "connected" : "manual",
    });
  }

  function onCancelEdit() {
    setEditingId(null);
    setEditForm({ platform: "youtube", name: "", rtmpUrlBase: "", streamKeyPlain: "", persistent: true, mode: "manual" });
  }

  async function onSaveEdit(id: string) {
    setError(null);
    try {
      const payload: any = {
        platform: editForm.platform,
        name: editForm.name,
        rtmpUrlBase: editForm.rtmpUrlBase,
        persistent: editForm.persistent,
        mode: editForm.mode,
      };
      if (editForm.streamKeyPlain.trim()) payload.streamKeyPlain = editForm.streamKeyPlain.trim();
      const res = await updateDestination(id, payload);
      setItems(prev => prev.map(i => (i.id === id ? res.destination : i)));
      if (typeof res.usedCount !== "undefined") setUsedCount(res.usedCount);
      if (typeof res.limit !== "undefined") setLimit(res.limit);
      setEditingId(null);
      setEditForm({ platform: "youtube", name: "", rtmpUrlBase: "", streamKeyPlain: "", persistent: true, mode: "manual" });
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function onClearKey(id: string) {
    setError(null);
    const confirmClear = window.confirm("Clear the stored stream key for this stream destination?");
    if (!confirmClear) return;
    try {
      const res = await updateDestination(id, { streamKeyPlain: "" });
      setItems(prev => prev.map(i => (i.id === id ? res.destination : i)));
      if (typeof res.usedCount !== "undefined") setUsedCount(res.usedCount);
      if (typeof res.limit !== "undefined") setLimit(res.limit);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function onPreflight() {
    setError(null);
    try {
      const res = await preflight({});
      alert(`Preflight: ${res.destinations.map(d => `${d.platform}:${d.status}`).join(", ")}`);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  return (
    <div style={{ maxWidth: 1040, margin: "32px auto", padding: "0 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Stream Destinations</h1>
          <p style={{ marginTop: 4, fontSize: 13, color: "#6b7280", maxWidth: 520 }}>
            Configure where StreamLine sends your live stream. Add YouTube, Facebook, Twitch, or custom destinations
            (RTMP) and save your stream keys once here for one-click Go Live in the room.
          </p>
        </div>
        <div style={{ textAlign: "right", fontSize: 12, color: "#6b7280" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Stream Destinations</div>
          <div>
            Used <span style={{ fontWeight: 600 }}>{typeof usedCount !== "undefined" ? usedCount : "—"}</span>
            {" / "}
            <span>{typeof limit !== "undefined" ? limit : "Plan limit"}</span>
          </div>
        </div>
      </div>

      {/* Main layout: stack add form and existing destinations */}
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Top: add / validate destination */}
        <div
          style={{
            padding: 16,
            borderRadius: 16,
            border: "1px solid rgba(248, 113, 113, 0.7)",
            background: "linear-gradient(135deg, rgba(24, 24, 27, 0.92), rgba(127, 29, 29, 0.9))",
            boxShadow: "0 18px 45px rgba(0,0,0,0.65)",
            backdropFilter: "blur(20px)",
            color: "#f9fafb",
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Add Stream Destination</h3>
          <p style={{ fontSize: 12, color: "#e5e7eb", marginBottom: 12 }}>
            Paste your stream key from your platform. Keys are stored encrypted and will be used automatically when
            you go live.
          </p>
          {platform === "facebook" && (
            <div style={{ fontSize: 11, color: "#cbd5e1", marginBottom: 10 }}>
              Facebook may require a new stream key for scheduled events. Make sure this key is current.
            </div>
          )}

        {validation && (
          <div style={{ marginBottom: 8 }}>
            <StatusBadge status={validation.status} reason={validation.statusReason || undefined} />
          </div>
        )}
        <form onSubmit={onCreate} autoComplete="off">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
            {/* Autofill decoy to absorb email/username autofill */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              style={{ display: "none" }}
            />
            <select
              value={platform}
              onChange={e => setPlatform(e.target.value)}
              style={{
                border: "1px solid rgba(248, 250, 252, 0.2)",
                borderRadius: 6,
                padding: "6px 8px",
                color: "#f9fafb",
                background: "rgba(15, 23, 42, 0.7)",
              }}
            >
              <option value="youtube">YouTube</option>
              <option value="facebook">Facebook</option>
              <option value="twitch">Twitch</option>
              <option value="custom">Custom</option>
            </select>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Main YouTube channel (optional)"
              style={{
                border: "1px solid rgba(248, 250, 252, 0.2)",
                borderRadius: 6,
                padding: "6px 8px",
                color: "#f9fafb",
                background: "rgba(15, 23, 42, 0.7)",
              }}
            />
            <input
              type="password"
              name="streamKey"
              id="stream-destination-stream-key"
              value={streamKey}
              onChange={e => setStreamKey(e.target.value)}
              placeholder="Enter stream key (optional, stored encrypted)"
              style={{
                border: "1px solid rgba(248, 250, 252, 0.2)",
                borderRadius: 6,
                padding: "6px 8px",
                color: "#f9fafb",
                background: "rgba(15, 23, 42, 0.7)",
              }}
              autoComplete="new-password"
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#e5e7eb" }}>
                <span>Mode:</span>
                <select
                  value={mode}
                  onChange={e => setMode(e.target.value as any)}
                  style={{
                    border: "1px solid rgba(248, 250, 252, 0.2)",
                    borderRadius: 6,
                    padding: "4px 6px",
                    color: "#f9fafb",
                    background: "rgba(15, 23, 42, 0.7)",
                  }}
                >
                  <option value="manual">Manual key</option>
                  <option value="connected" disabled={!connectedPlatforms[platform as keyof typeof connectedPlatforms]}>Connected</option>
                </select>
              </label>
              {!connectedPlatforms[platform as keyof typeof connectedPlatforms] && (
                <button
                  type="button"
                  onClick={() => window.location.assign("/settings/integrations")}
                  style={{
                    fontSize: 12,
                    borderRadius: 999,
                    padding: "4px 10px",
                    border: "1px solid rgba(248, 113, 113, 0.6)",
                    background: "transparent",
                    color: "#fecaca",
                    cursor: "pointer",
                  }}
                >
                  Connect {platform}
                </button>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#e5e7eb" }}>
                <input
                  type="checkbox"
                  checked={persistent}
                  onChange={e => setPersistent(e.target.checked)}
                />
                <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
                  <strong style={{ fontWeight: 600 }}>Save stream for reuse</strong>
                  <span style={{ color: "#cbd5e1" }}>Recommended for scheduled streams </span>
                </span>
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={onValidate}
                style={{
                  borderRadius: 999,
                  padding: "6px 12px",
                  border: "1px solid rgba(248, 113, 113, 0.8)",
                  background: "transparent",
                  color: "#fecaca",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Validate
              </button>
              <button
                type="submit"
                style={{
                  borderRadius: 999,
                  padding: "6px 14px",
                  border: "none",
                  background: "linear-gradient(135deg,#ef4444,#b91c1c)",
                  color: "white",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Create
              </button>
            </div>
          </div>
        </form>
        {error && <div style={{ color: "#b91c1c" }}>{error}</div>}
        </div>

        {/* Below: existing destinations list */}
        <div
          style={{
            padding: 16,
            borderRadius: 16,
            border: "1px solid rgba(248, 113, 113, 0.7)",
            background: "linear-gradient(135deg, rgba(24, 24, 27, 0.9), rgba(127, 29, 29, 0.85))",
            boxShadow: "0 18px 45px rgba(0,0,0,0.65)",
            backdropFilter: "blur(20px)",
            color: "#f9fafb",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Saved Stream Destinations</h3>
            <button
              onClick={onPreflight}
              style={{
                fontSize: 12,
                borderRadius: 999,
                padding: "4px 10px",
                border: "1px solid rgba(248, 250, 252, 0.25)",
                background: "rgba(15, 23, 42, 0.7)",
                color: "#e5e7eb",
                cursor: "pointer",
              }}
            >
              Run Preflight
            </button>
          </div>
          {loading ? (
            <div style={{ padding: 12, fontSize: 13 }}>Loading…</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 12, fontSize: 13, color: "#e5e7eb" }}>
              No stream destinations yet. Add YouTube, Facebook, Twitch, or a custom destination (RTMP) above to
              reuse it from the room.
            </div>
          ) : (
            <div style={{ width: "100%" }}>
              <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(248, 250, 252, 0.1)" }}>
                    <th align="left" style={{ padding: "6px 6px", color: "#e5e7eb", whiteSpace: "normal", wordBreak: "break-word" }}>Platform</th>
                    <th align="left" style={{ padding: "6px 6px", color: "#e5e7eb", whiteSpace: "normal", wordBreak: "break-word" }}>Name</th>
                    <th align="left" style={{ padding: "6px 6px", color: "#e5e7eb", wordBreak: "break-word" }}>Base</th>
                    <th align="left" style={{ padding: "6px 6px", color: "#e5e7eb", whiteSpace: "normal", wordBreak: "break-word" }}>Status</th>
                    <th align="left" style={{ padding: "6px 6px", color: "#e5e7eb", whiteSpace: "normal", wordBreak: "break-word", minWidth: 120 }}>Key</th>
                    <th align="left" style={{ padding: "6px 6px", color: "#e5e7eb", whiteSpace: "normal", wordBreak: "break-word" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} style={{ borderBottom: "1px solid rgba(248, 250, 252, 0.06)" }}>
                      <td style={{ padding: "6px 6px", textTransform: "capitalize", color: "#f9fafb", whiteSpace: "normal", wordBreak: "break-word" }}>
                        {editingId === item.id ? (
                          <select
                            value={editForm.platform}
                            onChange={e => setEditForm(f => ({ ...f, platform: e.target.value }))}
                            style={{
                              border: "1px solid rgba(248, 250, 252, 0.2)",
                              borderRadius: 6,
                              padding: "4px 6px",
                              color: "#f9fafb",
                              background: "rgba(15, 23, 42, 0.7)",
                            }}
                          >
                            <option value="youtube">YouTube</option>
                            <option value="facebook">Facebook</option>
                            <option value="twitch">Twitch</option>
                            <option value="custom">Custom</option>
                          </select>
                        ) : (
                          item.platform
                        )}
                      </td>
                      <td style={{ padding: "6px 6px", color: "#e5e7eb", wordBreak: "break-word", whiteSpace: "normal" }}>
                        {editingId === item.id ? (
                          <input
                            value={editForm.name}
                            onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="Optional name"
                            style={{
                              border: "1px solid rgba(248, 250, 252, 0.2)",
                              borderRadius: 6,
                              padding: "4px 6px",
                              color: "#f9fafb",
                              background: "rgba(15, 23, 42, 0.7)",
                              width: "100%",
                            }}
                          />
                        ) : (
                          item.name || "—"
                        )}
                      </td>
                      <td style={{ padding: "6px 6px", fontFamily: "monospace", fontSize: 12, color: "#e5e7eb", wordBreak: "break-all" }}>
                        {editingId === item.id ? (
                          <input
                            value={editForm.rtmpUrlBase}
                            onChange={e => setEditForm(f => ({ ...f, rtmpUrlBase: e.target.value }))}
                            placeholder="rtmp://..."
                            style={{
                              border: "1px solid rgba(248, 250, 252, 0.2)",
                              borderRadius: 6,
                              padding: "4px 6px",
                              color: "#f9fafb",
                              background: "rgba(15, 23, 42, 0.7)",
                              width: "100%",
                            }}
                          />
                        ) : (
                          // Show a high-level label instead of the full RTMP URL for on-screen safety
                          item.platform === "youtube"
                            ? "YouTube default"
                            : item.platform === "facebook"
                            ? "Facebook default"
                            : item.platform === "twitch"
                            ? "Twitch default"
                            : "Custom endpoint (RTMP)"
                        )}
                      </td>
                      <td style={{ padding: "6px 6px" }}>
                        <StatusBadge status={item.status} reason={item.statusReason || undefined} />
                      </td>
                      <td style={{ padding: "6px 6px", color: "#e5e7eb", whiteSpace: "normal", wordBreak: "normal", minWidth: 140 }}>
                        {editingId === item.id ? (
                          <input
                            type="password"
                            name="streamKey"
                            id={`stream-destination-stream-key-${item.id}`}
                            value={editForm.streamKeyPlain}
                            onChange={e => setEditForm(f => ({ ...f, streamKeyPlain: e.target.value }))}
                            placeholder={item.hasKey ? "Enter new key (stored encrypted, never shown)" : "Enter new key"}
                            style={{
                              border: "1px solid rgba(248, 250, 252, 0.2)",
                              borderRadius: 6,
                              padding: "4px 6px",
                              color: "#f9fafb",
                              background: "rgba(15, 23, 42, 0.7)",
                              width: "100%",
                              minWidth: 100,
                              maxWidth: 140,
                            }}
                            autoComplete="new-password"
                          />
                        ) : (
                          // Do not show any part of the stored key; only indicate presence
                          item.hasKey ? "Saved (hidden)" : "No key saved"
                        )}
                        {editingId === item.id ? null : null}
                      </td>
                      <td style={{ padding: "6px 6px", whiteSpace: "normal", wordBreak: "break-word" }}>
                        {editingId === item.id ? (
                          <>
                            <button
                              onClick={() => onSaveEdit(item.id)}
                              style={{
                                fontSize: 12,
                                color: "#16a34a",
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                marginRight: 8,
                                padding: 0,
                                fontWeight: 600,
                              }}
                            >
                              Save
                            </button>
                            <button
                              onClick={onCancelEdit}
                              style={{
                                fontSize: 12,
                                color: "#e5e7eb",
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                padding: 0,
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => onStartEdit(item)}
                              style={{
                                fontSize: 12,
                                color: "#e5e7eb",
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                marginRight: 8,
                                padding: 0,
                              }}
                            >
                              Edit
                            </button>
                            {item.hasKey && (
                              <button
                                onClick={() => onClearKey(item.id)}
                                style={{
                                  fontSize: 12,
                                  color: "#e5e7eb",
                                  border: "none",
                                  background: "transparent",
                                  cursor: "pointer",
                                  marginRight: 8,
                                  padding: 0,
                                }}
                              >
                                Clear Key
                              </button>
                            )}
                            <button
                              onClick={() => onDelete(item.id)}
                              style={{
                                fontSize: 12,
                                color: "#fecaca",
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                padding: 0,
                              }}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
