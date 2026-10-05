/**
 * Editor export policy (pure): plan export caps, allowed options and the
 * quality -> encoder mapping. Shared by POST /api/editing/export, the
 * export-options endpoint and the render plan.
 *
 * Plan fields live on the plan document's `editing` block:
 *   editing.maxResolution   "720p" | "1080p" | "4k" | null (null/missing = no cap)
 *   editing.exportsPerMonth limitsVersion 2: null = unlimited, 0 = none, n = cap
 *                           legacy (never admin-editable): 0/missing = unlimited
 *   editing.unlimitedExports legacy: true = unlimited
 *   editing.export.priorityQueue  boolean
 */

export const EXPORT_RESOLUTIONS = ["720p", "1080p", "4k"] as const;
export type ExportResolution = (typeof EXPORT_RESOLUTIONS)[number];

export const EXPORT_FORMATS = ["mp4", "webm", "mov"] as const;
export const EXPORT_QUALITIES = ["draft", "standard", "high"] as const;
export type ExportQuality = (typeof EXPORT_QUALITIES)[number];
export const EXPORT_FPS = [24, 30, 60] as const;
export type ExportFps = (typeof EXPORT_FPS)[number];

/** Plan resolution cap; null = no cap. Accepts "4K" and other casings. */
export function parseMaxResolution(raw: unknown): ExportResolution | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return (EXPORT_RESOLUTIONS as readonly string[]).includes(v) ? (v as ExportResolution) : null;
}

export function allowedResolutions(max: ExportResolution | null): ExportResolution[] {
  if (!max) return [...EXPORT_RESOLUTIONS];
  return EXPORT_RESOLUTIONS.slice(0, EXPORT_RESOLUTIONS.indexOf(max) + 1);
}

export function resolutionAllowed(requested: unknown, max: ExportResolution | null): boolean {
  return allowedResolutions(max).includes(String(requested) as ExportResolution);
}

/** Monthly export cap from a plan's editing block (null = unlimited, 0 = none). */
export function readExportLimit(editing: any): number | null {
  const e = editing && typeof editing === "object" ? editing : {};
  const raw = e.exportsPerMonth;
  if (Number(e.limitsVersion) === 2) {
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  }
  // Legacy docs: these fields were never admin-editable; 0/missing meant "no cap".
  if (e.unlimitedExports === true) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export function readPriorityQueue(editing: any): boolean {
  return editing?.export?.priorityQueue === true;
}

export function normalizeFps(raw: unknown): ExportFps {
  const n = Number(raw);
  return (EXPORT_FPS as readonly number[]).includes(n) ? (n as ExportFps) : 30;
}

export function exportLimitReached(used: number, limit: number | null): boolean {
  return limit !== null && used >= limit;
}

/** Encoder settings per quality. x264 for mp4/mov, VP9 for webm. */
export function qualityEncoding(
  quality: unknown,
  container: string
): { crf: number; preset?: string } {
  const q: ExportQuality = (EXPORT_QUALITIES as readonly string[]).includes(String(quality))
    ? (quality as ExportQuality)
    : "standard";
  if (container === "webm") {
    return { crf: q === "draft" ? 40 : q === "high" ? 28 : 33 };
  }
  if (q === "draft") return { crf: 28, preset: "veryfast" };
  if (q === "high") return { crf: 18, preset: "medium" };
  return { crf: 23, preset: "fast" };
}

/**
 * Transition tiers from the plan's editing.transitions block. Explicit
 * booleans are respected; missing means included (new feature, admins opt
 * plans out). basic = fade / dip to black, advanced = crossfade.
 */
export function readTransitionAccess(editing: any): { basic: boolean; advanced: boolean } {
  const t = editing?.transitions;
  return {
    basic: t?.basic === false ? false : true,
    advanced: t?.advanced === false ? false : true,
  };
}

export function transitionTier(type: unknown): "basic" | "advanced" | null {
  if (type === "fade" || type === "dip_to_black") return "basic";
  if (type === "crossfade") return "advanced";
  return null;
}

/** First transition in the timeline the plan doesn't include (null = all allowed). */
export function firstDisallowedTransition(
  clips: Array<{ transitionIn?: { type: string } | null }>,
  access: { basic: boolean; advanced: boolean },
): string | null {
  for (const c of clips) {
    const tier = transitionTier(c.transitionIn?.type);
    if (tier && !access[tier]) return c.transitionIn!.type;
  }
  return null;
}
