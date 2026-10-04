/**
 * Resolves the public URL of the program compositor egress template
 * (public/egress-templates/program-compositor.html served at /egress-templates).
 *
 * LiveKit's egress Chromium must be able to fetch this URL, so it has to be the
 * backend's public origin:
 *   EGRESS_TEMPLATE_BASE_URL  explicit override (e.g. https://api.example.com)
 *   RENDER_EXTERNAL_URL       provided automatically by Render for web services
 * When neither is set, callers fall back to LiveKit's built-in layouts (which
 * ignore the host's layout choices) and a warning is logged.
 */

export type CompositorAspect = "landscape" | "portrait";

type Env = Record<string, string | undefined>;

export function egressTemplateBase(env: Env = process.env): string | null {
  const raw = String(env.EGRESS_TEMPLATE_BASE_URL || env.RENDER_EXTERNAL_URL || "").trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw.replace(/\/+$/, "");
}

export function egressTemplateBaseSource(env: Env = process.env): "EGRESS_TEMPLATE_BASE_URL" | "RENDER_EXTERNAL_URL" | null {
  if (String(env.EGRESS_TEMPLATE_BASE_URL || "").trim()) return "EGRESS_TEMPLATE_BASE_URL";
  if (String(env.RENDER_EXTERNAL_URL || "").trim()) return "RENDER_EXTERNAL_URL";
  return null;
}

/** Full compositor URL for the given orientation, or null when no base is configured. */
export function compositorUrl(aspect: CompositorAspect, env: Env = process.env): string | null {
  const base = egressTemplateBase(env);
  if (!base) return null;
  return `${base}/egress-templates/program-compositor.html?aspect=${aspect}`;
}

/**
 * Orientation for an Instagram destination.  Instagram Live / Reels are
 * vertical, so the client's hint ("instagram_reels_9x16") – and any unknown
 * or missing hint – renders the portrait program layout.  Only an explicit
 * landscape hint (e.g. "landscape_16x9") keeps 16:9.
 */
export function instagramAspectFor(layoutPreset: string | null | undefined): CompositorAspect {
  const v = String(layoutPreset || "").toLowerCase();
  if (v === "landscape" || v === "landscape_16x9") return "landscape";
  return "portrait";
}

const warned = new Set<string>();

/** Logs (once per context) that the built-in LiveKit layout is being used. */
export function warnBuiltInLayoutFallback(context: string, builtInLayout: string): void {
  if (warned.has(context)) return;
  warned.add(context);
  console.warn(
    `[egress:${context}] EGRESS_TEMPLATE_BASE_URL (or RENDER_EXTERNAL_URL) is not set – ` +
      `falling back to LiveKit built-in layout "${builtInLayout}". The host's program layout ` +
      `(🎬 Layout picker) will NOT be reflected in this output. Set EGRESS_TEMPLATE_BASE_URL ` +
      `to this backend's public https origin.`,
  );
}
