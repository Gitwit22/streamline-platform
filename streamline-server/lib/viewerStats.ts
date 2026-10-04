/**
 * Viewer counting storage (Firestore + LiveKit). Pure rules live in
 * lib/viewerStatsPure.ts.
 *
 * Layout (no composite indexes needed):
 *   rooms/{roomId}.viewerStats = { sessionId, startedAt, endedAt|null, peak,
 *                                  totalUnique, totalUniqueRtc, totalUniqueHls }
 *   rooms/{roomId}/viewerSessions/{sessionId}            final stats + .summary
 *       (lib/streamSummary.ts: duration, peak, uniques, avgWatchSeconds)
 *   rooms/{roomId}/viewerSessions/{sessionId}/viewers/{viewerKey}
 *       = { kind, firstSeenAt, lastSeenAt, leftAt?, identity? }  one doc per
 *         unique viewer (RTC leftAt from the participant_left webhook)
 *   rooms/{roomId}/hlsViewers/{viewerId}
 *       = { sessionId, firstSeenAt, lastSeenAtMs, leftAtMs? }  HLS presence; "current"
 *         is a count() over the single-field range lastSeenAtMs >= now - TTL.
 *
 * Every hook is best-effort: callers wrap these in try/catch or `void ...catch`.
 * Timestamps are epoch milliseconds.
 */
import { recordTelemetry } from "./telemetry";
import { randomUUID } from "node:crypto";
import { firestore as db } from "../firebaseAdmin";
import { getLiveKitSdk } from "./livekit";
import { persistSessionSummary, sessionWatchStats } from "./streamSummary";
import {
  HLS_VIEWER_TTL_MS,
  currentViewerTotal,
  finalizeViewerStats,
  isSessionActive,
  newViewerStats,
  nextPeak,
  readViewerStats,
  recordingViewerFields,
  summarizeRtcParticipants,
  viewerKeyFor,
  withNewViewer,
  type RecordingViewerFields,
  type RtcCounts,
  type ViewerKind,
  type ViewerStats,
} from "./viewerStatsPure";

const roomRef = (roomId: string) => db.collection("rooms").doc(roomId);
const sessionRef = (roomId: string, sessionId: string) => roomRef(roomId).collection("viewerSessions").doc(sessionId);
const hlsViewersCol = (roomId: string) => roomRef(roomId).collection("hlsViewers");

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/** Returns the active session, creating one if none is active (idempotent). */
export async function ensureLiveSession(roomId: string): Promise<ViewerStats | null> {
  const ref = roomRef(roomId);
  const stats = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const existing = readViewerStats((snap.data() as any)?.viewerStats);
    if (isSessionActive(existing)) return existing;
    const next = newViewerStats(randomUUID(), Date.now());
    tx.set(ref, { viewerStats: next }, { merge: true });
    return next;
  });
  if (stats) rememberSession(roomId, stats);
  return stats;
}

/** Ends the active session (if any) and writes its summary doc. */
export async function endLiveSession(roomId: string): Promise<ViewerStats | null> {
  const ref = roomRef(roomId);
  let lastCurrent = 0;
  try {
    lastCurrent = (await getCurrentViewers(roomId, { fresh: true })).total;
  } catch {
    lastCurrent = 0;
  }
  const final = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const existing = readViewerStats((snap.data() as any)?.viewerStats);
    if (!isSessionActive(existing)) return null;
    const done = finalizeViewerStats(existing, Date.now(), lastCurrent);
    tx.set(ref, { viewerStats: done }, { merge: true });
    tx.set(sessionRef(roomId, done.sessionId), done, { merge: true });
    return done;
  });
  sessionCache.delete(roomId);
  currentCache.delete(roomId);
  if (final) {
    // Summary first: HLS watch times live on the presence docs being pruned.
    void persistSessionSummary(roomId, final)
      .catch((err) => warn("persistSessionSummary", roomId, err))
      .then(() => pruneHlsPresence(roomId))
      .catch(() => {});
  }
  return final;
}

