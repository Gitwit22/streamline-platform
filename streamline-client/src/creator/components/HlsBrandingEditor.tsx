import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { API_BASE } from "../../lib/apiBase";
import { apiFetchAuth } from "../../lib/api";
import {
  DEFAULT_VIEWER_LOGO_URL,
  EMPTY_BRANDING,
  HLS_BRANDING_LIMITS,
  brandingEquals,
  brandingFromConfig,
  resolveViewerBranding,
  validateBranding,
  type HlsBranding,
} from "../../lib/hlsBranding";

/**
 * Branding editor for one Streamline Channel (saved embed). Edits the
 * embed's room hlsConfig (title / subtitle / logo / theme / offline message)
 * through PUT /api/rooms/:roomId/hls-config and shows a live preview that
 * uses the same resolver as the public viewer (pages/Live.tsx).
 */
export default function HlsBrandingEditor({
  roomId,
  embedName,
  embedDescription,
  viewerUrl,
  allowed,
  blockedReason,
  onUpgrade,
}: {
  /** The saved embed's own room (embed.roomId). */
  roomId: string;
  embedName: string;
  embedDescription?: string;
  viewerUrl: string;
  /** entitlements.features.hlsCustomization (plan + platform switch). */
  allowed: boolean;
  /** Why editing is blocked: plan vs platform-wide switch. */
  blockedReason?: "plan" | "platform" | null;
  onUpgrade?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState<HlsBranding>(EMPTY_BRANDING);
  const [draft, setDraft] = useState<HlsBranding>(EMPTY_BRANDING);
  const [logoBroken, setLogoBroken] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessage(null);
    (async () => {
      try {
        const res = await apiFetchAuth(
          `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/hls-config`,
          { cache: "no-store" },
          { allowNonOk: true }
        );
        const payload = await res.json().catch(() => null);
        if (!res.ok) throw new Error(payload?.error || "Failed to load branding.");
        const cfg = payload?.hlsConfig && typeof payload.hlsConfig === "object" ? payload.hlsConfig : {};
        if (cancelled) return;
        const b = brandingFromConfig(cfg);
        setEnabled(cfg.enabled === true);
        setSaved(b);
        setDraft(b);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load branding.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => setLogoBroken(false), [draft.logoUrl]);

  const errors = useMemo(() => validateBranding(draft), [draft]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = !brandingEquals(draft, saved);
  const disabled = !allowed || loading || saving;

  const setField = <K extends keyof HlsBranding>(key: K, value: HlsBranding[K]) => {
    setMessage(null);
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!allowed || hasErrors || !dirty) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetchAuth(
        `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/hls-config`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Unchanged: this editor only edits branding.
            enabled,
            title: draft.title.trim(),
            subtitle: draft.subtitle.trim(),
            logoUrl: draft.logoUrl.trim(),
            offlineMessage: draft.offlineMessage.trim(),
            theme: draft.theme,
          }),
        },
        { allowNonOk: true }
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const code = String(payload?.error || "");
        if (code === "hls_customization_not_in_plan" || code === "feature_not_entitled") {
          throw new Error("Channel branding is not included in your plan.");
        }
        if (code === "feature_disabled") throw new Error("Channel branding is temporarily disabled.");
        throw new Error(payload?.details || code || "Failed to save branding.");
      }
      const next = brandingFromConfig(payload?.hlsConfig || draft);
      setSaved(next);
      setDraft(next);
      setMessage("Saved — viewers see the new branding on their next load.");
    } catch (e: any) {
      setError(e?.message || "Failed to save branding.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }} data-testid="hls-branding-editor">
      {!allowed && (
        <div style={noticeStyle}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>
            {blockedReason === "platform" ? "Channel branding is temporarily disabled" : "Channel branding is not included in your plan"}
          </div>
          <div style={{ color: "#fcd34d" }}>
            {blockedReason === "platform"
              ? "Branding can't be changed right now. Your viewer page keeps its current look."
              : "Upgrade to add your own title, logo, theme and offline message to your viewer page."}
          </div>
          {blockedReason !== "platform" && onUpgrade && (
            <button type="button" onClick={onUpgrade} style={{ ...btnPrimary, marginTop: 10 }}>
              Upgrade
            </button>
          )}
        </div>
      )}

      {loading && <div style={{ fontSize: 12, color: "#9ca3af" }}>Loading branding…</div>}

      <div style={{ display: "grid", gap: 10 }}>
        <TextField
          label="Title"
          placeholder={embedName || "StreamLine"}
          value={draft.title}
          max={HLS_BRANDING_LIMITS.title}
          disabled={disabled}
          error={errors.title}
          onChange={(v) => setField("title", v)}
        />
        <TextField
          label="Subtitle"
          placeholder={embedDescription || "Live Viewer"}
          value={draft.subtitle}
          max={HLS_BRANDING_LIMITS.subtitle}
          disabled={disabled}
          error={errors.subtitle}
          onChange={(v) => setField("subtitle", v)}
        />
        <TextField
          label="Logo image URL"
          placeholder="https://example.com/logo.png"
          value={draft.logoUrl}
          max={HLS_BRANDING_LIMITS.logoUrl}
          disabled={disabled}
          error={errors.logoUrl || (logoBroken && draft.logoUrl.trim() ? "Couldn't load this image — check the URL." : undefined)}
          hint="Square PNG/SVG works best. Leave empty for the StreamLine logo."
          onChange={(v) => setField("logoUrl", v)}
        />

        <div style={{ display: "grid", gap: 6 }}>
          <span style={labelStyle}>Theme</span>
          <div style={{ display: "flex", gap: 8 }} role="radiogroup" aria-label="Viewer theme">
            {(["dark", "light"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={draft.theme === t}
                disabled={disabled}
                onClick={() => setField("theme", t)}
                style={pillStyle(draft.theme === t, disabled)}
              >
                {t === "dark" ? "Dark" : "Light"}
              </button>
            ))}
          </div>
        </div>

        <TextField
          label="Offline message"
          placeholder="When the host goes live, playback will start automatically."
          value={draft.offlineMessage}
          max={HLS_BRANDING_LIMITS.offlineMessage}
          disabled={disabled}
          error={errors.offlineMessage}
          multiline
          hint="Shown on the viewer page while you're not live (e.g. your schedule)."
          onChange={(v) => setField("offlineMessage", v)}
        />
      </div>

      <div>
        <div style={{ ...labelStyle, marginBottom: 6 }}>Preview</div>
        <HlsViewerPreview
          branding={draft}
          embedName={embedName}
          embedDescription={embedDescription}
          onLogoError={() => setLogoBroken(true)}
        />
        {viewerUrl && (
          <div style={{ marginTop: 6, fontSize: 11, color: "#6b7280", wordBreak: "break-all" }}>
            Viewers see this at <span style={{ color: "#9ca3af" }}>{viewerUrl}</span>
          </div>
        )}
      </div>

      {error && <div style={errorStyle}>{error}</div>}
      {message && <div style={okStyle}>{message}</div>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => {
            setDraft(saved);
            setMessage(null);
          }}
          disabled={disabled || !dirty}
          style={{ ...btnSecondary, opacity: disabled || !dirty ? 0.5 : 1 }}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={disabled || !dirty || hasErrors}
          style={{ ...btnPrimary, opacity: disabled || !dirty || hasErrors ? 0.5 : 1 }}
        >
          {saving ? "Saving…" : "Save branding"}
        </button>
      </div>
    </div>
  );
}

/** Miniature of the public viewer (/live/:id) header + offline player frame. */
export function HlsViewerPreview({
  branding,
  embedName,
  embedDescription,
  onLogoError,
}: {
  branding: HlsBranding;
  embedName?: string;
  embedDescription?: string;
  onLogoError?: () => void;
}) {
  const r = resolveViewerBranding({ channelBranding: branding, embedName, embedDescription });
  const light = r.isLightTheme;
  return (
    <div
      data-testid="hls-viewer-preview"
      data-theme={light ? "light" : "dark"}
      style={{
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid rgba(63,63,70,0.6)",
        background: light ? "#ffffff" : "#000000",
        padding: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              overflow: "hidden",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: r.logoUrl ? "rgba(255,255,255,0.9)" : "linear-gradient(135deg,#ef4444,#b91c1c)",
            }}
          >
            <img
              src={r.logoUrl || DEFAULT_VIEWER_LOGO_URL}
              alt=""
              onError={r.logoUrl ? onLogoError : undefined}
              style={{ width: r.logoUrl ? "100%" : 20, height: r.logoUrl ? "100%" : 20, objectFit: "contain" }}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              data-testid="preview-title"
              style={{ fontWeight: 800, fontSize: 14, color: light ? "#171717" : "#ffffff", ...ellipsis }}
            >
              {r.title}
            </div>
            <div style={{ fontSize: 10, color: light ? "#525252" : "#737373", ...ellipsis }}>{r.subtitle}</div>
          </div>
        </div>
        <div
          style={{
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: 1,
            padding: "3px 8px",
            borderRadius: 999,
            border: "1px solid rgba(82,82,82,0.5)",
            color: "#d4d4d4",
            background: "rgba(0,0,0,0.3)",
          }}
        >
          OFFLINE
        </div>
      </div>
      <div
        style={{
          marginTop: 10,
          aspectRatio: "16 / 9",
          borderRadius: 10,
          background: "rgba(0,0,0,0.85)",
          border: "1px solid rgba(38,38,38,0.6)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: 12,
        }}
      >
        <img src={r.logoUrl || DEFAULT_VIEWER_LOGO_URL} alt="" style={{ height: 24, width: "auto", opacity: 0.95 }} />
        <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: "#ffffff" }}>Stream is offline</div>
        <div data-testid="preview-offline" style={{ marginTop: 4, fontSize: 11, color: "#737373", maxWidth: 320 }}>
          {r.offlineMessage}
        </div>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  placeholder,
  max,
  disabled,
  error,
  hint,
  multiline,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  max: number;
  disabled: boolean;
  error?: string;
  hint?: string;
  multiline?: boolean;
  onChange: (v: string) => void;
}) {
  const style: CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: `1px solid ${error ? "rgba(239,68,68,0.7)" : "rgba(63,63,70,0.6)"}`,
    background: "rgba(0,0,0,0.25)",
    color: "#e5e7eb",
    fontSize: 13,
    resize: multiline ? "vertical" : undefined,
  };
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={labelStyle}>{label}</span>
        {max <= 300 && <span style={{ fontSize: 11, color: "#6b7280" }}>{max - value.length}</span>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          rows={2}
          onChange={(e) => onChange(e.target.value)}
          style={style}
          aria-invalid={!!error}
        />
      ) : (
        <input
          type={label.toLowerCase().includes("url") ? "url" : "text"}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={style}
          aria-invalid={!!error}
        />
      )}
      {error ? (
        <span style={{ fontSize: 11, color: "#fca5a5" }}>{error}</span>
      ) : hint ? (
        <span style={{ fontSize: 11, color: "#6b7280" }}>{hint}</span>
      ) : null}
    </label>
  );
}

