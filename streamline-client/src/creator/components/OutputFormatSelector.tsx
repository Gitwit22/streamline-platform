import React from "react";
import type { OutputFormat } from "../../lib/api";
import {
  OUTPUT_FORMAT_LABELS,
  VALID_OUTPUT_FORMATS,
  OUTPUT_FORMAT_DIMENSIONS,
  getPresetsForFormat,
  type VerticalLayoutPreset,
} from "../../lib/verticalLayouts";

export type OutputFormatSelectorProps = {
  value: OutputFormat;
  onChange: (format: OutputFormat) => void;
  /** Optional: show preset suggestions when a non-landscape format is selected. */
  showPresets?: boolean;
  /** Current participant count in the room, used to highlight relevant presets. */
  participantCount?: number;
  /** Called when the user picks a specific vertical/square preset. */
  onPresetSelect?: (preset: VerticalLayoutPreset) => void;
  disabled?: boolean;
};

const formatIcons: Record<OutputFormat, string> = {
  landscape_16x9: "🖥️",
  vertical_9x16: "📱",
  square_1x1: "⬜",
};

export default function OutputFormatSelector({
  value,
  onChange,
  showPresets = true,
  participantCount,
  onPresetSelect,
  disabled = false,
}: OutputFormatSelectorProps) {
  const presets = value !== "landscape_16x9" ? getPresetsForFormat(value) : [];
  const dims = OUTPUT_FORMAT_DIMENSIONS[value];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Format selector */}
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#cbd5e1" }}>
        <span style={{ fontWeight: 600, color: "#e2e8f0" }}>Output Format</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as OutputFormat)}
          disabled={disabled}
          style={{
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.06)",
            color: "#e2e8f0",
            fontSize: 13,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {VALID_OUTPUT_FORMATS.map((fmt) => (
            <option key={fmt} value={fmt}>
              {formatIcons[fmt]} {OUTPUT_FORMAT_LABELS[fmt]}
            </option>
          ))}
        </select>
      </label>

      {/* Dimension badge */}
      <div style={{ fontSize: 11, color: "#94a3b8" }}>
        Canvas: {dims.width}×{dims.height}px
      </div>

      {/* Instagram warning */}
      {value === "landscape_16x9" && (
        <div
          style={{
            fontSize: 11,
            color: "#f59e0b",
            background: "rgba(245,158,11,0.08)",
            padding: "6px 8px",
            borderRadius: 6,
            lineHeight: 1.4,
          }}
        >
          ⚠️ Widescreen layouts may be cropped on Instagram. Switch to <strong>Vertical 9:16</strong> for best results.
        </div>
      )}

      {/* Vertical/Square presets */}
      {showPresets && presets.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 12, color: "#e2e8f0" }}>
            Layout Presets
            {participantCount != null && <span style={{ color: "#94a3b8", fontWeight: 400 }}> ({participantCount} participant{participantCount !== 1 ? "s" : ""})</span>}
          </span>
          <div style={{ display: "grid", gap: 4, gridTemplateColumns: "1fr 1fr" }}>
            {presets.map((preset) => {
              const isRecommended = participantCount != null && preset.participantCount === participantCount;
              return (
                <button
                  key={preset.id}
                  onClick={() => onPresetSelect?.(preset)}
                  disabled={disabled}
                  style={{
                    padding: "6px 8px",
                    fontSize: 11,
                    borderRadius: 6,
                    border: isRecommended
                      ? "1px solid rgba(99,102,241,0.5)"
                      : "1px solid rgba(255,255,255,0.08)",
                    background: isRecommended
                      ? "rgba(99,102,241,0.12)"
                      : "rgba(255,255,255,0.04)",
                    color: isRecommended ? "#a5b4fc" : "#cbd5e1",
                    cursor: disabled ? "not-allowed" : "pointer",
                    textAlign: "left",
                    lineHeight: 1.3,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{preset.label}</div>
                  <div style={{ color: "#94a3b8", fontSize: 10 }}>
                    {preset.participantCount}p · {preset.slots.length} slot{preset.slots.length !== 1 ? "s" : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
