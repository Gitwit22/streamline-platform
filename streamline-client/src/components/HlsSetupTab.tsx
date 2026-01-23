import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { API_BASE } from "../lib/apiBase";

export type RoomHlsConfig = {
  enabled: boolean;
  title?: string;
  subtitle?: string;
  logoUrl?: string;
  offlineMessage?: string;
  theme?: "light" | "dark";
  updatedAt?: string;
};

const DEFAULT_CONFIG: RoomHlsConfig = {
  enabled: false,
  title: "",
  subtitle: "",
  logoUrl: "",
  offlineMessage: "This stream is offline.",
  theme: "dark",
};

function normalizeRoomId(roomId: string): string {
  return String(roomId || "").trim();
}

export default function HlsSetupTab({
  open,
  roomId,
  viewerUrl,
  platformEnabled,
  canCustomize,
  onUpgrade,
}: {
  open: boolean;
  roomId: string;
  viewerUrl: string;
  platformEnabled: boolean;
  canCustomize: boolean;
  onUpgrade?: () => void;
}) {
  const safeRoomId = useMemo(() => normalizeRoomId(roomId), [roomId]);
  const roomReady = !!safeRoomId && !/[ \u2013#]/.test(safeRoomId);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<RoomHlsConfig>(DEFAULT_CONFIG);

  const embedCode = useMemo(() => {
    const src = viewerUrl || "";
    if (!src) return "";
    return `<iframe src="${src}" style="width:100%;height:100%;border:0;" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
  }, [viewerUrl]);

  useEffect(() => {
    if (!open) return;
    if (!platformEnabled) return;
    if (!roomReady) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(safeRoomId)}/hls-config`, {
          credentials: "include",
          cache: "no-store",
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(payload?.error || "Failed to load HLS setup.");
        }
        const next = payload?.hlsConfig && typeof payload.hlsConfig === "object" ? payload.hlsConfig : {};
        if (!cancelled) {
          setConfig({ ...DEFAULT_CONFIG, ...next });
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load HLS setup.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, platformEnabled, roomReady, safeRoomId]);

  if (!platformEnabled) return null;

  const setField = (key: keyof RoomHlsConfig, value: any) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!roomReady) return;
    if (!canCustomize) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(safeRoomId)}/hls-config`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: !!config.enabled,
          title: config.title ?? "",
          subtitle: config.subtitle ?? "",
          logoUrl: config.logoUrl ?? "",
          offlineMessage: config.offlineMessage ?? "",
          theme: config.theme === "light" ? "light" : "dark",
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to save HLS setup.");
      }
      const next = payload?.hlsConfig && typeof payload.hlsConfig === "object" ? payload.hlsConfig : {};
      setConfig({ ...DEFAULT_CONFIG, ...next });
    } catch (e: any) {
      setError(e?.message || "Failed to save HLS setup.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ fontSize: "0.75rem", color: "rgba(209, 213, 219, 0.9)" }}>
        This page controls the public viewer profile (title, logo, theme, offline message). It does not start HLS.
      </div>

      {!canCustomize && (
        <div
          style={{
            padding: "0.65rem 0.75rem",
            borderRadius: "0.5rem",
            background: "rgba(30,64,175,0.25)",
            border: "1px solid rgba(59,130,246,0.6)",
            fontSize: "0.75rem",
            color: "#dbeafe",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>HLS Setup not included in this plan.</div>
          <div style={{ marginBottom: "0.45rem" }}>Upgrade to customize the viewer page (title/logo/theme).</div>
          <button
            type="button"
            onClick={() => (onUpgrade ? onUpgrade() : (window.location.href = "/settings/billing"))}
            style={{
              padding: "0.45rem 0.8rem",
              borderRadius: "999px",
              border: "none",
              background: "linear-gradient(135deg,#3b82f6,#2563eb)",
              color: "#f9fafb",
              fontSize: "0.78rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Upgrade
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Viewer Link (/live/:roomId)</span>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <input
              type="text"
              readOnly
              value={roomReady ? viewerUrl : ""}
              placeholder={roomReady ? "" : "Viewer link will appear once the roomId is known"}
              style={{
                flex: 1,
                padding: "0.4rem 0.55rem",
                borderRadius: "0.35rem",
                border: "1px solid rgba(75,85,99,0.7)",
                background: "rgba(15,23,42,0.9)",
                color: "#e5e7eb",
                fontSize: "0.8rem",
              }}
            />
            <button
              type="button"
              disabled={!roomReady || !viewerUrl}
              onClick={async () => {
                if (!roomReady || !viewerUrl) return;
                try {
                  await navigator.clipboard.writeText(viewerUrl);
                  alert("Viewer link copied");
                } catch {
                  // ignore
                }
              }}
              style={{
                padding: "0.35rem 0.6rem",
                borderRadius: "0.35rem",
                border: "1px solid rgba(148,163,184,0.7)",
                background: "rgba(15,23,42,0.95)",
                color: "#e5e7eb",
                fontSize: "0.75rem",
                cursor: roomReady && viewerUrl ? "pointer" : "not-allowed",
                opacity: roomReady && viewerUrl ? 1 : 0.5,
              }}
            >
              Copy
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Embed Code</span>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <input
              type="text"
              readOnly
              value={roomReady ? embedCode : ""}
              placeholder={roomReady ? "" : "Embed code will appear once the roomId is known"}
              style={{
                flex: 1,
                padding: "0.4rem 0.55rem",
                borderRadius: "0.35rem",
                border: "1px solid rgba(75,85,99,0.7)",
                background: "rgba(15,23,42,0.9)",
                color: "#e5e7eb",
                fontSize: "0.8rem",
                fontFamily: "monospace",
              }}
            />
            <button
              type="button"
              disabled={!roomReady || !embedCode}
              onClick={async () => {
                if (!roomReady || !embedCode) return;
                try {
                  await navigator.clipboard.writeText(embedCode);
                  alert("Embed code copied");
                } catch {
                  // ignore
                }
              }}
              style={{
                padding: "0.35rem 0.6rem",
                borderRadius: "0.35rem",
                border: "1px solid rgba(148,163,184,0.7)",
                background: "rgba(15,23,42,0.95)",
                color: "#e5e7eb",
                fontSize: "0.75rem",
                cursor: roomReady && embedCode ? "pointer" : "not-allowed",
                opacity: roomReady && embedCode ? 1 : 0.5,
              }}
            >
              Copy
            </button>
          </div>
        </div>
      </div>

      {loading && <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Loading HLS setup…</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "0.5rem" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.8rem", color: "#e5e7eb" }}>
          <input
            type="checkbox"
            checked={!!config.enabled}
            disabled={!canCustomize}
            onChange={(e) => setField("enabled", e.target.checked)}
          />
          Enable public viewer page
        </label>

        <Field label="Title" value={config.title ?? ""} disabled={!canCustomize} onChange={(v) => setField("title", v)} />
        <Field label="Subtitle" value={config.subtitle ?? ""} disabled={!canCustomize} onChange={(v) => setField("subtitle", v)} />
        <Field label="Logo URL" value={config.logoUrl ?? ""} disabled={!canCustomize} onChange={(v) => setField("logoUrl", v)} />

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Theme</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={!canCustomize}
              onClick={() => setField("theme", "dark")}
              style={pillStyle(config.theme !== "light", !canCustomize)}
            >
              Dark
            </button>
            <button
              type="button"
              disabled={!canCustomize}
              onClick={() => setField("theme", "light")}
              style={pillStyle(config.theme === "light", !canCustomize)}
            >
              Light
            </button>
          </div>
        </div>

        <TextArea
          label="Offline Message"
          value={config.offlineMessage ?? ""}
          disabled={!canCustomize}
          onChange={(v) => setField("offlineMessage", v)}
        />
      </div>

      {error && (
        <div
          style={{
            fontSize: "0.75rem",
            color: "#fecaca",
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.6)",
            borderRadius: "0.4rem",
            padding: "0.4rem 0.5rem",
          }}
        >
          ❌ {error}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canCustomize || !roomReady || saving}
          style={{
            padding: "0.55rem 0.9rem",
            borderRadius: "0.5rem",
            border: "1px solid rgba(148,163,184,0.5)",
            background: canCustomize && roomReady ? "rgba(15,23,42,0.95)" : "rgba(31,41,55,0.8)",
            color: "#e5e7eb",
            fontSize: "0.8rem",
            fontWeight: 600,
            cursor: !canCustomize || !roomReady || saving ? "not-allowed" : "pointer",
            opacity: !canCustomize || !roomReady || saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{label}</div>
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "0.45rem 0.55rem",
          borderRadius: "0.35rem",
          border: "1px solid rgba(75,85,99,0.7)",
          background: disabled ? "rgba(15,23,42,0.6)" : "rgba(15,23,42,0.9)",
          color: "#e5e7eb",
          fontSize: "0.8rem",
        }}
      />
    </div>
  );
}

function TextArea({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{label}</div>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        style={{
          padding: "0.45rem 0.55rem",
          borderRadius: "0.35rem",
          border: "1px solid rgba(75,85,99,0.7)",
          background: disabled ? "rgba(15,23,42,0.6)" : "rgba(15,23,42,0.9)",
          color: "#e5e7eb",
          fontSize: "0.8rem",
          resize: "vertical",
        }}
      />
    </div>
  );
}

function pillStyle(active: boolean, disabled: boolean): CSSProperties {
  return {
    padding: "0.35rem 0.65rem",
    borderRadius: "999px",
    border: active ? "1px solid rgba(220,38,38,0.8)" : "1px solid rgba(148,163,184,0.5)",
    background: active ? "rgba(220,38,38,0.16)" : "rgba(15,23,42,0.9)",
    color: active ? "#fecaca" : "#e5e7eb",
    fontSize: "0.75rem",
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
