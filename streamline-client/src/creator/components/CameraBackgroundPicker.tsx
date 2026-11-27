import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import {
  CAMERA_BACKGROUND_PRESETS,
  CUSTOM_IMAGE_ACCEPT,
  CUSTOM_IMAGE_ID,
  NO_EFFECT,
  cameraEffectStore,
  prepareCustomBackground,
  renderPresetBackground,
  type CameraEffect,
} from "../../lib/cameraEffects";

function same(a: CameraEffect, b: CameraEffect) {
  return a.mode === b.mode && (a.imageId || null) === (b.imageId || null);
}

/**
 * Stage button + panel where any participant who can publish video picks a
 * camera background: none, blur, a built-in image or their own photo.
 * CameraEffectController applies the choice to the camera track.
 */
export default function CameraBackgroundPicker({ canUseCamera }: { canUseCamera: boolean }) {
  const snap = useSyncExternalStore(cameraEffectStore.subscribe, cameraEffectStore.getSnapshot);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!canUseCamera) return null;

  const active = snap.effect;
  const label = active.mode === "none" ? "Background" : active.mode === "image" ? "Background: image" : "Background: blur";

  return (
    <>
      <button
        type="button"
        className="sl-stage-bg-toggle"
        data-testid="camera-background-toggle"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        title="Blur or replace your camera background"
      >
        {label}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Camera background"
          className="sl-stage-bg-panel"
          data-testid="camera-background-panel"
          style={panelStyle}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>Camera background</div>
            <button type="button" onClick={() => setOpen(false)} style={closeBtn} aria-label="Close">
              ×
            </button>
          </div>
          <CameraBackgroundOptions />
        </div>
      )}
    </>
  );
}

/**
 * The background choices themselves (None, blur, built-in images, your own
 * photo) with upload and status messages. Shared by the in-room picker and
 * the pre-join device check, so both write the same selection.
 */
