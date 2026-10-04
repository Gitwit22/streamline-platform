// ============================================================================
// Disk-spooled multipart uploads
//
// multer.memoryStorage() with a 500 MB limit can exhaust a 512 MB instance.
// Uploads are spooled to os.tmpdir() instead and streamed to R2 from disk.
// Callers must call cleanupUploadedFile() in a finally block.
// ============================================================================

import multer from "multer";
import os from "os";
import fs from "fs";
import crypto from "crypto";

/** Shape of a multer disk-storage file; declared locally so the build doesn't
 * depend on @types/multer's global Express.Multer augmentation. */
export interface UploadedDiskFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
}

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

export function createDiskUpload(maxBytes: number = MAX_UPLOAD_BYTES) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, os.tmpdir()),
      // Random name: never trust originalname for a filesystem path.
      filename: (_req, _file, cb) => cb(null, `sl_upload_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`),
    }),
    limits: { fileSize: maxBytes, files: 1 },
  });
}

/** Best-effort removal of a multer temp file. Safe to call with undefined. */
export async function cleanupUploadedFile(file: { path?: string } | undefined | null): Promise<void> {
  const p = file?.path;
  if (!p) return;
  try {
    await fs.promises.unlink(p);
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.warn("[upload] failed to remove temp file", { path: p, error: err?.message || err });
    }
  }
}
