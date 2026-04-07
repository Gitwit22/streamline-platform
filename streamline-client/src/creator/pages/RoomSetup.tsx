import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuthMe } from "../../hooks/useAuthMe";
import { useEffectiveEntitlements } from "../../hooks/useEffectiveEntitlements";
import {
  apiGetRoomCustomization,
  apiUpdateRoomCustomization,
  type RoomCustomizationConfig,
  apiFetch,
  apiFetchAuth,
} from "../../lib/api";
import { getPlatformFlagsValue, setPlatformFlagsValue } from "../../lib/platformFlagsStore";

/**
 * RoomSetup — Pre-stream host customization page.
 *
 * Route: /rooms/:roomId/setup
 *
 * Host-only. Allows the host to configure room appearance before starting.
 * Feature-gated by platformFlags.roomCustomizationEnabled AND
 * plan feature canCustomizeRooms. Both must be true to access this page.
 *
 * Phase 4: layout preview cards, intro clip config + preview controls.
 */

type LayoutStyle = NonNullable<RoomCustomizationConfig["layoutStyle"]>;

const LAYOUT_OPTIONS: { value: LayoutStyle; label: string; icon: string; desc: string }[] = [
  { value: "default", label: "Default", icon: "⬜", desc: "Standard balanced layout" },
  { value: "speaker", label: "Speaker Focus", icon: "🎤", desc: "Spotlight active speaker" },
  { value: "grid", label: "Grid", icon: "⊞", desc: "Equal tiles for all participants" },
  { value: "host-focus", label: "Host Focus", icon: "⭐", desc: "Host takes center stage" },
];

const BANNER_DEFAULTS = { url: "", position: "bottom" as const, height: 80, opacity: 1 };
const DEFAULT_TILE_SCALE = 0.8;
const DEFAULT_VERTICAL_OFFSET = 84;

function normalizeCustomization(input: RoomCustomizationConfig | null | undefined): RoomCustomizationConfig {
  const src = input || {};
  return {
    ...src,
    enabled: src.enabled === true,
    logoUrl: typeof src.logoUrl === "string" ? src.logoUrl : null,
    bannerUrl: typeof src.bannerUrl === "string" ? src.bannerUrl : null,
    backgroundMode:
      src.backgroundMode === "banner" || src.backgroundMode === "full" || src.backgroundMode === "none"
        ? src.backgroundMode
        : "none",
    tileScale:
      typeof src.tileScale === "number" && Number.isFinite(src.tileScale)
        ? Math.max(0.5, Math.min(1, src.tileScale))
        : DEFAULT_TILE_SCALE,
    verticalOffset:
      typeof src.verticalOffset === "number" && Number.isFinite(src.verticalOffset)
        ? Math.max(0, Math.min(320, Math.round(src.verticalOffset)))
        : DEFAULT_VERTICAL_OFFSET,
    logoAlignment:
      src.logoAlignment === "center" || src.logoAlignment === "right" ? src.logoAlignment : "left",
    bannerAlignment:
      src.bannerAlignment === "top" || src.bannerAlignment === "bottom" ? src.bannerAlignment : "center",
  };
}

