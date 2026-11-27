/**
 * Camera background effects (blur / virtual background) for room participants.
 *
 * The effect runs on the participant's own device: a LiveKit track processor
 * (@livekit/track-processors, MediaPipe selfie segmentation) replaces the
 * published camera track, so everyone sees it, including the program stage,
 * stream outputs and recordings. Nothing is stored on the server; the choice
 * is remembered per browser in localStorage.
 *
 * This module holds the selection (a tiny external store shared by the
 * picker UI and the controller that applies it) and the pure mapping to
 * processor options. Applying lives in components/CameraEffectController.tsx.
 */

export type CameraEffectMode = "none" | "blur-light" | "blur-strong" | "image";

export type CameraEffect = {
  mode: CameraEffectMode;
  /** For mode "image": a preset id from CAMERA_BACKGROUND_PRESETS, or "custom". */
  imageId: string | null;
};

export type CameraEffectStatus =
  | { state: "idle" }
  | { state: "applying" }
  | { state: "error"; message: string };

export const NO_EFFECT: CameraEffect = { mode: "none", imageId: null };

export const BLUR_RADIUS = { "blur-light": 6, "blur-strong": 14 } as const;

export type BackgroundPreset = { id: string; label: string };

/** Built-in backgrounds, drawn at runtime by renderPresetBackground (no image files to host). */
export const CAMERA_BACKGROUND_PRESETS: BackgroundPreset[] = [
  { id: "studio", label: "Studio" },
  { id: "lights", label: "City lights" },
  { id: "sunset", label: "Sunset" },
  { id: "ocean", label: "Ocean" },
  { id: "forest", label: "Forest" },
];

export const CUSTOM_IMAGE_ID = "custom";
export const EFFECT_STORAGE_KEY = "sl_camera_effect";
export const CUSTOM_IMAGE_STORAGE_KEY = "sl_camera_effect_custom";

const MODES: CameraEffectMode[] = ["none", "blur-light", "blur-strong", "image"];
const PRESET_IDS = new Set(CAMERA_BACKGROUND_PRESETS.map((p) => p.id));

/** Validates a stored/parsed value; anything unexpected reads as no effect. */
export function normalizeCameraEffect(raw: unknown): CameraEffect {
  if (!raw || typeof raw !== "object") return NO_EFFECT;
  const r = raw as Record<string, unknown>;
  const mode = MODES.includes(r.mode as CameraEffectMode) ? (r.mode as CameraEffectMode) : "none";
  if (mode !== "image") return { mode, imageId: null };
  const imageId = typeof r.imageId === "string" ? r.imageId : "";
  if (imageId === CUSTOM_IMAGE_ID || PRESET_IDS.has(imageId)) return { mode, imageId };
  return NO_EFFECT;
}

export type ProcessorOptions =
  | { mode: "disabled" }
  | { mode: "background-blur"; blurRadius: number }
  | { mode: "virtual-background"; imagePath: string };

/**
 * Maps a selection to @livekit/track-processors switchTo() options. Returns
 * disabled when an image effect has no usable image (e.g. a custom image
 * that couldn't be kept), so callers never pass an empty path.
 */
export function processorOptionsFor(effect: CameraEffect, imageUrl: string | null): ProcessorOptions {
  if (effect.mode === "blur-light" || effect.mode === "blur-strong") {
    return { mode: "background-blur", blurRadius: BLUR_RADIUS[effect.mode] };
  }
  if (effect.mode === "image" && imageUrl) return { mode: "virtual-background", imagePath: imageUrl };
  return { mode: "disabled" };
}

// ── Store ───────────────────────────────────────────────────────────────

type Snapshot = { effect: CameraEffect; customImage: string | null; status: CameraEffectStatus };

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Returns false when the browser refused to store it (quota, private mode). */
function safeSet(key: string, value: string | null): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function load(): Snapshot {
  let effect = NO_EFFECT;
  try {
    const raw = safeGet(EFFECT_STORAGE_KEY);
    effect = normalizeCameraEffect(raw ? JSON.parse(raw) : null);
  } catch {
    effect = NO_EFFECT;
  }
  const stored = safeGet(CUSTOM_IMAGE_STORAGE_KEY);
  const customImage = stored && stored.startsWith("data:image/") ? stored : null;
  // A custom background whose image is gone can't be shown.
  if (effect.mode === "image" && effect.imageId === CUSTOM_IMAGE_ID && !customImage) effect = NO_EFFECT;
  return { effect, customImage, status: { state: "idle" } };
}

let snapshot: Snapshot | null = null;
const listeners = new Set<() => void>();

function current(): Snapshot {
  if (!snapshot) snapshot = load();
  return snapshot;
}

