// ============================================================================
// Render Worker — processes export jobs using FFmpeg
//
// This module provides:
//   1. processExportJob(job)  — end-to-end handler for a single job
//   2. startExportWorker()    — background poller that claims & processes jobs
//
// The worker downloads source media, builds an FFmpeg command from the
// timeline edit decision list, runs the render, uploads the result to R2,
// and updates the job record.
// ============================================================================

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import http from "http";
import { logger } from "./logger";
import { uploadVideo } from "./storageClient";
import { reserveStorageIfAvailable, releaseReservedStorage, reserveStorageUsage } from "../usageHelper";
import {
  claimNextJob,
  updateExportJob,
  failJob,
  completeJob,
  getExportJob,
} from "./exportQueue";
import type { ExportJobDoc, ExportTimeline, ExportTimelineClip } from "./exportTypes";
import { resolutionToDimensions, formatToContainer } from "./exportTypes";

// ============================================================================
// Config
// ============================================================================

const POLL_INTERVAL_MS = Number(process.env.EXPORT_WORKER_POLL_MS) || 5_000;
const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_PATH || "ffprobe";

// ============================================================================
// Helpers
// ============================================================================

/** Download a URL to a local file. Returns the file path. */
function downloadFile(url: string, destPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);

    proto
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow redirect
          file.close();
          fs.unlinkSync(destPath);
          downloadFile(res.headers.location, destPath).then(resolve, reject);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          file.close();
          fs.unlinkSync(destPath);
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve(destPath);
        });
      })
      .on("error", (err) => {
        file.close();
        try { fs.unlinkSync(destPath); } catch { /* cleanup best-effort */ }
        reject(err);
      });
  });
}

/** Run an external command and capture stdout + stderr. */
function runCommand(
  bin: string,
  args: string[],
  onProgress?: (percent: number) => void
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stderr += chunk;

      // Parse FFmpeg progress from stderr (time=HH:MM:SS.xx)
      if (onProgress) {
        const match = chunk.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (match) {
          const h = parseInt(match[1], 10);
          const m = parseInt(match[2], 10);
          const s = parseInt(match[3], 10);
          const ms = parseInt(match[4], 10) * 10;
          const currentMs = (h * 3600 + m * 60 + s) * 1000 + ms;
          onProgress(currentMs);
        }
      }
    });

    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      reject(err);
    });
  });
}

/** Get duration of a media file in milliseconds via ffprobe. */
async function probeDuration(filePath: string): Promise<number> {
  try {
    const { code, stdout } = await runCommand(FFPROBE_BIN, [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      filePath,
    ]);
    if (code !== 0) return 0;
    const info = JSON.parse(stdout);
    const dur = parseFloat(info?.format?.duration || "0");
    return Math.round(dur * 1000);
  } catch {
    return 0;
  }
}

// ============================================================================
// Core job processor
// ============================================================================