const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const labelStyle: CSSProperties = { fontSize: 12, color: "#9ca3af", fontWeight: 800 };
const noticeStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  background: "rgba(245,158,11,0.10)",
  border: "1px solid rgba(245,158,11,0.35)",
  color: "#fde68a",
  fontSize: 13,
};
const errorStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  background: "rgba(239,68,68,0.12)",
  border: "1px solid rgba(239,68,68,0.35)",
  color: "#fca5a5",
  fontSize: 13,
};
const okStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  background: "rgba(34,197,94,0.10)",
  border: "1px solid rgba(34,197,94,0.35)",
  color: "#bbf7d0",
  fontSize: 13,
};
const btnPrimary: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "none",
  background: "linear-gradient(135deg,#dc2626,#ef4444)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};
const btnSecondary: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,0.4)",
  background: "rgba(15,23,42,0.6)",
  color: "#e5e7eb",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

function pillStyle(active: boolean, disabled: boolean): CSSProperties {
  return {
    padding: "6px 14px",
    borderRadius: 999,
    border: active ? "1px solid rgba(220,38,38,0.8)" : "1px solid rgba(148,163,184,0.5)",
    background: active ? "rgba(220,38,38,0.16)" : "rgba(15,23,42,0.9)",
    color: active ? "#fecaca" : "#e5e7eb",
    fontSize: 12,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
