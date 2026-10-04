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
import { logger } from "./logger";
import { uploadFileFromPath, getSignedDownloadUrl, deleteFile } from "./storageClient";
import { reserveStorageIfAvailable, releaseReservedStorage, releaseStorageUsage, reserveStorageUsage } from "../usageHelper";
import {
  claimNextJob,
  updateExportJob,
  updateExportJobIfActive,
  failJob,
  completeJob,
  getExportJob,
  reapStaleExportJobs,
} from "./exportQueue";
import type { ExportJobDoc, ExportTimelineClip } from "./exportTypes";
import { buildRenderPlan, clipSourceId, type RenderInput } from "./renderPlan";
import { probeMedia } from "./mediaProbe";
import { resolutionToDimensions, formatToContainer } from "./exportTypes";
import {
  EXPORT_DOWNLOAD_LIMITS,
  getAllowedExportSourceHosts,
  redactUrlForLog,
  resolveRedirectUrl,
  validateExportSourceUrl,
} from "./exportSourceUrl";

// ============================================================================
// Config
// ============================================================================

const POLL_INTERVAL_MS = Number(process.env.EXPORT_WORKER_POLL_MS) || 5_000;
const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";
/** Kill ffmpeg after this long. */
const FFMPEG_TIMEOUT_MS = (Number(process.env.EXPORT_FFMPEG_TIMEOUT_MINUTES) || 20) * 60_000;
/** Jobs active longer than this are considered abandoned and failed by the reaper. */
const STALE_JOB_MS = (Number(process.env.EXPORT_STALE_JOB_MINUTES) || 30) * 60_000;
const REAPER_INTERVAL_MS = 5 * 60_000;
/** How often to check for cancellation while ffmpeg runs. */
const CANCEL_POLL_MS = 15_000;
/** Each source can be up to EXPORT_DOWNLOAD_LIMITS.maxBytes on local disk. */
const MAX_SOURCES_PER_JOB = Number(process.env.EXPORT_MAX_SOURCES) || 20;

// ============================================================================
// Helpers
// ============================================================================

class JobCanceledError extends Error {
  constructor() {
    super("Job was canceled");
  }
}

/**
 * Download an allowlisted https URL to a local file.
 * - every hop (initial + up to maxRedirects redirects) is re-validated
 * - idle timeout, overall timeout and a byte cap are enforced
 */
export function downloadFile(
  url: string,
  destPath: string,
  opts: {
    allowedHosts?: Set<string>;
    maxBytes?: number;
    maxRedirects?: number;
    idleTimeoutMs?: number;
    totalTimeoutMs?: number;
  } = {}
): Promise<string> {
  const allowedHosts = opts.allowedHosts ?? getAllowedExportSourceHosts();
  const maxBytes = opts.maxBytes ?? EXPORT_DOWNLOAD_LIMITS.maxBytes;
  const maxRedirects = opts.maxRedirects ?? EXPORT_DOWNLOAD_LIMITS.maxRedirects;
  const idleTimeoutMs = opts.idleTimeoutMs ?? EXPORT_DOWNLOAD_LIMITS.idleTimeoutMs;
  const totalTimeoutMs = opts.totalTimeoutMs ?? EXPORT_DOWNLOAD_LIMITS.totalTimeoutMs;

  return new Promise((resolve, reject) => {
    let settled = false;
    let currentReq: ReturnType<typeof https.get> | null = null;
    let file: fs.WriteStream | null = null;

    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      if (err) {
        try { currentReq?.destroy(); } catch { /* ignore */ }
        const f = file;
        const removeFile = () => fs.promises.unlink(destPath).catch(() => {});
        if (f) f.close(() => { void removeFile(); });
        else void removeFile();
        reject(err);
      } else {
        resolve(destPath);
      }
    };

    const totalTimer = setTimeout(
      () => finish(new Error(`Download exceeded ${Math.round(totalTimeoutMs / 1000)}s`)),
      totalTimeoutMs
    );

    const fetchUrl = (target: string, redirectsLeft: number) => {
      const check = validateExportSourceUrl(target, allowedHosts);
      if (!check.ok) {
        finish(new Error(`Source URL rejected (${check.reason})`));
        return;
      }

      const req = https.get(check.url, (res) => {
        const status = res.statusCode || 0;

        if (status >= 300 && status < 400) {
          res.resume();
          if (redirectsLeft <= 0) {
            finish(new Error("Too many redirects"));
            return;
          }
          const next = resolveRedirectUrl(target, res.headers.location);
          if (!next) {
            finish(new Error(`Redirect without valid location (HTTP ${status})`));
            return;
          }
          fetchUrl(next, redirectsLeft - 1);
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          finish(new Error(`Download failed: HTTP ${status}`));
          return;
        }

        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.resume();
          finish(new Error(`Source exceeds max size (${declared} bytes)`));
          return;
        }

        file = fs.createWriteStream(destPath);
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            res.destroy();
            finish(new Error(`Source exceeds max size (${maxBytes} bytes)`));
          }
        });
        res.on("error", (err) => finish(err));
        res.on("aborted", () => finish(new Error("Download aborted")));
        file.on("error", (err) => finish(err));
        file.on("finish", () => {
          file?.close(() => finish(null));
        });
        res.pipe(file);
      });

      currentReq = req;
      // Socket idle timeout (no bytes for idleTimeoutMs).
      req.setTimeout(idleTimeoutMs, () => {
        req.destroy(new Error(`Download idle for ${Math.round(idleTimeoutMs / 1000)}s`));
      });
      req.on("error", (err) => finish(err));
    };

    fetchUrl(url, maxRedirects);
  });
}

