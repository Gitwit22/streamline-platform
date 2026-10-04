/**
 * Temporary uploads (hourly): removes OUR leftovers from os.tmpdir().
 *
 *   sl_upload_*  multer disk-spooled uploads (lib/diskUpload.ts) older than
 *                TEMP_UPLOAD_MAX_AGE_MS (default 2h). Routes delete them in a
 *                finally block; these are only leftovers from crashes/aborts.
 *   sl_export_*  render worker work dirs older than TEMP_EXPORT_DIR_MAX_AGE_MS
 *                (default 12h; renders are reaped after 30 min).
 *
 * Only names with those prefixes, directly inside os.tmpdir(), are touched.
 * Note: each instance has its own disk, so on multi-instance deploys this
 * cleans the instance that wins the lease; others are cleaned on later runs
 * that they win (and on restart, since Render disks are ephemeral).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { defineJob } from "./framework";
import { EXPORT_WORKDIR_PREFIX, UPLOAD_TEMP_PREFIX, envNumber, isExpiredTempEntry } from "./pure";

const MAX_ENTRIES_PER_RUN = 2_000;

export async function cleanupTempUploads(
  nowMs: number,
  opts: { dir?: string; uploadMaxAgeMs?: number; exportDirMaxAgeMs?: number } = {}
): Promise<{ deleted: number; scanned: number; bytes: number; errors: number }> {
  const dir = opts.dir ?? os.tmpdir();
  const uploadMaxAge = opts.uploadMaxAgeMs ?? envNumber(process.env.TEMP_UPLOAD_MAX_AGE_MS, 2 * 60 * 60_000);
  const exportMaxAge = opts.exportDirMaxAgeMs ?? envNumber(process.env.TEMP_EXPORT_DIR_MAX_AGE_MS, 12 * 60 * 60_000);
  const out = { deleted: 0, scanned: 0, bytes: 0, errors: 0 };

  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch (e: any) {
    if (e?.code === "ENOENT") return out;
    throw e;
  }

  for (const name of names) {
    const isUpload = name.startsWith(UPLOAD_TEMP_PREFIX);
    const isExport = name.startsWith(EXPORT_WORKDIR_PREFIX);
    if (!isUpload && !isExport) continue;
    if (out.scanned >= MAX_ENTRIES_PER_RUN) break;
    out.scanned += 1;
    const full = path.join(dir, name);
    try {
      const st = await fs.promises.lstat(full);
      if (st.isSymbolicLink()) continue;
      if (isUpload && st.isFile() && isExpiredTempEntry(name, st.mtimeMs, nowMs, uploadMaxAge, [UPLOAD_TEMP_PREFIX])) {
        await fs.promises.unlink(full);
        out.deleted += 1;
        out.bytes += st.size;
      } else if (isExport && st.isDirectory() && isExpiredTempEntry(name, st.mtimeMs, nowMs, exportMaxAge, [EXPORT_WORKDIR_PREFIX])) {
        await fs.promises.rm(full, { recursive: true, force: true });
        out.deleted += 1;
      }
    } catch (e: any) {
      if (e?.code !== "ENOENT") {
        out.errors += 1;
        console.warn("[jobs/temp-uploads] failed to remove", { path: full, error: e?.message || e });
      }
    }
  }
  return out;
}

export const tempUploadsJob = defineJob({
  name: "temp-uploads",
  title: "Temporary Uploads",
  description: "Deletes leftover sl_upload_* files (> 2h) and sl_export_* render dirs (> 12h) from the instance temp dir.",
  intervalMs: 60 * 60_000,
  highlight: "deleted",
  async run(ctx) {
    const r = await cleanupTempUploads(ctx.now.getTime());
    return {
      processed: r.deleted,
      details: { deleted: r.deleted, scanned: r.scanned, freedBytes: r.bytes, errors: r.errors, instance: ctx.instanceId },
    };
  },
});
