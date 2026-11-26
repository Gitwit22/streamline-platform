import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import { requireAuth } from "../middleware/requireAuth";
import { LIMIT_ERRORS } from "../lib/limitErrors";
import { cleanupUploadedFile, createDiskUpload, type UploadedDiskFile } from "../lib/diskUpload";
import { egressTemplateBase } from "../lib/egressTemplate";
import { SlidingWindowLimiter, rateLimit } from "../lib/rateLimit";
import { isR2Configured, listKeysByPrefix, presignGetQuiet, uploadFileFromPath } from "../lib/storageClient";
import {
  BRAND_ASSET_MAX_BYTES,
  BRAND_ASSET_MAX_PER_OWNER,
  BRAND_ASSET_REDIRECT_MAX_AGE_SECONDS,
  BRAND_ASSET_URL_TTL_SECONDS,
  IMAGE_SNIFF_BYTES,
  brandAssetFileName,
  brandAssetKey,
  brandAssetKeyFromParams,
  brandAssetPrefix,
  brandAssetPublicUrl,
  detectImageType,
  isKeySafeOwnerId,
  resolvePublicApiBase,
} from "../lib/brandAssetsPure";
import { getBrandKitAccess } from "../services/brandKits";

/**
 * Uploaded brand images (logo, video background). See lib/brandAssetsPure.ts.
 *
 *   POST /api/brand-assets                         (auth, multipart "file") -> { url, contentType, size }
 *   GET  /api/public/brand-assets/:uid/:file       (public) -> 302 to a presigned R2 URL
 *
 * Uploading needs the same plan access as editing branding (either brand-kit
 * feature). The returned URL is what the editors save into logoUrl /
 * video.backgroundImageUrl.
 */
export const brandAssetsUploadRouter = Router();
export const brandAssetsPublicRouter = Router();

const upload = createDiskUpload(BRAND_ASSET_MAX_BYTES);
// 30 images / 10 min per account (per process).
const uploadLimiter = new SlidingWindowLimiter({ windowMs: 10 * 60_000, max: 30 });

function receiveImage(req: any, res: any, next: any) {
  upload.single("file")(req, res, (err: any) => {
    if (!err) return next();
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "file_too_large", maxBytes: BRAND_ASSET_MAX_BYTES });
    }
    return res.status(400).json({ error: "upload_failed" });
  });
}

async function readHead(path: string, bytes: number): Promise<Buffer> {
  const fh = await fs.promises.open(path, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

brandAssetsUploadRouter.post(
  "/",
  requireAuth as any,
  rateLimit([
    {
      limiter: uploadLimiter,
      key: (req) => {
        const uid = (req as any).user?.uid;
        return uid ? `brandasset:${uid}` : null;
      },
    },
  ]),
  // Plan + storage checks before accepting the body, so a denied request
  // never spools a file to disk.
  async (req: any, res, next) => {
    const uid = String(req.user?.uid || "");
    if (!uid) return res.status(401).json({ error: "unauthorized" });
    if (!isKeySafeOwnerId(uid)) return res.status(400).json({ error: "unsupported_account_id" });
    if (!isR2Configured()) return res.status(503).json({ error: "storage_unavailable" });
    try {
      const access = await getBrandKitAccess(uid);
      if (!access.any) {
        return res.status(403).json({
          error: access.viewer.code === LIMIT_ERRORS.FEATURE_DISABLED ? LIMIT_ERRORS.FEATURE_DISABLED : "brand_kits_not_in_plan",
        });
      }
    } catch (err) {
      console.error("POST /api/brand-assets access check failed", err);
      return res.status(500).json({ error: "server_error" });
    }
    return next();
  },
  receiveImage,
  async (req: any, res) => {
    const file = req.file as UploadedDiskFile | undefined;
    const uid = String(req.user?.uid || "");
    try {
      if (!file) return res.status(400).json({ error: "file_required" });
      if (!(file.size > 0)) return res.status(400).json({ error: "empty_file" });

      const type = detectImageType(await readHead(file.path, IMAGE_SNIFF_BYTES));
      if (!type) return res.status(415).json({ error: "image_type_not_allowed" });

      const base = resolvePublicApiBase(egressTemplateBase(), req.protocol, String(req.get("host") || ""));
      if (!base) return res.status(503).json({ error: "public_url_unavailable" });

      const existing = await listKeysByPrefix(brandAssetPrefix(uid), BRAND_ASSET_MAX_PER_OWNER);
      if (existing.length >= BRAND_ASSET_MAX_PER_OWNER) {
        return res.status(409).json({ error: "brand_asset_limit_reached", limit: BRAND_ASSET_MAX_PER_OWNER });
      }

      const fileName = brandAssetFileName(crypto.randomBytes(12).toString("hex"), type.ext);
      // Upload first; the URL is only handed out once the object exists.
      await uploadFileFromPath(file.path, brandAssetKey(uid, fileName), type.contentType);

      return res.status(201).json({
        url: brandAssetPublicUrl(base, uid, fileName),
        contentType: type.contentType,
        size: file.size,
      });
    } catch (err: any) {
      console.error("[brandAssets] upload failed", { error: String(err?.message || err) });
      return res.status(500).json({ error: "upload_failed" });
    } finally {
      await cleanupUploadedFile(file);
    }
  }
);

brandAssetsPublicRouter.get("/:uid/:file", async (req, res) => {
  const key = brandAssetKeyFromParams(req.params.uid, req.params.file);
  if (!key) return res.status(404).json({ error: "not_found" });
  if (!isR2Configured()) return res.status(503).json({ error: "storage_unavailable" });
  try {
    const url = await presignGetQuiet(key, BRAND_ASSET_URL_TTL_SECONDS);
    res.setHeader("Cache-Control", `public, max-age=${BRAND_ASSET_REDIRECT_MAX_AGE_SECONDS}`);
    return res.redirect(302, url);
  } catch (err: any) {
    console.error("[brandAssets] presign failed", { error: String(err?.message || err) });
    return res.status(500).json({ error: "server_error" });
  }
});
