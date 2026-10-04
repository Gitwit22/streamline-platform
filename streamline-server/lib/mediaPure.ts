// ============================================================================
// Pure helpers for the media pipeline (export worker, HLS, multistream,
// recording storage accounting, download links). No Firebase / LiveKit / AWS
// imports so everything here is unit-testable.
// ============================================================================

/** Coerce a Firestore Timestamp / Date / number / ISO string to epoch millis. */
export function toMillis(value: any): number | null {
  if (value === null || value === undefined) return null;
  try {
    if (value instanceof Date) {
      const t = value.getTime();
      return Number.isFinite(t) ? t : null;
    }
    if (typeof value?.toMillis === "function") {
      const t = Number(value.toMillis());
      return Number.isFinite(t) ? t : null;
    }
    if (typeof value?.toDate === "function") {
      const t = value.toDate().getTime();
      return Number.isFinite(t) ? t : null;
    }
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string" && value.trim()) {
      const t = Date.parse(value);
      return Number.isFinite(t) ? t : null;
    }
    if (typeof value?._seconds === "number") {
      return value._seconds * 1000 + Math.floor(Number(value._nanoseconds || 0) / 1e6);
    }
  } catch {
    return null;
  }
  return null;
}

// ----------------------------------------------------------------------------
// Export jobs
// ----------------------------------------------------------------------------

export const ACTIVE_EXPORT_STATUSES = ["preparing", "rendering", "uploading"] as const;
export const TERMINAL_EXPORT_STATUSES = ["completed", "failed", "canceled"] as const;

export function isTerminalExportStatus(status: unknown): boolean {
  return (TERMINAL_EXPORT_STATUSES as readonly string[]).includes(String(status || ""));
}

/**
 * A job is stale when a worker claimed it (active status) but it has been
 * running longer than maxAgeMs — the worker most likely crashed or restarted.
 */
export function isStaleExportJob(
  job: { status?: unknown; startedAt?: unknown },
  nowMs: number,
  maxAgeMs: number,
): boolean {
  if (!(ACTIVE_EXPORT_STATUSES as readonly string[]).includes(String(job?.status || ""))) return false;
  const startedMs = toMillis(job?.startedAt);
  // An active job without startedAt can't be legitimately running (claim sets it).
  if (startedMs === null) return true;
  return nowMs - startedMs > maxAgeMs;
}

// ----------------------------------------------------------------------------
// Secrets in logs / docs
// ----------------------------------------------------------------------------

/** "…abcd" for a stream key, or null when empty. Never returns more than 4 chars of the key. */
export function maskSecretTail(key: unknown): string | null {
  const s = typeof key === "string" ? key.trim() : "";
  if (!s) return null;
  if (s.length <= 4) return "…" + "*".repeat(s.length);
  return `…${s.slice(-4)}`;
}

/** Strip the stream key (last path segment) and any query from an RTMP URL. */
export function redactRtmpUrl(url: unknown): string {
  const s = typeof url === "string" ? url.split("?")[0] : "";
  const idx = s.lastIndexOf("/");
  if (idx <= 0) return "***";
  // Keep "rtmp://host/app/" but never the key.
  return `${s.slice(0, idx + 1)}***`;
}

// ----------------------------------------------------------------------------
// Multistream
// ----------------------------------------------------------------------------

export function collectEgressIds(doc: any): string[] {
  if (!doc || typeof doc !== "object") return [];
  const ids = [doc.egressId, doc.egressIds?.normal, doc.egressIds?.instagram]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  return Array.from(new Set(ids));
}

/**
 * Decide whether a start-multistream request may proceed given the current
 * activeStreams doc.
 *  - "conflict_check": the doc claims running egress(es); caller must verify
 *    with LiveKit whether they are still active.
 *  - "in_progress": another start is in flight (recent "starting" claim).
 *  - "proceed": nothing is running.
 */
export function decideMultistreamStart(
  doc: any,
  nowMs: number,
  startingTtlMs: number,
): { action: "proceed" | "in_progress" | "conflict_check"; egressIds?: string[] } {
  if (!doc) return { action: "proceed" };
  const status = String(doc.status || "");
  const ids = collectEgressIds(doc);
  if (status === "started" && ids.length > 0) return { action: "conflict_check", egressIds: ids };
  if (status === "starting") {
    const since = toMillis(doc.startingAt ?? doc.updatedAt);
    if (since !== null && nowMs - since < startingTtlMs) return { action: "in_progress" };
  }
  return { action: "proceed" };
}

// ----------------------------------------------------------------------------
// HLS
// ----------------------------------------------------------------------------

/**
 * idle/error → starting is allowed. live, or a recent starting claim, returns
 * the existing state. A "starting" claim older than staleStartingMs is treated
 * as abandoned (process crashed mid-start) and may be taken over.
 */
