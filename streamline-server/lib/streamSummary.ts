/**
 * Post-stream summary storage (Firestore). Pure rules: lib/streamSummaryPure.ts.
 *
 *   rooms/{roomId}/viewerSessions/{sessionId}.summary   written when a session
 *       ends (lib/viewerStats.ts endLiveSession) so later reads are cheap:
 *       { durationSec, peakConcurrent, uniqueViewers{total,hls,rtc},
 *         avgWatchSeconds|null, watchSampleSize, computedAt }
 *   egressSessions/{egressId}.{egressStatus, egressError, egressStreamResults}
 *       stored by the LiveKit egress_ended webhook (destination performance).
 *
 * Everything here is best-effort; callers catch.
 */
import { firestore as db } from "../firebaseAdmin";
import { recordTelemetry } from "./telemetry";
import { urlHost } from "./telemetryPure";
import { toEpochMs } from "./streamingMeterPure";
import { readViewerStats, type ViewerStats } from "./viewerStatsPure";
import {
  buildStreamSummary,
  computeWatchStats,
  egressOutcomeFields,
  outputStatusFor,
  outputsForSession,
  redactEgressError,
  streamResultStatusName,
  readStoredSummary,
  storedSummaryFrom,
  type StoredSessionSummary,
  type StreamSummary,
  type WatchStats,
} from "./streamSummaryPure";

/** Upper bound on docs read per summary (viewers / HLS presence / outputs). */
const MAX_VIEWER_DOCS = 5000;
const MAX_OUTPUT_DOCS = 300;

const roomRef = (roomId: string) => db.collection("rooms").doc(roomId);
const sessionRef = (roomId: string, sessionId: string) => roomRef(roomId).collection("viewerSessions").doc(sessionId);

/** Reads viewer + HLS presence docs and computes watch time for a session. */
export async function computeSessionWatchStats(roomId: string, stats: ViewerStats): Promise<WatchStats> {
  const [viewersSnap, presenceSnap] = await Promise.all([
    sessionRef(roomId, stats.sessionId).collection("viewers").limit(MAX_VIEWER_DOCS).get(),
    roomRef(roomId).collection("hlsViewers").where("sessionId", "==", stats.sessionId).limit(MAX_VIEWER_DOCS).get(),
  ]);
  return computeWatchStats({
    viewers: viewersSnap.docs.map((d) => ({ key: d.id, ...(d.data() || {}) })),
    hlsPresence: presenceSnap.docs.map((d) => ({ viewerId: d.id, ...(d.data() || {}) })),
    session: stats,
  });
}

/**
 * Writes viewerSessions/{sid}.summary for an ended session. Must run before
 * HLS presence is pruned (presence docs carry HLS watch times).
 */
export async function persistSessionSummary(roomId: string, stats: ViewerStats): Promise<StoredSessionSummary> {
  const watch = await computeSessionWatchStats(roomId, stats);
  const summary = storedSummaryFrom(stats, watch, Date.now());
  await sessionRef(roomId, stats.sessionId).set({ summary }, { merge: true });
  return summary;
}

/** Stored summary for an ended session, or a fresh computation. */
export async function sessionWatchStats(
  roomId: string,
  stats: ViewerStats,
  storedRaw?: unknown
): Promise<Pick<WatchStats, "avgWatchSeconds" | "watchSampleSize">> {
  let stored = readStoredSummary(storedRaw);
  if (!stored && stats.endedAt !== null && storedRaw === undefined) {
    const snap = await sessionRef(roomId, stats.sessionId).get();
    stored = readStoredSummary((snap.data() as any)?.summary);
  }
  if (stored && stats.endedAt !== null) {
    return { avgWatchSeconds: stored.avgWatchSeconds, watchSampleSize: stored.watchSampleSize };
  }
  return computeSessionWatchStats(roomId, stats);
}

/**
 * Full summary for a room session (default: the room's latest session).
 * Returns null when the room or session does not exist.
 */
export async function getStreamSummary(
  roomId: string,
  room: any,
  sessionId?: string | null
): Promise<StreamSummary | null> {
  const latest = readViewerStats(room?.viewerStats);
  let stats: ViewerStats | null = null;
  let storedRaw: unknown = undefined;
  if (!sessionId || sessionId === latest?.sessionId) {
    stats = latest;
  } else {
    const snap = await sessionRef(roomId, sessionId).get();
    if (snap.exists) {
      const data = (snap.data() || {}) as any;
      stats = readViewerStats({ ...data, sessionId });
      storedRaw = data.summary ?? null;
    }
  }
  if (!stats) return null;

  const [watch, outputsSnap] = await Promise.all([
    sessionWatchStats(roomId, stats, storedRaw),
    db.collection("egressSessions").where("roomId", "==", roomId).limit(MAX_OUTPUT_DOCS).get(),
  ]);
  const now = Date.now();
  const outputs = outputsForSession(
    outputsSnap.docs.map((d) => ({ id: d.id, data: d.data() || {} })),
    stats,
    now
  );
  return buildStreamSummary(stats, watch, outputs, now);
}

/**
 * egress_ended: store the LiveKit outcome on the output interval (no-op for
 * egresses without an egressSessions doc, e.g. recordings).
 */
export async function recordEgressOutcome(egressId: string, egressInfo: any): Promise<void> {
  const id = String(egressId || "").trim();
  if (!id || id.includes("/")) return;
  const ref = db.collection("egressSessions").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return;
  const outcome = egressOutcomeFields(egressInfo);
  await ref.set(outcome, { merge: true });
  emitEgressEndedTelemetry(id, { ...(snap.data() || {}), ...outcome }, egressInfo);
}

/** broadcast.ended / destination.failed for RTMP outputs (multistream, Instagram). */
function emitEgressEndedTelemetry(egressId: string, d: any, egressInfo: any): void {
  const kind = String(d?.kind || "").toLowerCase();
  if (kind !== "multistream" && kind !== "instagram") return;
  const base = {
    userId: typeof d?.ownerUid === "string" ? d.ownerUid : null,
    roomId: typeof d?.roomId === "string" ? d.roomId : null,
    broadcastId: egressId,
  };
  const { status, error } = outputStatusFor(d);
  const startedMs = toEpochMs(d?.startedAt);
  const endedMs = toEpochMs(egressInfo?.endedAt) || Date.now();
  recordTelemetry("broadcast.ended", {
    ...base,
    metadata: {
      kind,
      outcome: status,
      egressStatus: d?.egressStatus ?? null,
      error,
      destinations: Array.isArray(d?.destinations) ? d.destinations : [],
      durationSec: startedMs ? Math.max(0, Math.round((Math.min(endedMs, Date.now()) - startedMs) / 1000)) : null,
    },
  });
  const results: any[] = Array.isArray(egressInfo?.streamResults) ? egressInfo.streamResults : [];
  for (const r of results.slice(0, 20)) {
    if (streamResultStatusName(r?.status) !== "failed") continue;
    recordTelemetry("destination.failed", {
      ...base,
      metadata: { stage: "egress", kind, host: urlHost(r?.url), error: redactEgressError(r?.error) },
    });
  }
}