/** Deletes HLS presence docs that are no longer current (bounded batch). */
async function pruneHlsPresence(roomId: string): Promise<void> {
  const stale = await hlsViewersCol(roomId)
    .where("lastSeenAtMs", "<", Date.now() - HLS_VIEWER_TTL_MS)
    .limit(400)
    .get();
  if (stale.empty) return;
  const batch = db.batch();
  stale.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

// ---------------------------------------------------------------------------
// Unique viewers
// ---------------------------------------------------------------------------

/**
 * Records a viewer in the active session. The first sighting creates the
 * viewer doc and increments the session totals exactly once (transaction);
 * later sightings only bump lastSeenAt. Returns null when no session is active.
 */
export async function recordViewer(
  roomId: string,
  viewerKey: string,
  kind: ViewerKind,
  opts: { identity?: string | null } = {}
): Promise<{ stats: ViewerStats; isNew: boolean } | null> {
  const ref = roomRef(roomId);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const stats = readViewerStats((snap.data() as any)?.viewerStats);
    if (!isSessionActive(stats)) return null;
    const vRef = sessionRef(roomId, stats.sessionId).collection("viewers").doc(viewerKey);
    const vSnap = await tx.get(vRef);
    const now = Date.now();
    if (vSnap.exists) {
      tx.update(vRef, { lastSeenAt: now });
      return { stats, isNew: false };
    }
    tx.set(vRef, {
      kind,
      firstSeenAt: now,
      lastSeenAt: now,
      ...(opts.identity ? { identity: String(opts.identity).slice(0, 200) } : {}),
    });
    const next = withNewViewer(stats, kind);
    tx.set(
      ref,
      {
        viewerStats: {
          totalUnique: next.totalUnique,
          totalUniqueRtc: next.totalUniqueRtc,
          totalUniqueHls: next.totalUniqueHls,
        },
      },
      { merge: true }
    );
    return { stats: next, isNew: true };
  });
  if (result) rememberSession(roomId, result.stats);
  return result;
}

/**
 * HLS heartbeat: refresh presence (1 read + 1 write); on the first heartbeat
 * of a session also record the unique viewer (transaction). Returns the
 * updated session stats when this heartbeat added a new unique viewer.
 */
export async function recordHlsHeartbeat(roomId: string, viewerId: string, sessionId: string): Promise<ViewerStats | null> {
  const pRef = hlsViewersCol(roomId).doc(viewerId);
  const pSnap = await pRef.get();
  const now = Date.now();
  const prev = (pSnap.data() || {}) as any;
  if (!pSnap.exists || prev.sessionId !== sessionId) {
    const recorded = await recordViewer(roomId, viewerKeyFor("hls", viewerId), "hls");
    await pRef.set({ sessionId, firstSeenAt: now, lastSeenAtMs: now });
    currentCache.delete(roomId);
    // First heartbeat of this viewer in this live session (not per heartbeat).
    recordTelemetry("hls.viewer_joined", {
      roomId,
      broadcastId: sessionId,
      metadata: { returning: pSnap.exists, newUnique: !!recorded },
    });
    return recorded ? recorded.stats : null;
  }
  await pRef.set({ lastSeenAtMs: now }, { merge: true });
  return null;
}

/** sendBeacon leave: drop the viewer out of "current" immediately. */
export async function markHlsViewerLeft(roomId: string, viewerId: string): Promise<void> {
  const pRef = hlsViewersCol(roomId).doc(viewerId);
  const pSnap = await pRef.get();
  if (!pSnap.exists) return;
  const prev = (pSnap.data() || {}) as any;
  // A repeated leave beacon for the same viewer is not a second leave.
  if (prev.leftAtMs && !(Number(prev.lastSeenAtMs) > Number(prev.leftAtMs))) return;
  const now = Date.now();
  // leftAtMs keeps the real leave time for watch-time stats.
  await pRef.set({ lastSeenAtMs: 0, leftAtMs: now }, { merge: true });
  currentCache.delete(roomId);
  const firstSeen = Number(prev.firstSeenAt);
  recordTelemetry("hls.viewer_left", {
    roomId,
    broadcastId: typeof prev.sessionId === "string" ? prev.sessionId : null,
    metadata: { watchedSec: Number.isFinite(firstSeen) && firstSeen > 0 ? Math.max(0, Math.round((now - firstSeen) / 1000)) : null },
  });
}

/**
 * LiveKit participant_left: stamp the RTC viewer's leave time on its doc in
 * the room's current (or just-ended) session, so watch time is measurable.
 * Only updates an existing viewer doc (hosts/agents never get one).
 */