export default function RoomSetup() {
  const nav = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const { user: authUser, loading: authLoading } = useAuthMe();
  const { effectiveEntitlements } = useEffectiveEntitlements();

  const [customization, setCustomization] = useState<RoomCustomizationConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Intro clip state
  const [introStatus, setIntroStatus] = useState<string>("idle");
  const [introLoading, setIntroLoading] = useState(false);

  // Feature gate check
  const [platformEnabled, setPlatformEnabled] = useState<boolean>(
    getPlatformFlagsValue()?.roomCustomizationEnabled === true
  );
  const planEnabled = !!(effectiveEntitlements as any)?.features?.canCustomizeRooms;
  const featureActive = platformEnabled && planEnabled;
  const introEnabled =
    platformFlags.roomIntroMediaV1 === true &&
    !!(effectiveEntitlements as any)?.features?.canUseIntroClip;

  const isOwner = !!authUser && !authLoading;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await apiFetchAuth("/api/account/me", {}, { allowNonOk: true });
        if (!res.ok) return;
        const me = await res.json().catch(() => null);
        if (cancelled || !me || typeof me !== "object") return;
        const platformFlags = (me as any).platformFlags || {};
        setPlatformFlagsValue(platformFlags);
        setPlatformEnabled(platformFlags.roomCustomizationEnabled === true);
      } catch {
        // Keep using whatever was in the shared store.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!roomId || !isOwner) return;
    if (!featureActive) {
      setLoading(false);
      return;
    }

    apiGetRoomCustomization(roomId)
      .then((data) => {
        setCustomization(normalizeCustomization(data.customization || {}));
      })
      .catch((err) => {
        console.error("[RoomSetup] Failed to load customization", err);
      })
      .finally(() => setLoading(false));
  }, [roomId, isOwner, featureActive]);

  // Fetch intro status when intro is enabled.
  useEffect(() => {
    if (!roomId || !isOwner || !introEnabled) return;
    apiFetch(`/api/rooms/${encodeURIComponent(roomId)}/intro/status`, {}, { allowNonOk: true })
      .then(async (r) => {
        const ct = r.headers.get("content-type") || "";
        if (!r.ok || !ct.includes("application/json")) return;
        const data = await r.json();
        if (data?.intro?.status) setIntroStatus(data.intro.status);
      })
      .catch(() => { /* silent */ });
  }, [roomId, isOwner, introEnabled]);

  const handleIntroPlay = useCallback(async () => {
    if (!roomId || introLoading) return;
    setIntroLoading(true);
    try {
      const res = await apiFetch(
        `/api/rooms/${encodeURIComponent(roomId)}/intro/play`,
        { method: "POST" },
        { allowNonOk: true }
      );
      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("application/json")) {
        const data = await res.json();
        setIntroStatus(data?.intro?.status ?? "playing");
      }
    } catch { /* silent */ } finally {
      setIntroLoading(false);
    }
  }, [roomId, introLoading]);

  const handleIntroSkip = useCallback(async () => {
    if (!roomId || introLoading) return;
    setIntroLoading(true);
    try {
      const res = await apiFetch(
        `/api/rooms/${encodeURIComponent(roomId)}/intro/skip`,
        { method: "POST" },
        { allowNonOk: true }
      );
      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("application/json")) {
        const data = await res.json();
        setIntroStatus(data?.intro?.status ?? "skipped");
      }
    } catch { /* silent */ } finally {
      setIntroLoading(false);
    }
  }, [roomId, introLoading]);

  const handleSave = useCallback(async () => {
    if (!roomId || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const result = await apiUpdateRoomCustomization(roomId, customization);
      setCustomization(normalizeCustomization(result.customization || {}));
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
    const next = (searchParams.get("next") || "").trim();
    if (next.startsWith("/")) {
      nav(next);
      return;
    }
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
        
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <h2 style={styles.sectionTitle}>Room Customization</h2>
            <label style={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={customization.enabled === true}
                onChange={(e) =>
                  setCustomization((prev) => ({
                    ...prev,
                    enabled: e.target.checked,
                  }))
                }
              />
              {" "}Enabled
            </label>
          </div>

          <p style={styles.mutedText}>
            Add room logo/banner and visual layout offsets. These values are reused for future joins.
          </p>

          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>Room Logo URL</label>
            <input
              type="url"
              style={styles.input}
              placeholder="https://example.com/logo.png"
              value={customization.logoUrl || ""}
              onChange={(e) =>
                setCustomization((prev) => ({
                  ...prev,
                  logoUrl: e.target.value || null,
                }))
              }
            />

            <label style={styles.fieldLabel}>Banner / Background URL</label>
            <input
              type="url"
              style={styles.input}
              placeholder="https://example.com/banner.jpg"
              value={customization.bannerUrl || ""}
              onChange={(e) =>
                setCustomization((prev) => ({
                  ...prev,
                  bannerUrl: e.target.value || null,
                }))
              }
            />

            <label style={styles.fieldLabel}>Background Mode</label>
            <select
              style={styles.select}
              value={customization.backgroundMode || "none"}
              onChange={(e) =>
                setCustomization((prev) => ({
                  ...prev,
                  backgroundMode: e.target.value as "banner" | "full" | "none",
                }))
              }
            >
              <option value="none">None</option>
              <option value="banner">Banner strip</option>
              <option value="full">Full background</option>
            </select>

            <label style={styles.fieldLabel}>
              Tile Scale ({(customization.tileScale ?? DEFAULT_TILE_SCALE).toFixed(2)})
            </label>
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.05}
              value={customization.tileScale ?? DEFAULT_TILE_SCALE}
              onChange={(e) =>
                setCustomization((prev) => ({
                  ...prev,
                  tileScale: Number(e.target.value),
                }))
              }
            />

            <label style={styles.fieldLabel}>
              Vertical Offset ({Math.round(customization.verticalOffset ?? DEFAULT_VERTICAL_OFFSET)}px)
            </label>
            <input
              type="range"
              min={0}
              max={220}
              step={4}
              value={customization.verticalOffset ?? DEFAULT_VERTICAL_OFFSET}
              onChange={(e) =>
                setCustomization((prev) => ({
                  ...prev,
                  verticalOffset: Number(e.target.value),
                }))
              }
            />

            <label style={styles.fieldLabel}>Logo Alignment</label>
            <select
              style={styles.select}
              value={customization.logoAlignment || "left"}
              onChange={(e) =>
                setCustomization((prev) => ({
                  ...prev,
                  logoAlignment: e.target.value as "left" | "center" | "right",
                }))
              }
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>

            <label style={styles.fieldLabel}>Banner Alignment</label>
            <select
              style={styles.select}
              value={customization.bannerAlignment || "center"}
              onChange={(e) =>
                setCustomization((prev) => ({
                  ...prev,
                  bannerAlignment: e.target.value as "top" | "center" | "bottom",
                }))
              }
            >
              <option value="top">Top</option>
              <option value="center">Center</option>
              <option value="bottom">Bottom</option>
            </select>
          </div>
        </section>

        {/* ── Layout Style ── */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Layout Style</h2>
          <p style={styles.mutedText}>Choose how participants are arranged on screen.</p>
          <div style={layoutPreviewGrid}>
            {LAYOUT_OPTIONS.map((opt) => {
              const selected = (customization.layoutStyle || "default") === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() =>
                    setCustomization((prev) => ({ ...prev, layoutStyle: opt.value }))
                  }
                  style={{
                    ...layoutPreviewCard,
                    ...(selected ? layoutPreviewCardSelected : {}),
                  }}
                  aria-pressed={selected}
                >
                  <span style={{ fontSize: 24, display: "block", marginBottom: 6 }}>
                    {opt.icon}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: selected ? "#fff" : "#bbb" }}>
                    {opt.label}
                  </span>
                  <span style={{ fontSize: 11, opacity: 0.6, marginTop: 2, display: "block" }}>
                    {opt.desc}
                  </span>
                </button>
              );
            })}
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
                    banner: { ...BANNER_DEFAULTS, ...prev.banner, enabled: e.target.checked },
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
                    banner: { ...BANNER_DEFAULTS, ...prev.banner, enabled: true, url: e.target.value },
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
                    banner: { ...BANNER_DEFAULTS, ...prev.banner, enabled: true, position: e.target.value as "top" | "bottom" },
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
                    placeholderMedia: { ...prev.placeholderMedia, imageUrl: prev.placeholderMedia?.imageUrl ?? "", enabled: true, title: e.target.value },
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
                    placeholderMedia: { ...prev.placeholderMedia, imageUrl: prev.placeholderMedia?.imageUrl ?? "", enabled: true, subtitle: e.target.value },
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

        {/* ── Intro Clip (Phase 5) — only visible when flag + plan are active ── */}
        {introEnabled && (
          <section style={styles.section}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>Intro Clip</h2>
              <label style={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={customization.introClip?.enabled === true}
                  onChange={(e) =>
                    setCustomization((prev) => ({
                      ...prev,
                      introClip: { ...prev.introClip, enabled: e.target.checked },
                    }))
                  }
                />
                {" "}Enabled
              </label>
            </div>
            <p style={styles.mutedText}>
              Play a short clip before your room goes live. If the clip is missing or fails,
              the room starts normally.
            </p>
            {customization.introClip?.enabled && (
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>Asset ID (from My Content)</label>
                <input
                  type="text"
                  style={styles.input}
                  placeholder="asset_abc123"
                  value={customization.introClip?.assetId || ""}
                  onChange={(e) =>
                    setCustomization((prev) => ({
                      ...prev,
                      introClip: { ...prev.introClip, enabled: true, assetId: e.target.value },
                    }))
                  }
                />
                <label style={styles.fieldLabel}>Duration (seconds, max 300)</label>
                <input
                  type="number"
                  style={styles.input}
                  min={1}
                  max={300}
                  value={customization.introClip?.durationSeconds ?? ""}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setCustomization((prev) => ({
                      ...prev,
                      introClip: {
                        ...prev.introClip,
                        enabled: true,
                        durationSeconds: isNaN(v) ? undefined : Math.min(300, Math.max(1, v)),
                      },
                    }));
                  }}
                />
                <label style={styles.toggleLabel}>
                  <input
                    type="checkbox"
                    checked={customization.introClip?.allowHostSkip !== false}
                    onChange={(e) =>
                      setCustomization((prev) => ({
                        ...prev,
                        introClip: { ...prev.introClip, enabled: true, allowHostSkip: e.target.checked },
                      }))
                    }
                  />
                  {" "}Allow host to skip
                </label>

                {/* Preview controls — only wired up when assetId exists */}
                <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const }}>
                  <div style={{ fontSize: 12, color: "#888" }}>
                    Status: <strong style={{ color: "#e0e0e0" }}>{introStatus}</strong>
                  </div>
                  <button
                    style={{ ...styles.btnPrimary, padding: "6px 16px", fontSize: 13 }}
                    disabled={introLoading || !customization.introClip?.assetId}
                    onClick={handleIntroPlay}
                    title={!customization.introClip?.assetId ? "Set an Asset ID first" : ""}
                  >
                    {introLoading ? "…" : "▶ Play Intro"}
                  </button>
                  <button
                    style={{ ...styles.btnSecondary, padding: "6px 16px", fontSize: 13 }}
                    disabled={introLoading}
                    onClick={handleIntroSkip}
                  >
                    ⏭ Skip
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

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

// ── Layout preview card styles (defined outside `styles` to avoid Record<string, CSSProperties> type issue)
const layoutPreviewGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
  gap: 10,
  marginTop: 12,
};

const layoutPreviewCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  padding: "14px 10px",
  cursor: "pointer",
  textAlign: "center",
  transition: "border-color 0.15s, background 0.15s",
  color: "#bbb",
  lineHeight: 1.4,
};

const layoutPreviewCardSelected: React.CSSProperties = {
  background: "rgba(200,0,0,0.12)",
  border: "1px solid rgba(200,0,0,0.4)",
  color: "#fff",
};