/** Keep only the tail of a growing log buffer. */
function appendTail(buf: string, chunk: string, max = 64 * 1024): string {
  const next = buf + chunk;
  return next.length > max ? next.slice(-max) : next;
}

/**
 * Run an external command and capture stdout + stderr (stderr tail only).
 * The process is SIGKILLed after timeoutMs or when shouldAbort() resolves true.
 */
function runCommand(
  bin: string,
  args: string[],
  opts: {
    onProgress?: (currentMs: number) => void;
    timeoutMs?: number;
    shouldAbort?: () => Promise<boolean>;
    abortPollMs?: number;
  } = {}
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean; aborted: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;

    const kill = () => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
    };

    const timeoutTimer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          kill();
        }, opts.timeoutMs)
      : null;

    let abortTimer: ReturnType<typeof setInterval> | null = null;
    if (opts.shouldAbort) {
      const check = opts.shouldAbort;
      abortTimer = setInterval(() => {
        check()
          .then((stop) => {
            if (stop) {
              aborted = true;
              kill();
            }
          })
          .catch(() => {});
      }, opts.abortPollMs ?? CANCEL_POLL_MS);
    }

    const clearTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (abortTimer) clearInterval(abortTimer);
    };

    child.stdout.on("data", (d: Buffer) => {
      stdout = appendTail(stdout, d.toString(), 1024 * 1024);
    });
    child.stderr.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stderr = appendTail(stderr, chunk);

      // Parse FFmpeg progress from stderr (time=HH:MM:SS.xx)
      if (opts.onProgress) {
        const match = chunk.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (match) {
          const h = parseInt(match[1], 10);
          const m = parseInt(match[2], 10);
          const s = parseInt(match[3], 10);
          const ms = parseInt(match[4], 10) * 10;
          const currentMs = (h * 3600 + m * 60 + s) * 1000 + ms;
          opts.onProgress(currentMs);
        }
      }
    });

    child.on("close", (code) => {
      clearTimers();
      resolve({ code: code ?? 1, stdout, stderr, timedOut, aborted });
    });
    child.on("error", (err) => {
      clearTimers();
      reject(err);
    });
  });
}

// ============================================================================
// Core job processor
// ============================================================================

/** Throws JobCanceledError when the job is no longer active (canceled / reaped). */
async function setStepOrAbort(jobId: string, patch: Parameters<typeof updateExportJobIfActive>[1]) {
  const ok = await updateExportJobIfActive(jobId, patch);
  if (!ok) throw new JobCanceledError();
}

async function isJobInactive(jobId: string): Promise<boolean> {
  const fresh = await getExportJob(jobId);
  return !fresh || fresh.status === "canceled" || fresh.status === "failed" || fresh.status === "completed";
}

