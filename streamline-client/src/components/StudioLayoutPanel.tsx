import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  type StudioLayout,
  type StudioLayoutPresetId,
  type StudioLayoutAdjustMode,
  type LayoutSlot,
  PRESET_INFO,
  getPresetSlots,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  suggestPreset,
  shouldSuggestChange,
  isValidPresetId,
} from "../lib/studioLayout";
import { apiGetStudioLayout, apiUpdateStudioLayout } from "../lib/api";
import type { StudioLayoutPresetId as PresetId, LayoutSlot as Slot } from "../lib/studioLayout";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface StudioLayoutPanelProps {
  roomId: string;
  roomAccessToken: string;
  /** Number of *visible* participants (including the host). */
  participantCount: number;
  onClose: () => void;
  /** Called whenever the active preset / slots change so the caller can
   *  push the change into the shared program state. */
  onProgramStateChange?: (presetId: PresetId | "custom" | null, slots: Slot[]) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function StudioLayoutPanel({
  roomId,
  roomAccessToken,
  participantCount,
  onClose,
  onProgramStateChange,
}: StudioLayoutPanelProps) {
  // -- state ---------------------------------------------------------------

  const [activePresetId, setActivePresetId] = useState<StudioLayoutPresetId | "custom" | null>(null);
  const [slots, setSlots] = useState<LayoutSlot[]>([]);
  const [adjustMode, setAdjustMode] = useState<StudioLayoutAdjustMode>("suggest");
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<StudioLayoutPresetId | null>(null);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCountRef = useRef(participantCount);

  // Drag state (edit mode)
  const [dragging, setDragging] = useState<string | null>(null);
  const dragStartRef = useRef<{ slotId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Resize state (edit mode)
  const [resizing, setResizing] = useState<string | null>(null);
  const resizeStartRef = useRef<{ slotId: string; startX: number; startY: number; origW: number; origH: number } | null>(null);

  // -- helpers -------------------------------------------------------------

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2500);
  }, []);

  // -- load ----------------------------------------------------------------

  // -- load (runs once when roomId/roomAccessToken change) -----------------

  const initialParticipantCountRef = useRef(participantCount);

  useEffect(() => {
    let cancelled = false;
    const initialCount = initialParticipantCountRef.current;
    (async () => {
      try {
        const data = await apiGetStudioLayout(roomId, roomAccessToken);
        if (cancelled) return;
        if (data.studioLayout) {
          setActivePresetId(data.studioLayout.presetId);
          setSlots(data.studioLayout.slots);
          setAdjustMode(data.studioLayout.adjustMode);
        } else {
          // No saved layout – seed from participant count
          const preset = suggestPreset(initialCount);
          setActivePresetId(preset);
          setSlots(getPresetSlots(preset));
        }
      } catch {
        // API failure – seed locally
        const preset = suggestPreset(initialCount);
        setActivePresetId(preset);
        setSlots(getPresetSlots(preset));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [roomId, roomAccessToken]);

  // -- apply preset --------------------------------------------------------

  const applyPreset = useCallback(
    async (presetId: StudioLayoutPresetId) => {
      const newSlots = getPresetSlots(presetId);
      setActivePresetId(presetId);
      setSlots(newSlots);
      setEditMode(false);
      setSuggestion(null);

      // Persist to server
      try {
        setSaving(true);
        await apiUpdateStudioLayout(roomId, roomAccessToken, {
          presetId,
          slots: newSlots,
          adjustMode,
        });
        onProgramStateChange?.(presetId, newSlots);
        showToast(`Switched to ${PRESET_INFO.find((p) => p.id === presetId)?.label ?? presetId}`);
      } catch {
        showToast("Failed to save layout");
      } finally {
        setSaving(false);
      }
    },
    [roomId, roomAccessToken, adjustMode, showToast, onProgramStateChange],
  );

  // -- auto-suggest when participant count changes -------------------------

  useEffect(() => {
    if (!loaded) return;
    if (participantCount === prevCountRef.current) return;
    prevCountRef.current = participantCount;

    if (adjustMode === "auto") {
      // Auto-switch
      const preset = suggestPreset(participantCount);
      applyPreset(preset);
      return;
    }

    if (adjustMode === "suggest") {
      const better = shouldSuggestChange(activePresetId, participantCount);
      if (better) setSuggestion(better);
    }
  }, [participantCount, loaded, adjustMode, activePresetId, applyPreset]);

  // -- save custom layout --------------------------------------------------

  const saveCustom = useCallback(async () => {
    try {
      setSaving(true);
      await apiUpdateStudioLayout(roomId, roomAccessToken, {
        presetId: "custom",
        slots,
        adjustMode,
        customSlots: slots,
      });
      setActivePresetId("custom");
      onProgramStateChange?.("custom", slots);
      showToast("Custom layout saved");
    } catch {
      showToast("Failed to save layout");
    } finally {
      setSaving(false);
    }
  }, [roomId, roomAccessToken, slots, adjustMode, showToast]);

  // -- save adjust mode ----------------------------------------------------

  const changeAdjustMode = useCallback(
    async (mode: StudioLayoutAdjustMode) => {
      setAdjustMode(mode);
      try {
        await apiUpdateStudioLayout(roomId, roomAccessToken, {
          presetId: activePresetId,
          slots,
          adjustMode: mode,
        });
      } catch {
        // best effort
      }
    },
    [roomId, roomAccessToken, activePresetId, slots],
  );

  // -- drag handlers (edit mode) -------------------------------------------

  const onSlotMouseDown = useCallback(
    (e: React.MouseEvent, slotId: string) => {
      if (!editMode) return;
      e.preventDefault();
      e.stopPropagation();
      const slot = slots.find((s) => s.id === slotId);
      if (!slot) return;
      dragStartRef.current = { slotId, startX: e.clientX, startY: e.clientY, origX: slot.x, origY: slot.y };
      setDragging(slotId);
    },
    [editMode, slots],
  );

  const onCanvasMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragging && dragStartRef.current) {
        const ref = dragStartRef.current;
        const canvasRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const scaleX = CANVAS_WIDTH / canvasRect.width;
        const scaleY = CANVAS_HEIGHT / canvasRect.height;
        const dx = (e.clientX - ref.startX) * scaleX;
        const dy = (e.clientY - ref.startY) * scaleY;
        setSlots((prev) =>
          prev.map((s) =>
            s.id === ref.slotId
              ? { ...s, x: Math.round(Math.max(0, ref.origX + dx)), y: Math.round(Math.max(0, ref.origY + dy)) }
              : s,
          ),
        );
      }
      if (resizing && resizeStartRef.current) {
        const ref = resizeStartRef.current;
        const canvasRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const scaleX = CANVAS_WIDTH / canvasRect.width;
        const scaleY = CANVAS_HEIGHT / canvasRect.height;
        const dw = (e.clientX - ref.startX) * scaleX;
        const dh = (e.clientY - ref.startY) * scaleY;
        setSlots((prev) =>
          prev.map((s) =>
            s.id === ref.slotId
              ? { ...s, width: Math.round(Math.max(60, ref.origW + dw)), height: Math.round(Math.max(40, ref.origH + dh)) }
              : s,
          ),
        );
      }
    },
    [dragging, resizing],
  );

  const onCanvasMouseUp = useCallback(() => {
    setDragging(null);
    setResizing(null);
    dragStartRef.current = null;
    resizeStartRef.current = null;
  }, []);

  // Resize handle
  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent, slotId: string) => {
      if (!editMode) return;
      e.preventDefault();
      e.stopPropagation();
      const slot = slots.find((s) => s.id === slotId);
      if (!slot) return;
      resizeStartRef.current = { slotId, startX: e.clientX, startY: e.clientY, origW: slot.width, origH: slot.height };
      setResizing(slotId);
    },
    [editMode, slots],
  );

  // -- z-index helpers -----------------------------------------------------

  const bringForward = useCallback((slotId: string) => {
    setSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, zIndex: s.zIndex + 1 } : s)));
  }, []);

  const sendBackward = useCallback((slotId: string) => {
    setSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, zIndex: Math.max(1, s.zIndex - 1) } : s)));
  }, []);

  // -- render --------------------------------------------------------------

  if (!loaded) {
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>
          <span style={{ fontWeight: 700 }}>Studio Layouts</span>
          <button onClick={onClose} style={closeBtnStyle}>✕</button>
        </div>
        <div style={{ padding: 16, color: "#94a3b8", fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Studio Layouts</span>
        <button onClick={onClose} style={closeBtnStyle} aria-label="Close studio layouts panel">✕</button>
      </div>

      {/* Suggestion toast */}
      {suggestion && (
        <div style={suggestionBarStyle}>
          <span style={{ fontSize: 12 }}>
            A new guest joined. Switch to{" "}
            <strong>{PRESET_INFO.find((p) => p.id === suggestion)?.label ?? suggestion}</strong>?
          </span>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button style={btnSmallPrimary} onClick={() => applyPreset(suggestion)}>
              Apply
            </button>
            <button style={btnSmallSecondary} onClick={() => setSuggestion(null)}>
              Dismiss
            </button>
            <button
              style={btnSmallSecondary}
              onClick={() => {
                changeAdjustMode("auto");
                applyPreset(suggestion);
              }}
            >
              Always auto-adjust
            </button>
          </div>
        </div>
      )}

      {/* Preset grid */}
      <div style={{ padding: "8px 12px" }}>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Presets
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {PRESET_INFO.map((p) => {
            const active = activePresetId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                disabled={saving}
                style={{
                  ...presetBtnStyle,
                  border: active ? "1px solid #dc2626" : "1px solid rgba(255,255,255,0.08)",
                  background: active ? "rgba(220,38,38,0.15)" : "rgba(255,255,255,0.03)",
                }}
              >
                <span style={{ fontSize: 18 }}>{p.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 600 }}>{p.label}</span>
                <span style={{ fontSize: 10, color: "#94a3b8" }}>{p.slotCount} slot{p.slotCount > 1 ? "s" : ""}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Canvas preview */}
      <div style={{ padding: "4px 12px 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Preview
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setEditMode((v) => !v)}
              style={{
                ...btnSmallSecondary,
                border: editMode ? "1px solid #dc2626" : "1px solid rgba(255,255,255,0.1)",
                color: editMode ? "#ef4444" : "#e2e8f0",
              }}
            >
              {editMode ? "Exit Edit" : "Customize Layout"}
            </button>
            {editMode && (
              <button onClick={saveCustom} disabled={saving} style={btnSmallPrimary}>
                {saving ? "Saving…" : "Save Custom"}
              </button>
            )}
          </div>
        </div>

        <div
          style={canvasPreviewStyle}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onMouseLeave={onCanvasMouseUp}
        >
          {slots.map((slot, idx) => {
            const scaleX = 1; // Canvas is rendered at scaled size via CSS
            const scaleY = 1;
            const isDragging = dragging === slot.id;
            const isResizingSlot = resizing === slot.id;
            return (
              <div
                key={slot.id}
                onMouseDown={(e) => onSlotMouseDown(e, slot.id)}
                style={{
                  position: "absolute",
                  left: `${(slot.x / CANVAS_WIDTH) * 100}%`,
                  top: `${(slot.y / CANVAS_HEIGHT) * 100}%`,
                  width: `${(slot.width / CANVAS_WIDTH) * 100}%`,
                  height: `${(slot.height / CANVAS_HEIGHT) * 100}%`,
                  zIndex: slot.zIndex,
                  background: isDragging || isResizingSlot ? "rgba(220,38,38,0.25)" : "rgba(255,255,255,0.08)",
                  border: editMode ? "1.5px dashed rgba(220,38,38,0.7)" : "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 4,
                  cursor: editMode ? (isDragging ? "grabbing" : "grab") : "default",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: isDragging || isResizingSlot ? "none" : "left 0.15s, top 0.15s, width 0.15s, height 0.15s",
                  userSelect: "none",
                  boxSizing: "border-box",
                }}
              >
                <span style={{ fontSize: 10, color: "#e2e8f0", fontWeight: 600, pointerEvents: "none" }}>
                  {idx + 1}
                </span>
                {editMode && (
                  <>
                    {/* z-index controls */}
                    <div style={{ display: "flex", gap: 2, marginTop: 2 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); bringForward(slot.id); }}
                        style={zBtnStyle}
                        title="Bring forward"
                      >
                        ▲
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); sendBackward(slot.id); }}
                        style={zBtnStyle}
                        title="Send backward"
                      >
                        ▼
                      </button>
                    </div>
                    {/* Resize handle */}
                    <div
                      onMouseDown={(e) => onResizeMouseDown(e, slot.id)}
                      style={{
                        position: "absolute",
                        right: 0,
                        bottom: 0,
                        width: 12,
                        height: 12,
                        cursor: "nwse-resize",
                        background: "rgba(220,38,38,0.6)",
                        borderRadius: "0 0 3px 0",
                      }}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Adjust mode selector */}
      <div style={{ padding: "4px 12px 8px" }}>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
          When participants join
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["suggest", "auto", "manual"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => changeAdjustMode(mode)}
              style={{
                ...adjustBtnStyle,
                border: adjustMode === mode ? "1px solid #dc2626" : "1px solid rgba(255,255,255,0.08)",
                background: adjustMode === mode ? "rgba(220,38,38,0.15)" : "rgba(255,255,255,0.03)",
              }}
            >
              {mode === "suggest" ? "Suggest" : mode === "auto" ? "Auto-adjust" : "Manual only"}
            </button>
          ))}
        </div>
      </div>

      {/* Reset button */}
      <div style={{ padding: "4px 12px 12px" }}>
        <button
          onClick={() => {
            const preset = suggestPreset(participantCount);
            applyPreset(preset);
          }}
          disabled={saving}
          style={{
            ...btnSmallSecondary,
            width: "100%",
            padding: "6px 0",
            fontSize: 11,
          }}
        >
          Reset Layout
        </button>
      </div>

      {/* Inline toast */}
      {toast && (
        <div style={toastStyle}>{toast}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline styles (matching the app's dark theme + red accent)
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  width: 380,
  maxHeight: "70vh",
  overflowY: "auto",
  background: "rgba(20, 20, 20, 0.98)",
  borderRadius: "0.75rem",
  border: "1px solid rgba(220, 38, 38, 0.4)",
  backdropFilter: "blur(20px)",
  boxShadow: "0 20px 60px rgba(220, 38, 38, 0.15)",
  color: "#f9fafb",
  display: "flex",
  flexDirection: "column",
  position: "relative",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#94a3b8",
  cursor: "pointer",
  fontSize: 14,
  padding: "2px 6px",
  borderRadius: 4,
};

const presetBtnStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
  padding: "8px 4px",
  borderRadius: 8,
  cursor: "pointer",
  color: "#e2e8f0",
  transition: "background 0.15s, border-color 0.15s",
};

const canvasPreviewStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  paddingBottom: `${(CANVAS_HEIGHT / CANVAS_WIDTH) * 100}%`, // 16:9
  background: "rgba(0,0,0,0.6)",
  borderRadius: 6,
  overflow: "hidden",
  border: "1px solid rgba(255,255,255,0.06)",
};

const btnSmallPrimary: React.CSSProperties = {
  background: "#dc2626",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  padding: "3px 8px",
  cursor: "pointer",
};

const btnSmallSecondary: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  color: "#e2e8f0",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 500,
  padding: "3px 8px",
  cursor: "pointer",
};

const adjustBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "5px 6px",
  borderRadius: 6,
  cursor: "pointer",
  color: "#e2e8f0",
  fontSize: 11,
  fontWeight: 600,
  textAlign: "center",
};

const zBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.12)",
  border: "none",
  color: "#e2e8f0",
  fontSize: 8,
  borderRadius: 2,
  cursor: "pointer",
  padding: "1px 4px",
  lineHeight: 1,
};

const suggestionBarStyle: React.CSSProperties = {
  background: "rgba(220,38,38,0.12)",
  borderBottom: "1px solid rgba(220,38,38,0.3)",
  padding: "8px 12px",
  color: "#fca5a5",
};

const toastStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 8,
  left: "50%",
  transform: "translateX(-50%)",
  background: "rgba(17, 24, 39, 0.9)",
  color: "#f9fafb",
  padding: "4px 12px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: "nowrap",
  pointerEvents: "none",
  boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
};
