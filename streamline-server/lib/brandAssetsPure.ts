/**
 * Pure helpers for uploaded brand images (no I/O, unit-tested).
 *
 * Logos and video backgrounds uploaded from the branding editors live in R2
 * under
 *   brand-assets/{uid}/{assetId}.{ext}
 * and are referenced from brand kits / channel branding by a stable public
 * URL on this API:
 *   {apiBase}/api/public/brand-assets/{uid}/{assetId}.{ext}
 * That URL redirects to a short-lived presigned R2 URL. Kits keep storing a
 * plain http(s) URL, so the viewer page, the egress compositor and the
 * existing URL validators work unchanged, and pasted URLs keep working.
 *
 * Brand images are public by design (they're shown on public viewer pages and
 * burned into the stream), so the GET route needs no auth. Asset ids are
 * random and the route only ever resolves keys under brand-assets/.
 */

export const BRAND_ASSET_PREFIX = "brand-assets";
export const BRAND_ASSET_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
/** Upper bound on stored images per account (abuse guard; images are never shared between accounts). */
export const BRAND_ASSET_MAX_PER_OWNER = 200;
/** Presigned R2 URL lifetime behind the public redirect. */
export const BRAND_ASSET_URL_TTL_SECONDS = 60 * 60;
/** How long clients may cache the redirect; must stay well under the presign TTL. */
export const BRAND_ASSET_REDIRECT_MAX_AGE_SECONDS = 10 * 60;

export type BrandImageType = { ext: "png" | "jpg" | "gif" | "webp"; contentType: string };

const EXT_CONTENT_TYPE: Record<BrandImageType["ext"], string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** Bytes needed by detectImageType. */
export const IMAGE_SNIFF_BYTES = 12;

/**
 * Detects the image format from the file's leading bytes. The stored content
 * type comes from here, never from the client's MIME type or file name, so a
 * renamed HTML/SVG file can't be served from our bucket. SVG is deliberately
 * not accepted: it can carry script.
 */
export function detectImageType(head: Uint8Array): BrandImageType | null {
  const b = head;
  if (!b || b.length < 4) return null;
  const at = (i: number) => (i < b.length ? b[i] : -1);
  const ascii = (start: number, s: string) => {
    for (let i = 0; i < s.length; i++) if (at(start + i) !== s.charCodeAt(i)) return false;
    return true;
  };
  if (at(0) === 0x89 && ascii(1, "PNG") && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) {
    return { ext: "png", contentType: EXT_CONTENT_TYPE.png };
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { ext: "jpg", contentType: EXT_CONTENT_TYPE.jpg };
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return { ext: "gif", contentType: EXT_CONTENT_TYPE.gif };
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return { ext: "webp", contentType: EXT_CONTENT_TYPE.webp };
  return null;
}

/** Same rule as chat attachments: ids usable verbatim as a key segment. */
export function isKeySafeOwnerId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(String(id || ""));
}

const ASSET_FILE_RE = /^([a-f0-9]{24})\.(png|jpg|gif|webp)$/;

export function isBrandAssetFileName(file: string): boolean {
  return ASSET_FILE_RE.test(String(file || ""));
}

export function brandAssetFileName(assetId: string, ext: BrandImageType["ext"]): string {
  const file = `${assetId}.${ext}`;
  if (!isBrandAssetFileName(file)) throw new Error("brand asset: invalid asset id");
  return file;
}

/** Every brand image of one account (account purge, per-owner cap). */
export function brandAssetPrefix(uid: string): string {
  if (!isKeySafeOwnerId(uid)) throw new Error("brand asset: invalid owner id");
  return `${BRAND_ASSET_PREFIX}/${uid}/`;
}

/** Storage key for a validated owner + file name; throws on anything else. */
export function brandAssetKey(uid: string, file: string): string {
  if (!isBrandAssetFileName(file)) throw new Error("brand asset: invalid file name");
  return `${brandAssetPrefix(uid)}${file}`;
}

/**
 * Storage key for the public GET route's params, or null when they don't
 * name a brand asset (so nothing outside brand-assets/ can be resolved).
 */
export function brandAssetKeyFromParams(uid: unknown, file: unknown): string | null {
  const u = typeof uid === "string" ? uid : "";
  const f = typeof file === "string" ? file : "";
  if (!isKeySafeOwnerId(u) || !isBrandAssetFileName(f)) return null;
  return `${BRAND_ASSET_PREFIX}/${u}/${f}`;
}

/** Content type for a stored file name (from its validated extension). */
export function brandAssetContentType(file: string): string | null {
  const m = ASSET_FILE_RE.exec(String(file || ""));
  return m ? EXT_CONTENT_TYPE[m[2] as BrandImageType["ext"]] : null;
}

/** The stable public URL saved into brand kits / channel branding. */
export function brandAssetPublicUrl(apiBase: string, uid: string, file: string): string {
  const base = String(apiBase || "").replace(/\/+$/, "");
  // Validates both segments.
  brandAssetKey(uid, file);
  return `${base}/api/public/brand-assets/${encodeURIComponent(uid)}/${file}`;
}

/**
 * Public origin of this API for building asset URLs. Prefers the same
 * configured origin the egress compositor uses (it must be able to fetch the
 * image), then the request's own origin (trust proxy is on, so protocol/host
 * reflect what the browser called).
 */
export function resolvePublicApiBase(configuredBase: string | null, reqProtocol: string, reqHost: string): string | null {
  if (configuredBase && /^https?:\/\//i.test(configuredBase)) return configuredBase.replace(/\/+$/, "");
  const host = String(reqHost || "").trim();
  const proto = String(reqProtocol || "").trim().toLowerCase();
  if (!host || (proto !== "https" && proto !== "http")) return null;
  return `${proto}://${host}`;
}
