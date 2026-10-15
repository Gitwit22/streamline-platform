/**
 * Reload recovery for the host's live controls (audit P1-3). Before this a
 * reloaded host tab started at "idle" with no egress id, so a running stream
 * or recording kept running (and billing) with no way to stop it from the UI.
 */

const RUNNING_OUTPUT_STATUSES = new Set(["starting", "active", "unknown"]);

/**
 * Egress id of a multistream that is still running, from
 * GET /api/multistream/:roomId/multistream-status. "unknown" (LiveKit lookup
 * failed) counts as running: offering Stop on a dead stream is harmless (the
 * server treats "not running" as stopped), hiding a live one is not.
 */
export function runningMultistreamEgressId(status: unknown): string | null {
  const data = status as { live?: unknown; outputs?: unknown } | null;
  if (!data || data.live !== true || !Array.isArray(data.outputs)) return null;
  const running = (data.outputs as Array<{ kind?: unknown; egressId?: unknown; status?: unknown }>).filter(
    (o) => typeof o?.egressId === "string" && o.egressId && RUNNING_OUTPUT_STATUSES.has(String(o.status || "unknown"))
  );
  const primary = running.find((o) => o.kind === "multistream") || running[0];
  return primary ? (primary.egressId as string) : null;
}

/** Egress id from a 409 multistream_already_running body, if any. */
export function alreadyRunningEgressId(body: unknown): string | null {
  const data = body as { error?: unknown; egressId?: unknown } | null;
  if (!data || data.error !== "multistream_already_running") return null;
  return typeof data.egressId === "string" && data.egressId ? data.egressId : null;
}

/** Running recording from GET /api/recordings/room/active. */
export function runningRecordingFromResponse(body: unknown): { recordingId: string; startedAtMs: number | null } | null {
  const rec = (body as { recording?: { recordingId?: unknown; startedAtMs?: unknown } | null } | null)?.recording;
  if (!rec || typeof rec.recordingId !== "string" || !rec.recordingId) return null;
  const startedAtMs = typeof rec.startedAtMs === "number" && Number.isFinite(rec.startedAtMs) ? rec.startedAtMs : null;
  return { recordingId: rec.recordingId, startedAtMs };
}