export async function recordRtcViewerLeft(roomId: string, identity: string): Promise<boolean> {
  const id = String(identity || "").trim();
  if (!id) return false;
  const snap = await roomRef(roomId).get();
  const stats = snap.exists ? readViewerStats((snap.data() as any)?.viewerStats) : null;
  if (!stats) return false;
  const now = Date.now();
  // A leave long after the session ended belongs to no session we track.
  if (stats.endedAt !== null && now - stats.endedAt > RTC_LEAVE_GRACE_MS) return false;
  const vRef = sessionRef(roomId, stats.sessionId).collection("viewers").doc(viewerKeyFor("rtc", id));
  const vSnap = await vRef.get();
  if (!vSnap.exists) return false;
  const leftAt = stats.endedAt !== null ? Math.min(now, stats.endedAt) : now;
  await vRef.set({ lastSeenAt: leftAt, leftAt }, { merge: true });
  return true;
}

/** participant_left may arrive shortly after room_finished ended the session. */
const RTC_LEAVE_GRACE_MS = 2 * 60_000;

// ---------------------------------------------------------------------------
// Current viewers
// ---------------------------------------------------------------------------

export async function currentHlsCount(roomId: string): Promise<number> {
  const snap = await hlsViewersCol(roomId)
    .where("lastSeenAtMs", ">=", Date.now() - HLS_VIEWER_TTL_MS)
    .count()
    .get();
  return Number(snap.data().count || 0);
}

function deriveServiceUrl(): string | null {
  const raw = process.env.LIVEKIT_URL || "";
  if (!raw) return null;
  return raw.replace(/^wss?:\/\//i, (m) => (m.toLowerCase() === "ws://" ? "http://" : "https://"));
}

export type RtcCountsResult = RtcCounts & {
  /** false when LiveKit reports the room does not exist; null when unknown. */
  roomExists: boolean | null;
};

/** LiveKit participants split into host / on stage / audience. */
async function rtcCounts(livekitRoomName: string, ownerUid?: string | null): Promise<RtcCountsResult> {
  const empty = { host: 0, onStage: 0, audience: 0 };
  const name = String(livekitRoomName || "").trim();
  const serviceUrl = deriveServiceUrl();
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!name || !serviceUrl || !apiKey || !apiSecret) return { ...empty, roomExists: null };
  try {
    const { RoomServiceClient } = await getLiveKitSdk();
    const client = new RoomServiceClient(serviceUrl, apiKey, apiSecret);
    const participants = (await client.listParticipants(name)) || [];
    return { ...summarizeRtcParticipants(participants as any[], ownerUid), roomExists: true };
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    const status = (typeof err?.status === "number" && err.status) || (typeof err?.code === "number" && err.code) || 0;
    if (status === 404 || msg.includes("404") || /not\s*found|does not exist/i.test(msg)) {
      return { ...empty, roomExists: false };
    }
    return { ...empty, roomExists: null };
  }
}

export type CurrentViewers = {
  total: number;
  hls: number;
  rtcAudience: number;
  onStage: number;
  host: number;
  roomExists: boolean | null;
};

/** Short per-process cache so many heartbeats don't each run count() + LiveKit. */
const CURRENT_CACHE_MS = 5_000;
const currentCache = new Map<string, { at: number; value: CurrentViewers }>();

export async function getCurrentViewers(
  roomId: string,
  opts: { room?: any; fresh?: boolean } = {}
): Promise<CurrentViewers> {
  const cached = currentCache.get(roomId);
  if (!opts.fresh && cached && Date.now() - cached.at < CURRENT_CACHE_MS) return cached.value;
  let room = opts.room;
  if (!room) {
    const snap = await roomRef(roomId).get();
    room = snap.exists ? snap.data() || {} : {};
  }
  const [hls, rtc] = await Promise.all([
    currentHlsCount(roomId).catch(() => 0),
    rtcCounts(String(room?.livekitRoomName || roomId), room?.ownerId),
  ]);
  const value: CurrentViewers = {
    total: currentViewerTotal(hls, rtc.audience),
    hls,
    rtcAudience: rtc.audience,
    onStage: rtc.onStage,
    host: rtc.host,
    roomExists: rtc.roomExists,
  };
  currentCache.set(roomId, { at: Date.now(), value });
  if (currentCache.size > 5_000) currentCache.delete(currentCache.keys().next().value as string);
  return value;
}

// ---------------------------------------------------------------------------
// Peak
// ---------------------------------------------------------------------------

/** Last known session per room (peak short-circuit; avoids a write per read). */
const sessionCache = new Map<string, ViewerStats>();

function rememberSession(roomId: string, stats: ViewerStats) {
  sessionCache.set(roomId, stats);
  if (sessionCache.size > 5_000) sessionCache.delete(sessionCache.keys().next().value as string);
}

