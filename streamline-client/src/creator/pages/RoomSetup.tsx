import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthMe } from "../../hooks/useAuthMe";
import { useEffectiveEntitlements } from "../../hooks/useEffectiveEntitlements";
import {
  apiGetRoomCustomization,
  apiUpdateRoomCustomization,
  type RoomCustomizationConfig,
} from "../../lib/api";
import { getPlatformFlagsValue } from "../../lib/platformFlagsStore";

/**
 * RoomSetup — Pre-stream host customization page.
 *
 * Route: /rooms/:roomId/setup
 *
 * Host-only. Allows the host to configure room appearance before starting.
 * Feature-gated by platformFlags.roomCustomizationEnabled AND
 * plan feature canCustomizeRooms. Both must be true to access this page.
 *
 * Phase 2: save-only, no live rendering yet.
 */

type LayoutStyle = NonNullable<RoomCustomizationConfig["layoutStyle"]>;

const LAYOUT_OPTIONS: { value: LayoutStyle; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "speaker", label: "Speaker Focus" },
  { value: "grid", label: "Grid" },
  { value: "host-focus", label: "Host Focus" },
];

export default function RoomSetup() {
  const nav = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();
  const { user: authUser, loading: authLoading } = useAuthMe();
  const { effectiveEntitlements } = useEffectiveEntitlements();

  const [customization, setCustomization] = useState<RoomCustomizationConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Feature gate check
  const platformFlags = getPlatformFlagsValue() || {};
  const platformEnabled = platformFlags.roomCustomizationEnabled === true;
  const planEnabled = !!(effectiveEntitlements as any)?.features?.canCustomizeRooms;
  const featureActive = platformEnabled && planEnabled;

  const isOwner = !!authUser && !authLoading;

  useEffect(() => {
    if (!roomId || !isOwner) return;
    if (!featureActive) {
      setLoading(false);
      return;
    }

    apiGetRoomCustomization(roomId)
      .then((data) => {
        setCustomization(data.customization || {});
      })
      .catch((err) => {
        console.error("[RoomSetup] Failed to load customization", err);
      })
      .finally(() => setLoading(false));
  }, [roomId, isOwner, featureActive]);

  const handleSave = useCallback(async () => {
    if (!roomId || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const result = await apiUpdateRoomCustomization(roomId, customization);
      setCustomization(result.customization || {});
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setSaveError(err?.message || "Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [roomId, customization, saving]);

  const handleGoLive = () => {
    if (!roomId) return;
    nav(`/room/${encodeURIComponent(roomId)}`);
  };

  const handleBack = () => nav("/join");

  // ─── Loading / auth guard ────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={styles.page}>
        <div style={styles.loadingText}>Loading…</div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <p style={styles.errorText}>You must be signed in to access room setup.</p>
          <button style={styles.btnSecondary} onClick={() => nav("/join")}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ─── Feature gate ────────────────────────────────────────────────────────
  if (!featureActive) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h2 style={styles.heading}>Room Setup</h2>
          <p style={styles.mutedText}>
            Room customization is not available on your current plan or is not enabled on this
            platform. Upgrade your plan or contact your administrator to access this feature.
          </p>
          <button style={styles.btnSecondary} onClick={handleBack}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!roomId) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <p style={styles.errorText}>Invalid room ID.</p>
          <button style={styles.btnSecondary} onClick={handleBack}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.loadingText}>Loading room settings…</div>
      </div>
    );
  }

  // ─── Main setup form ─────────────────────────────────────────────────────
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <button style={styles.backLink} onClick={handleBack}>
            ← Dashboard
          </button>
          <h1 style={styles.title}>Room Setup</h1>
          <p style={styles.subtitle}>Configure your room before going live.</p>
        </div>

        {/* ── Layout Style ── */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Layout Style</h2>
          <div style={styles.radioGroup}>
            {LAYOUT_OPTIONS.map((opt) => (
              <label key={opt.value} style={styles.radioLabel}>
                <input
                  type="radio"
                  name="layoutStyle"
                  value={opt.value}
                  checked={(customization.layoutStyle || "default") === opt.value}
                  onChange={() =>
                    setCustomization((prev) => ({ ...prev, layoutStyle: opt.value }))
                  }
                  style={styles.radioInput}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </section>

        {/* ── Banner ── */}
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <h2 style={styles.sectionTitle}>Banner</h2>
            <label style={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={customization.banner?.enabled === true}
                onChange={(e) =>
                  setCustomization((prev) => ({
                    ...prev,
                    banner: { url: "", position: "bottom", height: 80, opacity: 1, ...prev.banner, enabled: e.target.checked },
                  }))
                }
              />
              {" "}Enabled
            </label>
          </div>
          {customization.banner?.enabled && (
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Banner URL</label>
              <input
                type="url"
                style={styles.input}
                placeholder="https://example.com/banner.png"
                value={customization.banner?.url || ""}
                onChange={(e) =>
                  setCustomization((prev) => ({
                    ...prev,
                    banner: { position: "bottom", height: 80, opacity: 1, ...prev.banner, enabled: true, url: e.target.value },
                  }))
                }
              />
              <label style={styles.fieldLabel}>Position</label>
              <select
                style={styles.select}
                value={customization.banner?.position || "bottom"}
                onChange={(e) =>
                  setCustomization((prev) => ({
                    ...prev,
                    banner: { url: "", height: 80, opacity: 1, ...prev.banner, enabled: true, position: e.target.value as "top" | "bottom" },
                  }))
                }
              >
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
              </select>
            </div>
          )}
        </section>

        {/* ── Background ── */}
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <h2 style={styles.sectionTitle}>Room Background</h2>
            <label style={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={customization.roomBackground?.enabled === true}
                onChange={(e) =>
                  setCustomization((prev) => ({
                    ...prev,
                    roomBackground: { type: "solid", ...prev.roomBackground, enabled: e.target.checked },
                  }))
                }
              />
              {" "}Enabled
            </label>
          </div>
          {customization.roomBackground?.enabled && (
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Type</label>
              <select
                style={styles.select}
                value={customization.roomBackground?.type || "solid"}
                onChange={(e) =>
                  setCustomization((prev) => ({
                    ...prev,
                    roomBackground: { ...prev.roomBackground, enabled: true, type: e.target.value as "image" | "gradient" | "solid" },
                  }))
                }
              >
                <option value="solid">Solid Color</option>
                <option value="gradient">Gradient</option>
                <option value="image">Image URL</option>
              </select>
              {customization.roomBackground?.type === "image" && (
                <>
                  <label style={styles.fieldLabel}>Image URL</label>
                  <input
                    type="url"
                    style={styles.input}
                    placeholder="https://example.com/bg.jpg"
                    value={customization.roomBackground?.url || ""}
                    onChange={(e) =>
                      setCustomization((prev) => ({
                        ...prev,
                        roomBackground: { type: "image", ...prev.roomBackground, enabled: true, url: e.target.value },
                      }))
                    }
                  />
                </>
              )}
              {(customization.roomBackground?.type === "solid" ||
                customization.roomBackground?.type === "gradient") && (
                <>
                  <label style={styles.fieldLabel}>Value (CSS color or gradient)</label>
                  <input
                    type="text"
                    style={styles.input}
                    placeholder="#000000"
                    value={customization.roomBackground?.value || ""}
                    onChange={(e) =>
                      setCustomization((prev) => ({
                        ...prev,
                        roomBackground: { type: "solid", ...prev.roomBackground, enabled: true, value: e.target.value },
                      }))
                    }
                  />
                </>
              )}
            </div>
          )}
        </section>

        {/* ── Placeholder Media ── */}
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <h2 style={styles.sectionTitle}>Offline Placeholder</h2>
            <label style={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={customization.placeholderMedia?.enabled === true}
                onChange={(e) =>
                  setCustomization((prev) => ({
                    ...prev,
                    placeholderMedia: { imageUrl: "", ...prev.placeholderMedia, enabled: e.target.checked },
                  }))
                }
              />
              {" "}Enabled
            </label>
          </div>
          {customization.placeholderMedia?.enabled && (
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Image URL</label>
              <input
                type="url"
                style={styles.input}
                placeholder="https://example.com/placeholder.png"
                value={customization.placeholderMedia?.imageUrl || ""}
                onChange={(e) =>
                  setCustomization((prev) => ({
                    ...prev,
                    placeholderMedia: { imageUrl: e.target.value, ...prev.placeholderMedia, enabled: true },
                  }))
                }
              />
              <label style={styles.fieldLabel}>Title (optional)</label>
              <input
                type="text"
                style={styles.input}
                placeholder="Coming soon…"
                value={customization.placeholderMedia?.title || ""}
                onChange={(e) =>
                  setCustomization((prev) => ({
                    ...prev,
                    placeholderMedia: { imageUrl: "", ...prev.placeholderMedia, enabled: true, title: e.target.value },
                  }))
                }
              />
              <label style={styles.fieldLabel}>Subtitle (optional)</label>
              <input
                type="text"
                style={styles.input}
                placeholder="Stream starts soon"
                value={customization.placeholderMedia?.subtitle || ""}
                onChange={(e) =>
                  setCustomization((prev) => ({
                    ...prev,
                    placeholderMedia: { imageUrl: "", ...prev.placeholderMedia, enabled: true, subtitle: e.target.value },
                  }))
                }
              />
            </div>
          )}
        </section>

        {/* ── Greenroom Waiting Room Text ── */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Waiting Room Appearance</h2>
          <p style={styles.mutedText}>
            Shown to guests in the greenroom waiting area (requires Greenroom feature).
          </p>
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>Waiting Room Message</label>
            <input
              type="text"
              style={styles.input}
              placeholder="We'll be starting soon…"
              value={customization.greenroom?.waitingRoomMessage || ""}
              onChange={(e) =>
                setCustomization((prev) => ({
                  ...prev,
                  greenroom: { ...prev.greenroom, waitingRoomMessage: e.target.value },
                }))
              }
            />
          </div>
        </section>

        {/* ── Save / Actions ── */}
        {saveError && <p style={styles.errorText}>{saveError}</p>}
        {saveSuccess && <p style={styles.successText}>Settings saved successfully.</p>}

        <div style={styles.actions}>
          <button style={styles.btnSecondary} onClick={handleBack} disabled={saving}>
            Back to Dashboard
          </button>
          <button style={styles.btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Settings"}
          </button>
          <button style={styles.btnAccent} onClick={handleGoLive} disabled={saving}>
            Enter Room →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inline styles (matches StreamLine's dark glassmorphism theme) ─────────
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#0a0a0f",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "40px 16px",
    fontFamily: "inherit",
    color: "#e0e0e0",
  },
  card: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "16px",
    padding: "32px",
    width: "100%",
    maxWidth: "720px",
    backdropFilter: "blur(12px)",
  },
  header: {
    marginBottom: "32px",
  },
  backLink: {
    background: "none",
    border: "none",
    color: "#888",
    cursor: "pointer",
    fontSize: "14px",
    padding: "0",
    marginBottom: "12px",
    display: "block",
  },
  title: {
    fontSize: "28px",
    fontWeight: 700,
    color: "#fff",
    margin: "0 0 8px",
  },
  subtitle: {
    color: "#888",
    margin: 0,
    fontSize: "15px",
  },
  heading: {
    fontSize: "22px",
    fontWeight: 600,
    color: "#fff",
    margin: "0 0 12px",
  },
  section: {
    borderTop: "1px solid rgba(255,255,255,0.07)",
    paddingTop: "24px",
    marginBottom: "24px",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "12px",
  },
  sectionTitle: {
    fontSize: "16px",
    fontWeight: 600,
    color: "#ccc",
    margin: 0,
  },
  toggleLabel: {
    fontSize: "14px",
    color: "#aaa",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    marginTop: "12px",
  },
  fieldLabel: {
    fontSize: "13px",
    color: "#888",
    marginBottom: "2px",
  },
  input: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "8px",
    color: "#e0e0e0",
    fontSize: "14px",
    padding: "8px 12px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  select: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "8px",
    color: "#e0e0e0",
    fontSize: "14px",
    padding: "8px 12px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  radioGroup: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    marginTop: "8px",
  },
  radioLabel: {
    fontSize: "14px",
    color: "#bbb",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  radioInput: {
    cursor: "pointer",
  },
  actions: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
    marginTop: "32px",
    borderTop: "1px solid rgba(255,255,255,0.07)",
    paddingTop: "24px",
  },
  btnPrimary: {
    background: "#c00",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    padding: "10px 24px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
  },
  btnSecondary: {
    background: "rgba(255,255,255,0.08)",
    color: "#ccc",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "8px",
    padding: "10px 20px",
    fontSize: "15px",
    cursor: "pointer",
  },
  btnAccent: {
    background: "rgba(200,0,0,0.15)",
    color: "#ff6666",
    border: "1px solid rgba(200,0,0,0.3)",
    borderRadius: "8px",
    padding: "10px 20px",
    fontSize: "15px",
    cursor: "pointer",
    marginLeft: "auto",
  },
  mutedText: {
    color: "#666",
    fontSize: "13px",
    margin: "4px 0 0",
  },
  loadingText: {
    color: "#888",
    fontSize: "16px",
    padding: "40px",
    textAlign: "center",
  },
  errorText: {
    color: "#ff6666",
    fontSize: "14px",
    margin: "0 0 12px",
  },
  successText: {
    color: "#66cc66",
    fontSize: "14px",
    margin: "0 0 12px",
  },
};