export function decideHlsStart(
  hls: any,
  nowMs: number,
  staleStartingMs: number,
): { action: "start" | "existing" } {
  const status = String(hls?.status || "idle");
  if (status === "live") return { action: "existing" };
  if (status === "starting") {
    const since = toMillis(hls?.updatedAt ?? hls?.startedAt);
    if (since === null || nowMs - since < staleStartingMs) return { action: "existing" };
  }
  return { action: "start" };
}

/** Same rounding as the /api/hls/stop handler: min 1 minute when any time elapsed. */
export function computeHlsBilledMinutes(startedAt: any, nowMs: number): number {
  const startedMs = toMillis(startedAt);
  if (startedMs === null) return 0;
  const diff = nowMs - startedMs;
  if (!(diff > 0)) return 0;
  return Math.max(1, Math.round(diff / 60_000));
}

/** Last sign of life for an HLS session: heartbeat, else updatedAt, else startedAt. */
export function hlsLastSeenMs(hls: any): number | null {
  const candidates = [toMillis(hls?.heartbeatAt), toMillis(hls?.updatedAt), toMillis(hls?.startedAt)].filter(
    (v): v is number => v !== null,
  );
  return candidates.length ? Math.max(...candidates) : null;
}

export function isHlsSessionStale(hls: any, nowMs: number, ttlMs: number): boolean {
  const status = String(hls?.status || "idle");
  if (status !== "starting" && status !== "live" && status !== "error") return false;
  const last = hlsLastSeenMs(hls);
  if (last === null) return true;
  return nowMs - last > ttlMs;
}

export function shouldRefreshHlsHeartbeat(hls: any, nowMs: number, intervalMs: number): boolean {
  const status = String(hls?.status || "idle");
  if (status !== "live" && status !== "starting") return false;
  const hb = toMillis(hls?.heartbeatAt);
  return hb === null || nowMs - hb >= intervalMs;
}

// ----------------------------------------------------------------------------
// Recording storage accounting
// ----------------------------------------------------------------------------

/** Whether a call that saw `fileSize` bytes in R2 should flip storageCounted. */
export function shouldClaimStorageCount(data: any, fileSize: number): boolean {
  if (!(typeof fileSize === "number" && Number.isFinite(fileSize) && fileSize > 0)) return false;
  if (!data) return false;
  if (data.storageCounted === true) return false;
  const status = String(data.status || "").toLowerCase();
  if (status === "deleted" || status === "deleting") return false;
  return true;
}

// ----------------------------------------------------------------------------
// Recording download links
// ----------------------------------------------------------------------------

export const DOWNLOAD_LINK_TTL_SECONDS = 15 * 60;

// Flat shape (tsconfig has strict: false, so discriminated unions don't narrow).
export type DownloadRuleResult = {
  kind: "not_ready" | "expired" | "paywall" | "missing_key" | "ok";
  status?: string;
  message?: string;
  objectKey?: string;
};

/**
 * The /api/recordings/:id/download-link rules, minus ownership and the
 * platform feature flag (both need I/O and are checked by the caller).
 */
export function evaluateDownloadRules(
  data: any,
  nowMs: number,
  retentionMinutes: number,
): DownloadRuleResult {
  const d = data || {};
  const status = String(d.status || "").toLowerCase();
  if (!(d.downloadReady === true && status === "ready")) {
    return {
      kind: "not_ready",
      status,
      message:
        status === "failed"
          ? `Recording failed: ${d.errorMessage || "Unknown error"}`
          : "Recording is still processing",
    };
  }

  const readyMs = toMillis(d.readyAt || d.stoppedAt || null);
  if (readyMs !== null && nowMs >= readyMs + retentionMinutes * 60_000) {
    return { kind: "expired" };
  }

  if (d.paywallState === "requires_payment") return { kind: "paywall" };

  const raw = String(d.objectKey || d.downloadPath || "").trim();
  const objectKey = raw.startsWith("/") ? raw.slice(1) : raw;
  if (!objectKey) return { kind: "missing_key" };
  return { kind: "ok", objectKey };
}

// ----------------------------------------------------------------------------
// Retention purge cursor
// ----------------------------------------------------------------------------

/**
 * Given docs scanned in createdAt order, return the index of the last doc in
 * the leading run that is permanently done (already deleted / just purged).
 * The persisted cursor may advance past that prefix only, so transiently
 * non-purgeable docs (still recording) are re-checked next run.
 */
export function advanceablePrefixLength(doneFlags: boolean[]): number {
  let n = 0;
  for (const done of doneFlags) {
    if (!done) break;
    n += 1;
  }
  return n;
}