export function CameraBackgroundOptions({ columns = 3 }: { columns?: number }) {
  const snap = useSyncExternalStore(cameraEffectStore.subscribe, cameraEffectStore.getSnapshot);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const active = snap.effect;
  const applying = snap.status.state === "applying";
  const pick = (effect: CameraEffect) => {
    setUploadError(null);
    setUploadNote(null);
    cameraEffectStore.setEffect(effect);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setUploadNote(null);
    setPreparing(true);
    try {
      const dataUrl = await prepareCustomBackground(file);
      const { persisted } = cameraEffectStore.setCustomImage(dataUrl);
      if (!persisted) setUploadNote("Your browser couldn't save this image, so it's used for this visit only.");
    } catch (e) {
      setUploadError(e instanceof Error && e.message ? e.message : "Couldn't use that image.");
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div style={{ display: "grid", gap: 10 }} data-testid="camera-background-options">
      <div style={{ ...grid, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        <Option label="None" selected={active.mode === "none"} onClick={() => pick(NO_EFFECT)}>
          <span style={{ fontSize: 18 }}>⊘</span>
        </Option>
        <Option label="Slight blur" selected={active.mode === "blur-light"} onClick={() => pick({ mode: "blur-light", imageId: null })}>
          <BlurSwatch amount={2} />
        </Option>
        <Option label="Blur" selected={active.mode === "blur-strong"} onClick={() => pick({ mode: "blur-strong", imageId: null })}>
          <BlurSwatch amount={5} />
        </Option>
        {CAMERA_BACKGROUND_PRESETS.map((p) => {
          const effect: CameraEffect = { mode: "image", imageId: p.id };
          const src = renderPresetBackground(p.id);
          return (
            <Option key={p.id} label={p.label} selected={same(active, effect)} onClick={() => pick(effect)}>
              {src ? <img src={src} alt="" style={thumbImg} /> : <span style={{ fontSize: 11 }}>{p.label}</span>}
            </Option>
          );
        })}
        {snap.customImage && (
          <Option
            label="Your image"
            selected={same(active, { mode: "image", imageId: CUSTOM_IMAGE_ID })}
            onClick={() => pick({ mode: "image", imageId: CUSTOM_IMAGE_ID })}
          >
            <img src={snap.customImage} alt="" style={thumbImg} />
          </Option>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          ref={fileRef}
          type="file"
          accept={CUSTOM_IMAGE_ACCEPT}
          aria-label="Upload your own background"
          style={{ display: "none" }}
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        <button type="button" style={secondaryBtn} disabled={preparing} onClick={() => fileRef.current?.click()}>
          {preparing ? "Preparing…" : snap.customImage ? "Change your image" : "Upload your own"}
        </button>
        {snap.customImage && (
          <button type="button" style={linkBtn} onClick={() => cameraEffectStore.removeCustomImage()}>
            Remove your image
          </button>
        )}
      </div>

      <div aria-live="polite" style={{ display: "grid", gap: 4 }}>
        {applying && <div style={hint}>Turning on the effect…</div>}
        {snap.status.state === "error" && (
          <div role="alert" style={errText}>
            {snap.status.message}
          </div>
        )}
        {uploadError && (
          <div role="alert" style={errText}>
            {uploadError}
          </div>
        )}
        {uploadNote && <div style={hint}>{uploadNote}</div>}
      </div>
      <div style={hint}>
        Everyone in the room, the stream and recordings see your background. It's processed on this device and applies
        whenever your camera is on.
      </div>
    </div>
  );
}

function Option({ label, selected, onClick, children }: { label: string; selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} title={label} style={optionStyle(selected)}>
      <span style={thumbBox}>{children}</span>
      <span style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.2 }}>{label}</span>
    </button>
  );
}

function BlurSwatch({ amount }: { amount: number }) {
  return (
    <span style={{ position: "relative", width: "100%", height: "100%", display: "block", overflow: "hidden", borderRadius: 6 }}>
      <span
        style={{
          position: "absolute",
          inset: -6,
          background: "linear-gradient(135deg,#64748b,#334155 45%,#94a3b8)",
          filter: `blur(${amount}px)`,
        }}
      />
      <span style={{ position: "absolute", left: "38%", top: "22%", width: "24%", height: "34%", borderRadius: "50%", background: "#e2e8f0" }} />
      <span style={{ position: "absolute", left: "26%", bottom: -4, width: "48%", height: "34%", borderRadius: "40% 40% 0 0", background: "#e2e8f0" }} />
    </span>
  );
}

const panelStyle: CSSProperties = {
  position: "absolute",
  top: 112,
  left: 10,
  zIndex: 30,
  width: 320,
  maxWidth: "calc(100% - 20px)",
  maxHeight: "calc(100% - 124px)",
  overflowY: "auto",
  display: "grid",
  gap: 10,
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(15,23,42,0.97)",
  color: "#e2e8f0",
  boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
};
const grid: CSSProperties = { display: "grid", gap: 8 };
function optionStyle(selected: boolean): CSSProperties {
  return {
    display: "grid",
    gap: 4,
    justifyItems: "center",
    padding: 4,
    borderRadius: 10,
    border: selected ? "2px solid #ef4444" : "2px solid transparent",
    background: selected ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.04)",
    color: "#e2e8f0",
    cursor: "pointer",
    minWidth: 0,
  };
}
const thumbBox: CSSProperties = {
  width: "100%",
  aspectRatio: "16 / 9",
  borderRadius: 6,
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(255,255,255,0.06)",
};
const thumbImg: CSSProperties = { width: "100%", height: "100%", objectFit: "cover", display: "block" };
const secondaryBtn: CSSProperties = {
  padding: "7px 12px",
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,0.4)",
  background: "rgba(30,41,59,0.8)",
  color: "#e5e7eb",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};
const linkBtn: CSSProperties = { background: "none", border: "none", color: "#93c5fd", fontSize: 12, cursor: "pointer", padding: 0 };
const closeBtn: CSSProperties = { ...linkBtn, color: "#cbd5e1", fontSize: 20, lineHeight: 1 };
const hint: CSSProperties = { fontSize: 11, color: "#94a3b8", lineHeight: 1.4 };
const errText: CSSProperties = { fontSize: 12, color: "#fca5a5", lineHeight: 1.4 };
