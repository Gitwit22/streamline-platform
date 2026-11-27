/**
 * Uploaded brand images (logo, video background).
 *
 * Server: streamline-server/routes/brandAssets.ts. The upload returns a
 * stable public URL on the API that the editors save into logoUrl /
 * video.backgroundImageUrl exactly like a pasted URL, so nothing downstream
 * changes.
 */
import { API_BASE } from "./apiBase";
import { apiFetchAuth } from "./api";

/** Mirrors BRAND_ASSET_MAX_BYTES on the server. */
export const BRAND_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const BRAND_IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";
const ALLOWED_MIME = new Set(BRAND_IMAGE_ACCEPT.split(","));

/** Client-side precheck; the server re-checks the actual bytes. Returns an error message or null. */
export function validateBrandImageFile(file: { type: string; size: number }): string | null {
  if (!ALLOWED_MIME.has(String(file.type || "").toLowerCase())) return "Use a PNG, JPG, GIF or WebP image.";
  if (!(file.size > 0)) return "That file is empty.";
  if (file.size > BRAND_IMAGE_MAX_BYTES) return "Images must be 5 MB or smaller.";
  return null;
}

const ERRORS: Record<string, string> = {
  file_too_large: "Images must be 5 MB or smaller.",
  image_type_not_allowed: "Use a PNG, JPG, GIF or WebP image.",
  empty_file: "That file is empty.",
  brand_kits_not_in_plan: "Uploading images is not included in your plan.",
  feature_disabled: "Branding is temporarily disabled.",
  brand_asset_limit_reached: "You've reached the limit of uploaded images for your account.",
  storage_unavailable: "Uploads are unavailable right now. Paste an image link instead.",
  public_url_unavailable: "Uploads are unavailable right now. Paste an image link instead.",
  rate_limited: "Too many uploads. Wait a few minutes and try again.",
};

/** Uploads the image and resolves to the URL to save. Throws with a user-facing message. */
export async function uploadBrandImage(file: File): Promise<string> {
  const invalid = validateBrandImageFile(file);
  if (invalid) throw new Error(invalid);
  const form = new FormData();
  form.append("file", file, file.name);
  let res: Response;
  try {
    res = await apiFetchAuth(`${API_BASE}/api/brand-assets`, { method: "POST", body: form }, { allowNonOk: true });
  } catch {
    throw new Error("Upload failed. Check your connection and try again.");
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok || typeof payload?.url !== "string" || !payload.url) {
    throw new Error(ERRORS[String(payload?.error || "")] || "Upload failed. Try again.");
  }
  return payload.url;
}
