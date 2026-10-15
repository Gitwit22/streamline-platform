import type { CSSProperties } from "react";
import {
  LOGO_OPACITY_RANGE,
  LOGO_POSITIONS,
  LOGO_SIZE_RANGE,
  overlayFromKit,
  validateKitVideo,
  DEFAULT_ACCENT_COLOR,
  type KitVideoSettings,
  type LogoPosition,
} from "../../lib/programOverlay";
import { validateLogoUrl } from "../../lib/hlsBranding";
import { OverlayBackground, OverlayGraphics, OverlayLogo } from "./ProgramOverlayLayer";

const POSITION_LABEL: Record<LogoPosition, string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
};

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Brand kit "On video" settings: corner logo (the kit's logo image) and a
 * background color/image, drawn by the compositor on every output.
 */
export function KitVideoFields({
  video,
  logoUrl,
  disabled,
  onChange,
}: {
  video: KitVideoSettings;
  /** The kit's logo (shared with the viewer page). */
  logoUrl: string;
  disabled: boolean;
  onChange: (next: KitVideoSettings) => void;
}) {
  const set = <K extends keyof KitVideoSettings>(k: K, value: KitVideoSettings[K]) => onChange({ ...video, [k]: value });
  const errors = validateKitVideo(video);
  const hasLogo = !!logoUrl.trim() && !validateLogoUrl(logoUrl);

  return (
    <div style={{ display: "grid", gap: 10 }} data-testid="kit-video-fields">
      <label style={rowLabel}>
        <input
          type="checkbox"
          checked={video.showLogo}
          disabled={disabled}
          onChange={(e) => set("showLogo", e.target.checked)}
        />
        Show the kit logo on the video
      </label>
      {video.showLogo && !hasLogo && (
        <div style={{ fontSize: 11, color: "#fcd34d" }}>Add a logo image URL above to show it on the video.</div>
      )}
      {video.showLogo && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <label style={fieldLabel}>
            <span style={labelText}>Position</span>
            <select
              value={video.logoPosition}
              disabled={disabled}
              onChange={(e) => set("logoPosition", e.target.value as LogoPosition)}
              style={inputStyle}
            >
              {LOGO_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {POSITION_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <label style={fieldLabel}>
            <span style={labelText}>Size: {video.logoSize}% of width</span>
            <input
              type="range"
              min={LOGO_SIZE_RANGE.min}
              max={LOGO_SIZE_RANGE.max}
              step={1}
              value={video.logoSize}
              disabled={disabled}
              onChange={(e) => set("logoSize", Number(e.target.value))}
            />
          </label>
          <label style={fieldLabel}>
            <span style={labelText}>Opacity: {Math.round(video.logoOpacity * 100)}%</span>
            <input
              type="range"
              min={LOGO_OPACITY_RANGE.min}
              max={LOGO_OPACITY_RANGE.max}
              step={0.05}
              value={video.logoOpacity}
              disabled={disabled}
              onChange={(e) => set("logoOpacity", Math.round(Number(e.target.value) * 100) / 100)}
            />
          </label>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <div style={fieldLabel}>
          <span style={labelText}>Background color</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="color"
              aria-label="Background color"
              value={HEX.test(video.backgroundColor) ? video.backgroundColor : "#0a0a0a"}
              disabled={disabled}
              onChange={(e) => set("backgroundColor", e.target.value.toLowerCase())}
              style={{ width: 44, height: 34, padding: 0, border: "none", background: "transparent" }}
            />
            <span style={{ fontSize: 12, color: "#9ca3af" }}>{video.backgroundColor || "Default (black)"}</span>
            {video.backgroundColor && (
              <button type="button" style={linkBtn} disabled={disabled} onClick={() => set("backgroundColor", "")}>
                Reset
              </button>
            )}
          </div>
          {errors.backgroundColor && <span style={errText}>{errors.backgroundColor}</span>}
        </div>
        <label style={fieldLabel}>
          <span style={labelText}>Background image URL</span>
          <input
            type="url"
            placeholder="https://example.com/background.jpg"
            value={video.backgroundImageUrl}
            disabled={disabled}
            onChange={(e) => set("backgroundImageUrl", e.target.value)}
            style={inputStyle}
            aria-invalid={!!errors.backgroundImageUrl}
          />
          {errors.backgroundImageUrl ? (
            <span style={errText}>{errors.backgroundImageUrl}</span>
          ) : (
            <span style={{ fontSize: 11, color: "#6b7280" }}>Shows behind the layout, around and between video tiles.</span>
          )}
        </label>
      </div>

      <div style={fieldLabel}>
        <span style={labelText}>Accent color (lower thirds and banners)</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="color"
            aria-label="Accent color"
            value={HEX.test(video.accentColor) ? video.accentColor : DEFAULT_ACCENT_COLOR}
            disabled={disabled}
            onChange={(e) => set("accentColor", e.target.value.toLowerCase())}
            style={{ width: 44, height: 34, padding: 0, border: "none", background: "transparent" }}
          />
          <span style={{ fontSize: 12, color: "#9ca3af" }}>{video.accentColor}</span>
        </div>
      </div>

      <div>
        <div style={{ ...labelText, marginBottom: 6 }}>Video preview</div>
        <ProgramOverlayPreview logoUrl={logoUrl} video={video} />
      </div>
    </div>
  );
}

/** 16:9 mock of the program output: background, one centered tile, the logo. */
export function ProgramOverlayPreview({ logoUrl, video }: { logoUrl: string; video: KitVideoSettings }) {
  const overlay = overlayFromKit(logoUrl, video, true);
  // Logo margin approximates the compositor's 3% of the short side at the preview's max size.
  return (
    <div
      data-testid="program-overlay-preview"
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 420,
        aspectRatio: "16 / 9",
        borderRadius: 10,
        overflow: "hidden",
        background: "#0a0a0a",
        border: "1px solid rgba(63,63,70,0.6)",
      }}
    >
      <OverlayBackground overlay={overlay} />
      <div
        style={{
          position: "absolute",
          left: "20%",
          top: "12%",
          width: "60%",
          height: "76%",
          zIndex: 1,
          background: "#1f2937",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#6b7280",
          fontSize: 11,
        }}
      >
        Camera
      </div>
      <OverlayGraphics overlay={overlay} shortSidePx={236} />
      <OverlayLogo overlay={overlay} shortSidePx={236} />
    </div>
  );
}

const rowLabel: CSSProperties = { display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#e5e7eb" };
const fieldLabel: CSSProperties = { display: "grid", gap: 6 };
const labelText: CSSProperties = { fontSize: 12, color: "#9ca3af", fontWeight: 800 };
const errText: CSSProperties = { fontSize: 11, color: "#fca5a5" };
const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(63,63,70,0.6)",
  background: "rgba(0,0,0,0.25)",
  color: "#e5e7eb",
  fontSize: 13,
};
const linkBtn: CSSProperties = {
  background: "none",
  border: "none",
  color: "#93c5fd",
  fontSize: 12,
  cursor: "pointer",
  padding: 0,
};
