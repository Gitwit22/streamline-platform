import React, { useMemo } from "react";
import type { OutputFormat } from "../../lib/api";
import { OUTPUT_FORMAT_DIMENSIONS, type VerticalLayoutPreset } from "../../lib/verticalLayouts";

export type VerticalPreviewOverlayProps = {
  /** The current output format selected by the host. */
  outputFormat: OutputFormat;
  /** If provided, shows the slot boundaries for the selected preset. */
  activePreset?: VerticalLayoutPreset | null;
  /** Width of the preview container in CSS pixels. */
  containerWidth: number;
  /** Height of the preview container in CSS pixels. */
  containerHeight: number;
};

/**
 * Overlay that renders:
 *  1. A vertical safe-area crop zone when in landscape mode
 *     (shows the 9:16 centre region that Instagram will keep).
 *  2. Slot guides when a vertical/square preset is active.
 */
export default function VerticalPreviewOverlay({
  outputFormat,
  activePreset,
  containerWidth,
  containerHeight,
}: VerticalPreviewOverlayProps) {
  const dims = OUTPUT_FORMAT_DIMENSIONS[outputFormat];

  // Scale from reference canvas to the preview container.
  const scale = useMemo(() => {
    if (!dims) return 1;
    return Math.min(containerWidth / dims.width, containerHeight / dims.height);
  }, [containerWidth, containerHeight, dims]);

  const canvasW = dims.width * scale;
  const canvasH = dims.height * scale;
  const offsetX = (containerWidth - canvasW) / 2;
  const offsetY = (containerHeight - canvasH) / 2;

  // Safe zone: the 9:16 region inside a 16:9 canvas.
  const showSafeZone = outputFormat === "landscape_16x9";
  const safeZone = useMemo(() => {
    if (!showSafeZone) return null;
    const safeWidth = canvasH * (9 / 16);
    const safeLeft = offsetX + (canvasW - safeWidth) / 2;
    return { left: safeLeft, width: safeWidth, top: offsetY, height: canvasH };
  }, [showSafeZone, canvasW, canvasH, offsetX, offsetY]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {/* Vertical safe zone overlay (landscape only) */}
      {safeZone && (
        <>
          {/* Left dimmed region */}
          <div
            style={{
              position: "absolute",
              top: safeZone.top,
              left: offsetX,
              width: safeZone.left - offsetX,
              height: safeZone.height,
              background: "rgba(0,0,0,0.45)",
            }}
          />
          {/* Right dimmed region */}
          <div
            style={{
              position: "absolute",
              top: safeZone.top,
              left: safeZone.left + safeZone.width,
              width: offsetX + canvasW - (safeZone.left + safeZone.width),
              height: safeZone.height,
              background: "rgba(0,0,0,0.45)",
            }}
          />
          {/* Safe zone border */}
          <div
            style={{
              position: "absolute",
              top: safeZone.top,
              left: safeZone.left,
              width: safeZone.width,
              height: safeZone.height,
              border: "2px dashed rgba(245,158,11,0.6)",
              borderRadius: 4,
            }}
          />
          {/* Label */}
          <div
            style={{
              position: "absolute",
              top: safeZone.top + 4,
              left: safeZone.left + 6,
              fontSize: 10,
              color: "rgba(245,158,11,0.8)",
              fontWeight: 600,
            }}
          >
            Vertical Safe Zone (9:16)
          </div>
        </>
      )}

      {/* Preset slot guides (vertical/square) */}
      {activePreset &&
        activePreset.slots.map((slot) => (
          <div
            key={slot.id}
            style={{
              position: "absolute",
              left: offsetX + slot.x * canvasW,
              top: offsetY + slot.y * canvasH,
              width: slot.width * canvasW,
              height: slot.height * canvasH,
              border: "1px solid rgba(99,102,241,0.5)",
              borderRadius: 4,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "flex-start",
              padding: 3,
            }}
          >
            {slot.label && (
              <span
                style={{
                  fontSize: 9,
                  color: "rgba(165,180,252,0.8)",
                  background: "rgba(0,0,0,0.5)",
                  borderRadius: 2,
                  padding: "1px 4px",
                }}
              >
                {slot.label}
              </span>
            )}
          </div>
        ))}
    </div>
  );
}