function emit(next: Snapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

export const cameraEffectStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): Snapshot {
    return current();
  },
  setEffect(effect: CameraEffect) {
    const next = normalizeCameraEffect(effect);
    safeSet(EFFECT_STORAGE_KEY, JSON.stringify(next));
    emit({ ...current(), effect: next, status: { state: "idle" } });
  },
  /**
   * Keeps a custom background (a data: URL already downscaled by the caller)
   * and selects it. If the browser won't store it, it still works for this
   * visit and `persisted` is false.
   */
  setCustomImage(dataUrl: string): { persisted: boolean } {
    const persisted = safeSet(CUSTOM_IMAGE_STORAGE_KEY, dataUrl);
    const effect: CameraEffect = { mode: "image", imageId: CUSTOM_IMAGE_ID };
    safeSet(EFFECT_STORAGE_KEY, JSON.stringify(effect));
    emit({ ...current(), customImage: dataUrl, effect, status: { state: "idle" } });
    return { persisted };
  },
  removeCustomImage() {
    safeSet(CUSTOM_IMAGE_STORAGE_KEY, null);
    const s = current();
    const effect = s.effect.imageId === CUSTOM_IMAGE_ID ? NO_EFFECT : s.effect;
    if (effect !== s.effect) safeSet(EFFECT_STORAGE_KEY, JSON.stringify(effect));
    emit({ ...s, customImage: null, effect });
  },
  setStatus(status: CameraEffectStatus) {
    emit({ ...current(), status });
  },
  /**
   * The effect couldn't be applied: go back to no effect so the picker shows
   * what everyone actually sees, and say why.
   */
  fail(message: string) {
    safeSet(EFFECT_STORAGE_KEY, JSON.stringify(NO_EFFECT));
    emit({ ...current(), effect: NO_EFFECT, status: { state: "error", message } });
  },
  /** Test hook: re-read storage. */
  reset() {
    snapshot = null;
    listeners.forEach((l) => l());
  },
};

// ── Images (browser only) ──────────────────────────────────────────────

const PRESET_W = 1280;
const PRESET_H = 720;
const presetCache = new Map<string, string>();

/** Draws a built-in background as a 16:9 JPEG data URL (cached). Null without canvas support. */
export function renderPresetBackground(id: string): string | null {
  const cached = presetCache.get(id);
  if (cached) return cached;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = PRESET_W;
  canvas.height = PRESET_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const W = PRESET_W;
  const H = PRESET_H;
  const linear = (stops: Array<[number, string]>, x0 = 0, y0 = 0, x1 = 0, y1 = H) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  const glow = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  // Deterministic pseudo-random so a preset always looks the same.
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  switch (id) {
    case "studio":
      linear([[0, "#4b5563"], [1, "#1f2937"]]);
      glow(W * 0.5, H * 0.35, W * 0.55, "rgba(243,244,246,0.35)");
      glow(W * 0.5, H * 1.1, W * 0.6, "rgba(0,0,0,0.45)");
      break;
    case "lights":
      linear([[0, "#0f172a"], [1, "#1e1b4b"]]);
      for (let i = 0; i < 46; i++) {
        const hue = [38, 48, 200, 330][i % 4];
        glow(rand() * W, H * 0.25 + rand() * H * 0.6, 20 + rand() * 60, `hsla(${hue},95%,70%,${0.25 + rand() * 0.35})`);
      }
      break;
    case "sunset":
      linear([[0, "#312e81"], [0.45, "#be185d"], [0.75, "#f97316"], [1, "#fbbf24"]]);
      glow(W * 0.68, H * 0.78, W * 0.25, "rgba(254,243,199,0.7)");
      break;
    case "ocean":
      linear([[0, "#7dd3fc"], [0.55, "#0ea5e9"], [0.56, "#0369a1"], [1, "#082f49"]]);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 3;
      for (let y = H * 0.6; y < H; y += 26) {
        ctx.beginPath();
        for (let x = 0; x <= W; x += 40) ctx.lineTo(x, y + Math.sin(x / 70 + y) * 5);
        ctx.stroke();
      }
      break;
    case "forest":
      linear([[0, "#d9f99d"], [0.5, "#4d7c0f"], [1, "#14532d"]]);
      for (let layer = 0; layer < 3; layer++) {
        ctx.fillStyle = ["rgba(20,83,45,0.45)", "rgba(20,83,45,0.7)", "rgba(5,46,22,0.9)"][layer];
        for (let i = 0; i < 14; i++) {
          const x = rand() * W;
          const base = H * (0.75 + layer * 0.1);
          const h = H * (0.35 + rand() * 0.25);
          ctx.beginPath();
          ctx.moveTo(x, base - h);
          ctx.lineTo(x - h * 0.28, base);
          ctx.lineTo(x + h * 0.28, base);
          ctx.closePath();
          ctx.fill();
        }
      }
      break;
    default:
      return null;
  }
  let url: string;
  try {
    url = canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
  presetCache.set(id, url);
  return url;
}

/** The image to use for the current selection, or null. */
export function backgroundImageFor(effect: CameraEffect, customImage: string | null): string | null {
  if (effect.mode !== "image" || !effect.imageId) return null;
  if (effect.imageId === CUSTOM_IMAGE_ID) return customImage;
  return renderPresetBackground(effect.imageId);
}

export const CUSTOM_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
export const CUSTOM_IMAGE_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Crops a picked photo to 16:9 and downscales it to 1280×720 JPEG so it's
 * small enough to remember in localStorage (~100–250 KB).
 */
export async function prepareCustomBackground(file: File): Promise<string> {
  if (!CUSTOM_IMAGE_ACCEPT.split(",").includes(file.type)) throw new Error("Use a PNG, JPG or WebP image.");
  if (file.size > CUSTOM_IMAGE_MAX_BYTES) throw new Error("That image is too large (15 MB max).");
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Couldn't read that image."));
      i.src = src;
    });
    const canvas = document.createElement("canvas");
    canvas.width = PRESET_W;
    canvas.height = PRESET_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser can't process images.");
    const scale = Math.max(PRESET_W / img.naturalWidth, PRESET_H / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, (PRESET_W - w) / 2, (PRESET_H - h) / 2, w, h);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(src);
  }
}