export async function processExportJob(job: ExportJobDoc): Promise<void> {
  const jobId = job.id;
  const workDir = path.join(os.tmpdir(), `sl_export_${jobId}`);

  try {
    fs.mkdirSync(workDir, { recursive: true });

    // --- Step 1: Prepare / download assets ---
    await setStepOrAbort(jobId, {
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

    // Collect the clips of audible/visible tracks (sources to download)
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

    // Re-validate every source in the worker (defense in depth: jobs created
    // before the allowlist existed, or edited directly in Firestore).
    const allowedHosts = getAllowedExportSourceHosts();
    for (const clip of allClips) {
      if (clip.sourceKey || !clip.sourceUrl) continue;
      const check = validateExportSourceUrl(clip.sourceUrl, allowedHosts);
      if (!check.ok) {
        throw new Error(`Clip ${clip.id} source rejected (${check.reason})`);
      }
    }

    const distinctSources = new Set(allClips.map(clipSourceId).filter(Boolean));
    if (distinctSources.size > MAX_SOURCES_PER_JOB) {
      throw new Error(`Too many distinct source files (${distinctSources.size} > ${MAX_SOURCES_PER_JOB})`);
    }

    // Deduplicate by source (storage key or URL)
    const urlToLocal = new Map<string, string>();
    let dlIndex = 0;
    for (const clip of allClips) {
      const sourceId = clipSourceId(clip);
      if (!sourceId || urlToLocal.has(sourceId)) continue;
      dlIndex++;
      const nameForExt = clip.sourceKey || clip.sourceUrl.split("?")[0];
      const rawExt = nameForExt.split("/").pop()?.split(".").pop() || "mp4";
      const ext = /^[a-z0-9]{1,5}$/i.test(rawExt) ? rawExt : "mp4";
      const localPath = path.join(workDir, `source_${dlIndex}.${ext}`);

      // Storage keys are presigned here (short TTL) so queue wait time can't
      // expire them; the presigned host is our R2 endpoint (allowlisted).
      const downloadUrl = clip.sourceKey
        ? await getSignedDownloadUrl(clip.sourceKey, 3600)
        : clip.sourceUrl;

      logger.info({ jobId, source: clip.sourceKey ? `key:${clip.sourceKey.slice(0, 80)}` : redactUrlForLog(downloadUrl) }, "Downloading asset");
      await downloadFile(downloadUrl, localPath, { allowedHosts });
      urlToLocal.set(sourceId, localPath);

      await setStepOrAbort(jobId, {
        progressPercent: Math.min(25, 5 + Math.round((dlIndex / allClips.length) * 20)),
        currentStep: `Downloading asset ${dlIndex}/${allClips.length}`,
      });
    }

    // --- Step 2: Build FFmpeg command (picture + mixed audio) ---
    await setStepOrAbort(jobId, {
      status: "rendering",
      currentStep: "Building render plan",
      progressPercent: 25,
    });

    const outputPath = path.join(workDir, `output.${outputExt}`);

    // Probe every downloaded source once: clips whose file has no audio
    // stream get generated silence instead of a dangling [n:a] reference.
    const renderInputs = new Map<string, RenderInput>();
    for (const [sourceId, localPath] of urlToLocal) {
      const probe = await probeMedia(localPath);
      renderInputs.set(sourceId, {
        path: localPath,
        // Unknown (probe failed): assume a normal A/V file; ffmpeg will report.
        hasVideo: probe ? probe.hasVideo : true,
        hasAudio: probe ? probe.hasAudio : true,
      });
    }

    const plan = buildRenderPlan(timeline, renderInputs, { outputPath, width, height, fps, container });
    const ffmpegArgs = plan.args;
    const totalDurationMs = plan.durationMs;
    logger.info(
      { jobId, durationMs: plan.durationMs, videoBranches: plan.videoBranches, audioBranches: plan.audioBranches, silentBranches: plan.silentBranches },
      "Render plan built",
    );

    // --- Step 3: Run FFmpeg ---
    await setStepOrAbort(jobId, {
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

    const result = await runCommand(FFMPEG_BIN, ffmpegArgs, {
      onProgress,
      timeoutMs: FFMPEG_TIMEOUT_MS,
      shouldAbort: () => isJobInactive(jobId),
    });

    // Canceled (or reaped) mid-render
    if (result.aborted || (await isJobInactive(jobId))) {
      logger.info({ jobId }, "Job was canceled during render");
      return;
    }

    if (result.timedOut) {
      throw new Error(`FFmpeg timed out after ${Math.round(FFMPEG_TIMEOUT_MS / 60_000)} minutes`);
    }

    if (result.code !== 0) {
      const errTail = result.stderr.slice(-300);
      throw new Error(`FFmpeg exited with code ${result.code}: ${errTail}`);
    }

    if (!fs.existsSync(outputPath)) {
      throw new Error("FFmpeg produced no output file");
    }

    // --- Step 4: Upload result ---
    await setStepOrAbort(jobId, {
      status: "uploading",
      currentStep: "Uploading to storage",
      progressPercent: 92,
    });

    // Stream from disk; never buffer the rendered file in memory.
    const outputBytes = fs.statSync(outputPath).size;
    const remotePath = `exports/${job.userId}/${job.projectId}/${Date.now()}.${outputExt}`;
    const contentType =
      container === "webm" ? "video/webm" : container === "mov" ? "video/quicktime" : "video/mp4";

    // Transactional reservation: atomically check limit + increment.
    // For background worker jobs we log clearly but do not abort the entire
    // render — the user cannot retry in real-time.  If the reservation is
    // rejected the job still completes with a warning.
    const reservation = await reserveStorageIfAvailable(job.userId, outputBytes, {
      caller: "renderWorker",
      jobId,
      remotePath,
    });

    if (!reservation.reserved) {
      logger.warn({ jobId, userId: job.userId, remotePath, size: outputBytes, reason: reservation.reason },
        "Storage limit exceeded — export will complete but bytes may exceed plan limit");
    }

    let publicUrl: string;
    try {
      publicUrl = await uploadFileFromPath(outputPath, remotePath, contentType);
    } catch (uploadErr: any) {
      // Upload failed — release reserved bytes if we had reserved them.
      if (reservation.reserved) {
        try {
          await releaseReservedStorage(job.userId, outputBytes, {
            caller: "renderWorker.rollback",
            jobId,
            remotePath,
          });
        } catch (releaseErr: any) {
          logger.error({ jobId, userId: job.userId, remotePath, size: outputBytes,
            uploadError: uploadErr?.message, releaseError: releaseErr?.message },
            "CRITICAL: failed to release reservation after render upload failure");
        }
      }
      throw uploadErr;
    }

    // If the reservation was not granted above (limit exceeded), we still
    // need to account for the bytes that were actually stored.
    if (!reservation.reserved) {
      try {
        await reserveStorageUsage(job.userId, outputBytes, {
          caller: "renderWorker.overlimit",
          jobId,
          remotePath,
        });
      } catch (e: any) {
        logger.error({ jobId, userId: job.userId, remotePath, size: outputBytes, error: e?.message || String(e) },
          "STORAGE ACCOUNTING FAILED on over-limit export — needs reconciliation");
      }
    }

    // --- Step 5: Complete (transactional: never overwrites a canceled job) ---
    const completed = await completeJob(jobId, publicUrl, remotePath);
    if (!completed) {
      // Canceled or reaped while uploading: discard the output and its bytes.
      logger.info({ jobId, remotePath }, "Job no longer active at completion; discarding output");
      try {
        await deleteFile(remotePath);
        await releaseStorageUsage(job.userId, outputBytes, { caller: "renderWorker.canceled", jobId, remotePath });
      } catch (e: any) {
        logger.error({ jobId, remotePath, error: e?.message || String(e) }, "Failed to discard canceled export output");
      }
      return;
    }
    logger.info({ jobId, remotePath }, "Export completed");

  } catch (err: any) {
    if (err instanceof JobCanceledError) {
      logger.info({ jobId }, "Export job stopped: no longer active");
      return;
    }
    logger.error({ jobId, err: err?.message || String(err) }, "Export job failed");
    await failJob(jobId, err?.message || "Unknown error").catch((e) =>
      logger.error({ jobId, err: e?.message || String(e) }, "Failed to mark export job failed")
    );
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
let _reaperTimer: ReturnType<typeof setInterval> | null = null;

async function runReaper(): Promise<void> {
  try {
    const n = await reapStaleExportJobs(STALE_JOB_MS);
    if (n > 0) logger.warn({ reaped: n }, "Export reaper failed stale jobs");
  } catch (err: any) {
    logger.warn({ err: err?.message || String(err) }, "Export reaper error");
  }
}

/** Start the background export worker. Call once at server boot. */
export function startExportWorker(): void {
  if (_running) return;
  _running = true;
  logger.info("Export worker started");
  // Fail jobs left in preparing/rendering/uploading by a crashed worker,
  // then keep doing so periodically.
  void runReaper().finally(() => poll());
  _reaperTimer = setInterval(() => void runReaper(), REAPER_INTERVAL_MS);
  _reaperTimer.unref?.();
}

/** Stop the background worker gracefully. */
export function stopExportWorker(): void {
  _running = false;
  if (_pollTimer) {
    clearTimeout(_pollTimer);
    _pollTimer = null;
  }
  if (_reaperTimer) {
    clearInterval(_reaperTimer);
    _reaperTimer = null;
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