export async function processExportJob(job: ExportJobDoc): Promise<void> {
  const jobId = job.id;
  const workDir = path.join(os.tmpdir(), `sl_export_${jobId}`);

  try {
    fs.mkdirSync(workDir, { recursive: true });

    // --- Step 1: Prepare / download assets ---
    await updateExportJob(jobId, {
      status: "preparing",
      currentStep: "Downloading assets",
      progressPercent: 5,
    });

    const timeline = job.timeline;
    if (!timeline || !timeline.tracks || timeline.tracks.length === 0) {
      throw new Error("No timeline data — nothing to render");
    }

    const { width, height } = resolutionToDimensions(job.settings?.resolution);
    const fps = timeline.fps || 30;
    const container = formatToContainer(job.settings?.format);
    const outputExt = container;

    // Collect all unique source URLs to download
    const allClips: ExportTimelineClip[] = [];
    for (const track of timeline.tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        allClips.push(clip);
      }
    }

    if (allClips.length === 0) {
      throw new Error("All tracks are muted — nothing to render");
    }

    // Deduplicate by sourceUrl
    const urlToLocal = new Map<string, string>();
    let dlIndex = 0;
    for (const clip of allClips) {
      if (!clip.sourceUrl || urlToLocal.has(clip.sourceUrl)) continue;
      dlIndex++;
      const ext = clip.sourceUrl.split("?")[0].split(".").pop() || "mp4";
      const localPath = path.join(workDir, `source_${dlIndex}.${ext}`);
      logger.info({ jobId, url: clip.sourceUrl.slice(0, 80) }, "Downloading asset");
      await downloadFile(clip.sourceUrl, localPath);
      urlToLocal.set(clip.sourceUrl, localPath);

      await updateExportJob(jobId, {
        progressPercent: Math.min(25, 5 + Math.round((dlIndex / allClips.length) * 20)),
        currentStep: `Downloading asset ${dlIndex}/${allClips.length}`,
      });
    }

    // --- Step 2: Build FFmpeg command ---
    await updateExportJob(jobId, {
      status: "rendering",
      currentStep: "Building render plan",
      progressPercent: 25,
    });

    const outputPath = path.join(workDir, `output.${outputExt}`);
    const totalDurationMs = timeline.durationMs || allClips.reduce(
      (max, c) => Math.max(max, c.endMs), 0
    );

    // Build a concat-demuxer file for simple sequential rendering
    // For the first version we render only unmuted video-track clips sequentially.
    const videoClips = allClips
      .filter((c) => {
        const track = timeline.tracks.find((t) => t.id === c.trackId);
        return track && track.kind === "video" && !track.muted;
      })
      .sort((a, b) => a.startMs - b.startMs);

    if (videoClips.length === 0) {
      throw new Error("No unmuted video clips to render");
    }

    // Build FFmpeg args for complex filter
    const ffmpegArgs: string[] = [];

    // Add each input with trim
    for (let i = 0; i < videoClips.length; i++) {
      const clip = videoClips[i];
      const localFile = urlToLocal.get(clip.sourceUrl);
      if (!localFile) continue;

      const ssSeconds = (clip.sourceInMs / 1000).toFixed(3);
      const durationSeconds = ((clip.sourceOutMs - clip.sourceInMs) / 1000).toFixed(3);

      ffmpegArgs.push("-ss", ssSeconds);
      ffmpegArgs.push("-t", durationSeconds);
      ffmpegArgs.push("-i", localFile);
    }

    if (videoClips.length === 1) {
      // Simple case: one clip, direct output with scaling
      const scaleFilter = [
        `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        `fps=${fps}`,
      ].join(",");

      ffmpegArgs.push(
        "-vf", scaleFilter,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-y",
        outputPath
      );
    } else {
      // Multiple clips: use concat filter
      const scaleFilter = [
        `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        `fps=${fps}`,
        "setpts=PTS-STARTPTS",
      ].join(",");

      const filterParts: string[] = [];
      for (let i = 0; i < videoClips.length; i++) {
        filterParts.push(`[${i}:v]${scaleFilter}[v${i}]`);
        filterParts.push(`[${i}:a]aresample=48000[a${i}]`);
      }

      const vConcat = videoClips.map((_, i) => `[v${i}]`).join("");
      const aConcat = videoClips.map((_, i) => `[a${i}]`).join("");
      filterParts.push(`${vConcat}concat=n=${videoClips.length}:v=1:a=0[outv]`);
      filterParts.push(`${aConcat}concat=n=${videoClips.length}:v=0:a=1[outa]`);

      const filterComplex = filterParts.join(";");

      ffmpegArgs.push(
        "-filter_complex", filterComplex,
        "-map", "[outv]",
        "-map", "[outa]",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-y",
        outputPath
      );
    }

    // --- Step 3: Run FFmpeg ---
    await updateExportJob(jobId, {
      currentStep: "Rendering video",
      progressPercent: 30,
    });

    logger.info({ jobId, args: ffmpegArgs.slice(-5) }, "Starting FFmpeg render");

    const onProgress = async (currentMs: number) => {
      if (totalDurationMs <= 0) return;
      const pct = Math.min(90, 30 + Math.round((currentMs / totalDurationMs) * 60));
      // Fire-and-forget progress update
      updateExportJob(jobId, { progressPercent: pct }).catch(() => {});
    };

    const result = await runCommand(FFMPEG_BIN, ffmpegArgs, onProgress);

    // Check for cancellation mid-render
    const freshJob = await getExportJob(jobId);
    if (freshJob?.status === "canceled") {
      logger.info({ jobId }, "Job was canceled during render");
      cleanup(workDir);
      return;
    }

    if (result.code !== 0) {
      const errTail = result.stderr.slice(-300);
      throw new Error(`FFmpeg exited with code ${result.code}: ${errTail}`);
    }

    if (!fs.existsSync(outputPath)) {
      throw new Error("FFmpeg produced no output file");
    }

    // --- Step 4: Upload result ---
    await updateExportJob(jobId, {
      status: "uploading",
      currentStep: "Uploading to storage",
      progressPercent: 92,
    });

    const outputBuffer = fs.readFileSync(outputPath);
    const remotePath = `exports/${job.userId}/${job.projectId}/${Date.now()}.${outputExt}`;
    const contentType =
      container === "webm" ? "video/webm" : container === "mov" ? "video/quicktime" : "video/mp4";

    // Transactional reservation: atomically check limit + increment.
    // For background worker jobs we log clearly but do not abort the entire
    // render — the user cannot retry in real-time.  If the reservation is
    // rejected the job still completes with a warning.
    const reservation = await reserveStorageIfAvailable(job.userId, outputBuffer.byteLength, {
      caller: "renderWorker",
      jobId,
      remotePath,
    });

    if (!reservation.reserved) {
      logger.warn({ jobId, userId: job.userId, remotePath, size: outputBuffer.byteLength, reason: reservation.reason },
        "Storage limit exceeded — export will complete but bytes may exceed plan limit");
      // We still upload and complete the job.  The user will see usage over limit
      // and can delete old content.  This matches the product expectation that
      // a render that already ran should not be silently discarded.
    }

    let publicUrl: string;
    try {
      publicUrl = await uploadVideo(outputBuffer, remotePath, contentType);
    } catch (uploadErr: any) {
      // Upload failed — release reserved bytes if we had reserved them.
      if (reservation.reserved) {
        try {
          await releaseReservedStorage(job.userId, outputBuffer.byteLength, {
            caller: "renderWorker.rollback",
            jobId,
            remotePath,
          });
        } catch (releaseErr: any) {
          logger.error({ jobId, userId: job.userId, remotePath, size: outputBuffer.byteLength,
            uploadError: uploadErr?.message, releaseError: releaseErr?.message },
            "CRITICAL: failed to release reservation after render upload failure");
        }
      }
      throw uploadErr;
    }

    // If the reservation was not granted above (limit exceeded), we still
    // need to account for the bytes that were actually stored.  Use the
    // non-transactional path so the counter stays accurate even if over-limit.
    if (!reservation.reserved) {
      try {
        await reserveStorageUsage(job.userId, outputBuffer.byteLength, {
          caller: "renderWorker.overlimit",
          jobId,
          remotePath,
        });
      } catch (e: any) {
        logger.error({ jobId, userId: job.userId, remotePath, size: outputBuffer.byteLength, error: e?.message || String(e) },
          "STORAGE ACCOUNTING FAILED on over-limit export — needs reconciliation");
      }
    }

    // --- Step 5: Complete ---
    await completeJob(jobId, publicUrl, remotePath);
    logger.info({ jobId, publicUrl }, "Export completed");

  } catch (err: any) {
    logger.error({ jobId, err: err?.message || String(err) }, "Export job failed");
    await failJob(jobId, err?.message || "Unknown error");
  } finally {
    cleanup(workDir);
  }
}

function cleanup(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

// ============================================================================
// Background poller
// ============================================================================

let _running = false;
let _pollTimer: ReturnType<typeof setTimeout> | null = null;

/** Start the background export worker. Call once at server boot. */
export function startExportWorker(): void {
  if (_running) return;
  _running = true;
  logger.info("Export worker started");
  poll();
}

/** Stop the background worker gracefully. */
export function stopExportWorker(): void {
  _running = false;
  if (_pollTimer) {
    clearTimeout(_pollTimer);
    _pollTimer = null;
  }
  logger.info("Export worker stopped");
}

async function poll(): Promise<void> {
  if (!_running) return;

  try {
    const job = await claimNextJob();
    if (job) {
      logger.info({ jobId: job.id }, "Claimed export job");
      await processExportJob(job);
    }
  } catch (err: any) {
    logger.error({ err: err?.message || String(err) }, "Export worker poll error");
  }

  if (_running) {
    _pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  }
}