/** Raises viewerStats.peak to `current` when higher. Writes only on a new peak. */
export async function updatePeak(roomId: string, current: number, sessionId?: string | null): Promise<number | null> {
  const known = sessionCache.get(roomId);
  const sameSession = !sessionId || known?.sessionId === sessionId;
  if (known && sameSession && isSessionActive(known) && current <= known.peak) return known.peak;
  const ref = roomRef(roomId);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const stats = readViewerStats((snap.data() as any)?.viewerStats);
    if (!isSessionActive(stats)) return null;
    const peak = nextPeak(stats.peak, current);
    if (peak > stats.peak) tx.set(ref, { viewerStats: { peak } }, { merge: true });
    return { ...stats, peak };
  });
  if (result) rememberSession(roomId, result);
  return result ? result.peak : null;
}

// ---------------------------------------------------------------------------
// Hooks (best-effort wrappers for existing flows)
// ---------------------------------------------------------------------------

function warn(where: string, roomId: string, err: any) {
  console.warn(`[viewerStats] ${where} failed`, { roomId, error: err?.message || err });
}

/**
 * Host/producer joined (token minted). If the LiveKit room no longer exists
 * and HLS is not live, the previous session is over: end it first, so a new
 * go-live starts fresh totals even when the room_finished webhook was missed.
 */
export async function onHostGoingLive(roomId: string, room: any): Promise<void> {
  try {
    const stats = readViewerStats(room?.viewerStats);
    const hlsLive = room?.hls?.status === "live" || room?.hls?.status === "starting";
    if (isSessionActive(stats) && !hlsLive) {
      const rtc = await rtcCounts(String(room?.livekitRoomName || roomId), room?.ownerId);
      if (rtc.roomExists === false) await endLiveSession(roomId);
    }
    await ensureLiveSession(roomId);
  } catch (err) {
    warn("onHostGoingLive", roomId, err);
  }
}

export async function onHlsLive(roomId: string): Promise<void> {
  try {
    await ensureLiveSession(roomId);
  } catch (err) {
    warn("onHlsLive", roomId, err);
  }
}

/**
 * HLS went idle. End the session only when nobody (other than egress/agents)
 * is left in the RTC room; otherwise room_finished ends it later.
 */
export async function onHlsIdle(roomId: string, room?: any): Promise<void> {
  try {
    let data = room;
    if (!data) {
      const snap = await roomRef(roomId).get();
      data = snap.exists ? snap.data() || {} : {};
    }
    const rtc = await rtcCounts(String(data?.livekitRoomName || roomId), data?.ownerId);
    const anyoneLeft = rtc.host + rtc.onStage + rtc.audience > 0;
    if (rtc.roomExists === false || (rtc.roomExists === true && !anyoneLeft)) {
      await endLiveSession(roomId);
    }
  } catch (err) {
    warn("onHlsIdle", roomId, err);
  }
}

/** LiveKit room_finished: end the session unless HLS is still live. */
export async function onRoomFinished(roomId: string): Promise<void> {
  try {
    const snap = await roomRef(roomId).get();
    if (!snap.exists) return;
    const hlsStatus = String((snap.data() as any)?.hls?.status || "idle");
    if (hlsStatus === "live" || hlsStatus === "starting") return;
    await endLiveSession(roomId);
  } catch (err) {
    warn("onRoomFinished", roomId, err);
  }
}

/**
 * Copies the room's live-session numbers onto a recording doc:
 * viewerCount (unique total), peakViewers, streamDurationSec,
 * avgWatchSeconds (null when unmeasured), streamSessionId. Best-effort;
 * returns the fields written, or null when the room has no session.
 */
export async function copyViewerStatsToRecording(
  recordingRef: FirebaseFirestore.DocumentReference,
  roomId: string | null | undefined
): Promise<RecordingViewerFields | null> {
  const id = String(roomId || "").trim();
  if (!id || id.includes("/")) return null;
  try {
    const stats = await getViewerStats(id);
    if (!stats) return null;
    const watch = await sessionWatchStats(id, stats).catch(() => null);
    const fields = recordingViewerFields(stats, { avgWatchSeconds: watch?.avgWatchSeconds ?? null, nowMs: Date.now() });
    if (!fields) return null;
    await recordingRef.set(fields, { merge: true });
    return fields;
  } catch (err) {
    warn("copyViewerStatsToRecording", id, err);
    return null;
  }
}

/** Reads the room's current viewerStats (no writes). */
async function getViewerStats(roomId: string): Promise<ViewerStats | null> {
  const snap = await roomRef(roomId).get();
  return snap.exists ? readViewerStats((snap.data() as any)?.viewerStats) : null;
}
