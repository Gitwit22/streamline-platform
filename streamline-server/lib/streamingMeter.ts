/**
 * Server-owned streaming meter (no client dependency).
 *
 * See lib/streamingMeterPure.ts for the billing rules. This module does the
 * Firestore I/O:
 *
 *   egressSessions/{egressId}   one doc per output (multistream RTMP egress,
 *                               Instagram RTMP egress, HLS egress):
 *     meterVersion: 2, kind, roomId, ownerUid (+ legacy `uid`), startedAt,
 *     endedAt, destinations[], destinationCount, meterOpen (bool),
 *     billedUntilMs, ownMinutesBilled, destinationMinutesBilled,
 *     streamingMinutesBilled, meterClosedAt, closeReason
 *
 *   streamingMeters/{roomId}    union of time already billed for the room
 *     covered[{startMs,endMs}], coveredMs, billedMinutes, ownerUid
 *
 *   usageMonthly/{owner}_{YYYY-MM}  (UTC month of the billing write)
 *     usage.streamingMinutes          gated monthly minutes
 *     usage.destinationMinutes        analytics only (never gated)
 *     usage.outputMinutes.{multistream,instagram,hls}  own time per output type
 *     legacy mirrors (same delta as streamingMinutes, for older readers):
 *       usage.participantMinutes, usage.transcodeMinutes,
 *       usage.minutes.live.currentPeriod, usage.minutes.transcode.currentPeriod
 *
 *   users/{owner}.usage.lifetime.{streamingMinutes,destinationMinutes}
 *     real lifetime totals (counted from the meter deploy onwards).
 *
 * Every counter write is a FieldValue.increment inside the same transaction
 * that advances the interval's billedUntilMs and the room union, so a repeated
 * or concurrent close/sweep/webhook bills nothing extra.
 *
 * Billing is triggered by: stop-multistream, HLS stop / auto-stop, the LiveKit
 * egress_ended webhook, the stale-HLS purge, and the periodic meter sweep
 * (which also bills running outputs incrementally, closes outputs LiveKit no
 * longer reports active, and enforces the monthly limit / maxSessionMinutes).
 *
 * Cutover: STREAMING_METER_CUTOVER_ISO (optional). Interval time before that
 * instant is never billed by the meter. Set it to the deploy time so streams
 * that were running across the deploy (and partly billed by the old
 * client-driven model) are not double-billed. Old egressSessions docs that
 * were already billed (countedAt / liveCountedAt) are always skipped.
 */
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../firebaseAdmin";
import { getEffectiveEntitlements } from "./effectiveEntitlements";
import { deletePrefix } from "./storageClient";
import { setHlsIdleIfRun } from "../services/rooms";
import { onHlsIdle } from "./viewerStats";
import {
  DEFAULT_LIMIT_GRACE_MINUTES,
  MAX_INTERVAL_MS,
  billableOverageMinutes,
  evaluateStreamingGate,
  isLegacyBilledSession,
  legacyStreamingSeed,
  monthKeyUTC,
  normalizeOutputKind,
  parseCutoverIso,
  planSegmentBilling,
  readCovered,
  readStreamingMinutes,
  shouldStopForMonthlyLimit,
  shouldStopForSessionCap,
  toEpochMs,
  type OutputKind,
  type StreamingGateDecision,
} from "./streamingMeterPure";

export const EGRESS_SESSIONS = "egressSessions";
export const STREAMING_METERS = "streamingMeters";
export const METER_VERSION = 2;

export function getMeterCutoverMs(): number | null {
  return parseCutoverIso(process.env.STREAMING_METER_CUTOVER_ISO);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

export async function openOutputInterval(params: {
  egressId: string;
  kind: OutputKind;
  roomId: string;
  roomName?: string | null;
  ownerUid: string;
  startedByUid?: string | null;
  startedAt: Date;
  destinations: string[];
  /** HLS only: the room hls.runId that owns this egress. */
  hlsRunId?: string | null;
  hlsPrefix?: string | null;
}): Promise<void> {
  const egressId = String(params.egressId || "").trim();
  if (!egressId) return;
  const now = new Date();
  const destinations = (params.destinations || []).map((d) => String(d || "destination"));
  await firestore
    .collection(EGRESS_SESSIONS)
    .doc(egressId)
    .set(
      {
        egressId,
        meterVersion: METER_VERSION,
        kind: params.kind,
        // `group` kept for older readers (normal | instagram | hls).
        group: params.kind === "multistream" ? "normal" : params.kind,
        roomId: params.roomId,
        roomName: params.roomName ?? null,
        uid: params.ownerUid, // legacy field name (billing uid)
        ownerUid: params.ownerUid,
        startedByUid: params.startedByUid ?? null,
        startedAt: params.startedAt,
        endedAt: null,
        destinations,
        destinationCount: Math.max(1, destinations.length),
        meterOpen: true,
        billedUntilMs: null,
        ownMinutesBilled: 0,
        destinationMinutesBilled: 0,
        streamingMinutesBilled: 0,
        ...(params.hlsRunId !== undefined ? { hlsRunId: params.hlsRunId } : {}),
        ...(params.hlsPrefix !== undefined ? { hlsPrefix: params.hlsPrefix } : {}),
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
}

// ---------------------------------------------------------------------------
// Bill / close
// ---------------------------------------------------------------------------

export type BillResult = {
  egressId: string;
  ownerUid: string | null;
  roomId: string | null;
  kind: OutputKind | null;
  monthKey: string;
  streamingMinutesDelta: number;
  destinationMinutesDelta: number;
  ownMinutesDelta: number;
  closed: boolean;
  skipped?: string;
};

/**
 * Bill the not-yet-billed part of one output interval (and close it when
 * `close` is set). Idempotent: safe to call repeatedly / concurrently from
 * stop routes, the egress_ended webhook and the sweep.
 */
export async function billOutputInterval(
  egressIdRaw: string,
  opts: { close?: boolean; endedAt?: Date | null; reason?: string; now?: Date } = {}
): Promise<BillResult | null> {
  const egressId = String(egressIdRaw || "").trim();
  if (!egressId) return null;
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const monthKey = monthKeyUTC(now);
  const close = opts.close === true;
  const sessionRef = firestore.collection(EGRESS_SESSIONS).doc(egressId);

  const result = await firestore.runTransaction(async (tx): Promise<BillResult | null> => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) return null;
    const d = (sessionSnap.data() || {}) as any;
    const kind = normalizeOutputKind(d.kind, d.group);
    const base: BillResult = {
      egressId,
      ownerUid: null,
      roomId: null,
      kind,
      monthKey,
      streamingMinutesDelta: 0,
      destinationMinutesDelta: 0,
      ownMinutesDelta: 0,
      closed: false,
    };

    if (d.meterClosedAt) return { ...base, skipped: "already_closed" };

    const closePatch = (reason: string, endMs: number | null) => ({
      meterOpen: false,
      meterClosedAt: now,
      closeReason: reason,
      ...(d.endedAt ? {} : { endedAt: endMs !== null ? new Date(endMs) : now }),
      updatedAt: now,
    });

    if (isLegacyBilledSession(d)) {
      tx.set(sessionRef, { ...closePatch("legacy_billed", null), meterSkipped: "legacy_billed" }, { merge: true });
      return { ...base, closed: true, skipped: "legacy_billed" };
    }

    const ownerUid = String(d.ownerUid || d.uid || "").trim();
    const roomId = String(d.roomId || "").trim();
    if (!ownerUid) {
      if (close) tx.set(sessionRef, { ...closePatch(opts.reason || "closed", null), meterSkipped: "no_owner" }, { merge: true });
      return { ...base, closed: close, skipped: "no_owner" };
    }

    const meterRef = firestore.collection(STREAMING_METERS).doc(roomId || `egress_${egressId}`);
    const usageRef = firestore.collection("usageMonthly").doc(`${ownerUid}_${monthKey}`);
    const userRef = firestore.collection("users").doc(ownerUid);
    const [meterSnap, usageSnap, userSnap] = await tx.getAll(meterRef, usageRef, userRef);
    const meter = meterSnap.exists ? ((meterSnap.data() || {}) as any) : {};
    const usageDoc = usageSnap.exists ? ((usageSnap.data() || {}) as any) : null;

    const storedEndMs = toEpochMs(d.endedAt);
    const paramEndMs = opts.endedAt ? toEpochMs(opts.endedAt) : null;
    const endMs = storedEndMs ?? (close ? paramEndMs ?? nowMs : null);
    const untilMs = endMs ?? nowMs;

    const plan = planSegmentBilling(
      {
        startMs: toEpochMs(d.startedAt),
        endMs,
        billedUntilMs: d.billedUntilMs === null || d.billedUntilMs === undefined ? null : num(d.billedUntilMs),
        destinations: num(d.destinationCount) || (Array.isArray(d.destinations) ? d.destinations.length : 1),
        ownMinutesBilled: num(d.ownMinutesBilled),
        destinationMinutesBilled: num(d.destinationMinutesBilled),
      },
      {
        covered: readCovered(meter.covered),
        coveredMs: num(meter.coveredMs),
        billedMinutes: num(meter.billedMinutes),
      },
      { untilMs, nowMs, cutoverMs: getMeterCutoverMs(), maxIntervalMs: MAX_INTERVAL_MS }
    );

    // A running interval past the hard cap is closed at the cap.
    const mustClose = close || plan.clamped;
    const sessionPatch: Record<string, any> = {
      meterVersion: METER_VERSION,
      ownerUid,
      kind,
      updatedAt: now,
      lastBilledAt: now,
    };
    if (plan.billedUntilMs !== null) sessionPatch.billedUntilMs = plan.billedUntilMs;
    if (plan.segment) {
      sessionPatch.ownMinutesBilled = plan.nextOwnMinutesBilled;
      sessionPatch.destinationMinutesBilled = plan.nextDestinationMinutesBilled;
      sessionPatch.streamingMinutesBilled = FieldValue.increment(plan.streamingMinutesDelta);
      // Legacy readers look at billedMinutes / countedAt.
      sessionPatch.billedMinutes = plan.nextOwnMinutesBilled;
    }
    if (mustClose) {
      Object.assign(
        sessionPatch,
        closePatch(plan.clamped && !close ? "max_interval" : opts.reason || "closed", plan.clamped ? plan.billedUntilMs : endMs)
      );
      sessionPatch.countedAt = now;
      if (plan.skippedReason) sessionPatch.meterSkipped = plan.skippedReason;
    }
    tx.set(sessionRef, sessionPatch, { merge: true });

    if (plan.segment) {
      tx.set(
        meterRef,
        {
          roomId: roomId || null,
          ownerUid,
          covered: plan.nextRoom.covered,
          coveredMs: plan.nextRoom.coveredMs,
          billedMinutes: plan.nextRoom.billedMinutes,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    const sDelta = plan.streamingMinutesDelta;
    const dDelta = plan.destinationMinutesDelta;
    const oDelta = plan.ownMinutesDelta;
    if (sDelta > 0 || dDelta > 0 || oDelta > 0) {
      const hasStreamingField =
        !!usageDoc && typeof usageDoc?.usage?.streamingMinutes === "number" && Number.isFinite(usageDoc.usage.streamingMinutes);
      // First meter write on a month doc created by the old model: seed from the
      // old live+HLS minutes (read in this transaction, so no lost update).
      const streamingValue = usageDoc && !hasStreamingField ? legacyStreamingSeed(usageDoc) + sDelta : FieldValue.increment(sDelta);

      const usageWrite: Record<string, any> = {
        uid: ownerUid,
        monthKey,
        usage: {
          streamingMinutes: streamingValue,
          destinationMinutes: FieldValue.increment(dDelta),
          outputMinutes: { [kind]: FieldValue.increment(oDelta) },
          // Legacy mirrors (deprecated; readers should use streamingMinutes).
          participantMinutes: FieldValue.increment(sDelta),
          transcodeMinutes: FieldValue.increment(sDelta),
          minutes: {
            live: { currentPeriod: FieldValue.increment(sDelta) },
            transcode: { currentPeriod: FieldValue.increment(sDelta) },
          },
        },
        lastStreamingBill: { roomId: roomId || null, egressId, kind, minutes: sDelta, at: now },
        updatedAt: now,
      };
      if (!usageDoc || !usageDoc.createdAt) usageWrite.createdAt = now;
      tx.set(usageRef, usageWrite, { merge: true });

      if (userSnap.exists) {
        tx.set(
          userRef,
          {
            usage: {
              lifetime: {
                streamingMinutes: FieldValue.increment(sDelta),
                destinationMinutes: FieldValue.increment(dDelta),
              },
              lastUsageUpdate: now,
            },
          },
          { merge: true }
        );
      }
    }

    return {
      ...base,
      ownerUid,
      roomId: roomId || null,
      streamingMinutesDelta: sDelta,
      destinationMinutesDelta: dDelta,
      ownMinutesDelta: oDelta,
      closed: mustClose,
      skipped: plan.skippedReason,
    };
  });

  if (result && result.ownerUid && result.streamingMinutesDelta > 0) {
    try {
      await recomputeOverageTotals(result.ownerUid);
    } catch (e: any) {
      console.error("[streaming-meter] overage recompute failed", { uid: result.ownerUid, error: e?.message || e });
    }
  }
  if (result && (result.streamingMinutesDelta > 0 || result.closed)) {
    console.log("[streaming-meter] billed", {
      egressId,
      ownerUid: result.ownerUid,
      roomId: result.roomId,
      kind: result.kind,
      streamingMinutes: result.streamingMinutesDelta,
      destinationMinutes: result.destinationMinutesDelta,
      closed: result.closed,
      reason: opts.reason || null,
      skipped: result.skipped || null,
    });
  }
  return result;
}

/** Close + bill several outputs; errors are logged, never thrown. */
export async function closeOutputIntervals(
  egressIds: string[],
  opts: { endedAt?: Date | null; reason: string; now?: Date }
): Promise<BillResult[]> {
  const out: BillResult[] = [];
  for (const id of Array.from(new Set(egressIds.filter(Boolean)))) {
    try {
      const r = await billOutputInterval(id, { ...opts, close: true });
      if (r) out.push(r);
    } catch (e: any) {
      console.error("[streaming-meter] CRITICAL: failed to bill output interval", {
        egressId: id,
        reason: opts.reason,
        error: e?.message || e,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export function readOveragesEnabled(userDoc: any): boolean {
  const v = userDoc?.billingSettings?.overagesEnabled ?? userDoc?.billing?.overagesEnabled ?? userDoc?.overagesEnabled;
  return v === true;
}

export type StreamingUsageStatus = {
  uid: string;
  monthKey: string;
  decision: StreamingGateDecision;
  usageDoc: any;
  userDoc: any;
  entitlements: Awaited<ReturnType<typeof getEffectiveEntitlements>>;
};

/** Current month's streaming usage vs the effective plan (adminOverridePlanId respected) + bonus minutes. */
export async function getStreamingUsageStatus(uid: string, now: Date = new Date()): Promise<StreamingUsageStatus> {
  const monthKey = monthKeyUTC(now);
  const [entitlements, userSnap, usageSnap] = await Promise.all([
    getEffectiveEntitlements(uid),
    firestore.collection("users").doc(uid).get(),
    firestore.collection("usageMonthly").doc(`${uid}_${monthKey}`).get(),
  ]);
  const userDoc = userSnap.exists ? ((userSnap.data() || {}) as any) : {};
  const usageDoc = usageSnap.exists ? ((usageSnap.data() || {}) as any) : {};
  const decision = evaluateStreamingGate({
    usedMinutes: readStreamingMinutes(usageDoc),
    includedMinutes: entitlements.limits.monthlyStreamingMinutes, // null = unlimited
    bonusMinutes: num(userDoc.bonusMinutes),
    planAllowsOverages: !!entitlements.features.overages,
    overagesEnabled: readOveragesEnabled(userDoc),
  });
  return { uid, monthKey, decision, usageDoc, userDoc, entitlements };
}

/**
 * Start gate for streaming outputs (multistream / HLS). Fails OPEN on
 * infrastructure errors (logged at error level with uid/room) so a Firestore
 * hiccup never blocks a live creator; the sweep still enforces the limit.
 */
export async function checkStreamingStartGate(params: {
  ownerUid: string;
  roomId: string;
  actorUid?: string;
  route: string;
}): Promise<{ allowed: true; decision?: StreamingGateDecision } | { allowed: false; decision: StreamingGateDecision }> {
  try {
    const status = await getStreamingUsageStatus(params.ownerUid);
    if (!status.decision.allowed) {
      console.warn(`[${params.route}] streaming minutes exhausted`, {
        ownerUid: params.ownerUid,
        actorUid: params.actorUid || null,
        roomId: params.roomId,
        used: status.decision.usedMinutes,
        limit: status.decision.limitMinutes,
      });
      return { allowed: false, decision: status.decision };
    }
    return { allowed: true, decision: status.decision };
  } catch (e: any) {
    console.error(`[${params.route}] usage gate failed; failing open`, {
      ownerUid: params.ownerUid,
      actorUid: params.actorUid || null,
      roomId: params.roomId,
      error: e?.message || e,
    });
    return { allowed: true };
  }
}

/** Response body for a blocked start (stable error code + details for the UI). */
export function streamingGateErrorBody(decision: StreamingGateDecision) {
  return {
    error: "usage_exhausted",
    reason: "Monthly streaming minutes used up",
    usedMinutes: decision.usedMinutes,
    limitMinutes: decision.limitMinutes,
    requiresUpgrade: !!decision.requiresUpgrade,
    requiresOveragesEnabled: !!decision.requiresOveragesEnabled,
  };
}

/**
 * Persist this month's overage totals (absolute recompute from the current
 * counters, so it is idempotent). Only minutes beyond the limit while overage
 * billing is active (plan allows + user opted in) are billable. Stripe metering
 * is not wired yet; this is the source a future meter reporter should read.
 */
export async function recomputeOverageTotals(uid: string): Promise<void> {
  const status = await getStreamingUsageStatus(uid);
  const billable = billableOverageMinutes(status.decision);
  const now = new Date();
  await firestore
    .collection("usageMonthly")
    .doc(`${uid}_${status.monthKey}`)
    .set(
      {
        uid,
        monthKey: status.monthKey,
        overages: {
          streamingMinutes: billable,
          limitMinutes: status.decision.limitMinutes,
          overagesActive: status.decision.overagesActive,
          // Legacy mirrors read by older admin/UI code.
          participantMinutes: billable,
          transcodeMinutes: 0,
          updatedAt: now,
        },
        updatedAt: now,
      },
      { merge: true }
    );
}

// ---------------------------------------------------------------------------
// LiveKit helpers
// ---------------------------------------------------------------------------

let _lkMod: any | null = null;
async function getEgressClient(): Promise<any | null> {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) return null;
  if (!_lkMod) _lkMod = await import("livekit-server-sdk");
  return new _lkMod.EgressClient(url, key, secret);
}

/** EgressStatus: 0 starting, 1 active, 2 ending; >= 3 is terminal. */
type EgressLiveness = { state: "active" } | { state: "ended"; endedAtMs: number | null } | { state: "unknown" };

async function getEgressLiveness(client: any, egressId: string): Promise<EgressLiveness> {
  try {
    const list = await client.listEgress({ egressId });
    if (!Array.isArray(list) || list.length === 0) return { state: "ended", endedAtMs: null };
    const info = list[0] || {};
    const status = Number(info.status);
    if (Number.isFinite(status) && status <= 2) return { state: "active" };
    return { state: "ended", endedAtMs: toEpochMs(info.endedAt) };
  } catch (e: any) {
    console.warn("[streaming-meter] listEgress failed; treating as unknown", { egressId, error: e?.message || e });
    return { state: "unknown" };
  }
}

async function stopEgressQuietly(client: any | null, egressId: string): Promise<void> {
  if (!client) return;
  try {
    await client.stopEgress(egressId);
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (!/412|not running|not found|EGRESS_(COMPLETE|FAILED|ABORTED)/i.test(msg)) {
      console.error("[streaming-meter] stopEgress failed", { egressId, error: msg });
    }
  }
}

/** Stop one output (LiveKit + app state) and close/bill its interval. */
async function stopOutput(client: any | null, session: { id: string; data: any }, reason: string, now: Date) {
  const d = session.data || {};
  const kind = normalizeOutputKind(d.kind, d.group);
  const ownerUid = String(d.ownerUid || d.uid || "").trim();
  const roomId = String(d.roomId || "").trim();

  await stopEgressQuietly(client, session.id);
  await billOutputInterval(session.id, { close: true, endedAt: now, reason, now });

  try {
    if (kind === "hls" && roomId) {
      const roomRef = firestore.collection("rooms").doc(roomId);
      const roomSnap = await roomRef.get();
      const hls = ((roomSnap.data() || {}) as any).hls || {};
      if (hls.egressId === session.id) {
        const flipped = await setHlsIdleIfRun(roomRef, hls.runId ?? null);
        if (flipped) {
          void onHlsIdle(roomId, roomSnap.data() || {});
          await deletePrefix(String(hls.prefix || d.hlsPrefix || `hls/${roomId}/`)).catch((e: any) =>
            console.warn("[streaming-meter] HLS deletePrefix failed", { roomId, error: e?.message || e })
          );
        }
      }
    } else if (ownerUid && roomId) {
      const ref = firestore.collection("activeStreams").doc(`${ownerUid}_${roomId}`);
      const snap = await ref.get();
      if (snap.exists) {
        const a = (snap.data() || {}) as any;
        const ids = [a.egressId, a.egressIds?.normal, a.egressIds?.instagram].filter(Boolean);
        if (ids.includes(session.id)) {
          for (const other of ids) if (other !== session.id) await stopEgressQuietly(client, other);
          await closeOutputIntervals(
            ids.filter((x: string) => x !== session.id),
            { endedAt: now, reason, now }
          );
          await ref.delete();
        }
      }
    }
  } catch (e: any) {
    console.warn("[streaming-meter] failed to clear output state after stop", { egressId: session.id, roomId, error: e?.message || e });
  }

  console.warn("[streaming-meter] stopped output", { egressId: session.id, kind, ownerUid, roomId, reason });
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

export type SweepResult = {
  ok: true;
  considered: number;
  billed: number;
  closed: number;
  streamingMinutesBilled: number;
  stopped: Array<{ egressId: string; roomId: string | null; reason: string }>;
  errors: number;
};

/**
 * Periodic meter sweep (maintenance cron + in-process timer; the HLS /status
 * poll runs it for one room):
 *   1. closes + bills open intervals whose egress ended (endedAt known, or
 *      LiveKit no longer reports it active) or that are older than 24h;
 *   2. bills running intervals up to now (near-real-time usage);
 *   3. stops outputs when the owner is past the monthly limit (+ grace)
 *      without overage opt-in, or a room exceeds plan maxSessionMinutes.
 */
export async function sweepStreamingMeter(opts: {
  now?: Date;
  limit?: number;
  roomId?: string;
  checkLiveKit?: boolean;
  graceMinutes?: number;
} = {}): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const limit = Math.max(1, Math.min(1000, Math.floor(num(opts.limit) || 500)));
  const grace = opts.graceMinutes ?? DEFAULT_LIMIT_GRACE_MINUTES;
  const result: SweepResult = { ok: true, considered: 0, billed: 0, closed: 0, streamingMinutesBilled: 0, stopped: [], errors: 0 };

  let q: FirebaseFirestore.Query = firestore.collection(EGRESS_SESSIONS).where("meterOpen", "==", true);
  if (opts.roomId) q = q.where("roomId", "==", opts.roomId);
  const snap = await q.limit(limit).get();
  if (snap.empty) return result;

  const client = opts.checkLiveKit === false ? null : await getEgressClient().catch(() => null);
  const stillOpen: Array<{ id: string; data: any }> = [];

  for (const doc of snap.docs) {
    result.considered += 1;
    const d = (doc.data() || {}) as any;
    try {
      const startMs = toEpochMs(d.startedAt);
      let close = !!d.endedAt;
      let endedAt: Date | null = null;
      let reason = "ended";
      if (!close && startMs !== null && nowMs - startMs >= MAX_INTERVAL_MS) {
        await stopEgressQuietly(client, doc.id);
        close = true;
        endedAt = new Date(startMs + MAX_INTERVAL_MS);
        reason = "max_interval";
      } else if (!close && client) {
        const live = await getEgressLiveness(client, doc.id);
        if (live.state === "ended") {
          close = true;
          endedAt = live.endedAtMs ? new Date(Math.min(live.endedAtMs, nowMs)) : now;
          reason = "egress_inactive";
        }
      }
      const r = await billOutputInterval(doc.id, { close, endedAt, reason: close ? reason : "sweep", now });
      if (r) {
        if (r.streamingMinutesDelta > 0) result.billed += 1;
        result.streamingMinutesBilled += r.streamingMinutesDelta;
        if (r.closed) result.closed += 1;
        else stillOpen.push({ id: doc.id, data: d });
      }
    } catch (e: any) {
      result.errors += 1;
      console.error("[streaming-meter] sweep failed for interval", { egressId: doc.id, error: e?.message || e });
    }
  }

  // ---- Mid-session caps ----------------------------------------------------
  const byOwner = new Map<string, Array<{ id: string; data: any }>>();
  for (const s of stillOpen) {
    const owner = String(s.data.ownerUid || s.data.uid || "").trim();
    if (!owner) continue;
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner)!.push(s);
  }

  for (const [ownerUid, sessions] of byOwner) {
    let status: StreamingUsageStatus;
    try {
      status = await getStreamingUsageStatus(ownerUid, now);
    } catch (e: any) {
      // Fail open: never stop a live creator because the gate could not be read.
      console.error("[streaming-meter] usage status failed; not enforcing caps", { ownerUid, error: e?.message || e });
      continue;
    }

    const toStop = new Map<string, string>();
    if (shouldStopForMonthlyLimit(status.decision, grace)) {
      for (const s of sessions) toStop.set(s.id, "monthly_limit");
    }

    const maxSessionMinutes = status.entitlements.limits.maxSessionMinutes; // null = no cap
    if (maxSessionMinutes !== null) {
      const byRoom = new Map<string, Array<{ id: string; data: any }>>();
      for (const s of sessions) {
        const rid = String(s.data.roomId || "");
        if (!byRoom.has(rid)) byRoom.set(rid, []);
        byRoom.get(rid)!.push(s);
      }
      for (const [, roomSessions] of byRoom) {
        const starts = roomSessions.map((s) => toEpochMs(s.data.startedAt)).filter((v): v is number => v !== null);
        const sessionStartMs = starts.length ? Math.min(...starts) : null;
        if (shouldStopForSessionCap({ sessionStartMs, nowMs, maxSessionMinutes, graceMinutes: grace })) {
          for (const s of roomSessions) if (!toStop.has(s.id)) toStop.set(s.id, "max_session");
        }
      }
    }

    for (const s of sessions) {
      const reason = toStop.get(s.id);
      if (!reason) continue;
      try {
        const lkClient = client || (await getEgressClient().catch(() => null));
        await stopOutput(lkClient, s, reason, now);
        result.stopped.push({ egressId: s.id, roomId: s.data.roomId || null, reason });
      } catch (e: any) {
        result.errors += 1;
        console.error("[streaming-meter] failed to stop output over cap", { egressId: s.id, ownerUid, reason, error: e?.message || e });
      }
    }
  }

  return result;
}

const lastRoomTick = new Map<string, number>();
const ROOM_TICK_MS = 60_000;

/**
 * Throttled per-room meter tick for the HLS /status poll: bills the room's
 * running outputs and enforces caps. Returns the ids stopped (if any).
 */
export async function tickRoomMeter(roomId: string): Promise<string[]> {
  const nowMs = Date.now();
  const last = lastRoomTick.get(roomId) || 0;
  if (nowMs - last < ROOM_TICK_MS) return [];
  lastRoomTick.set(roomId, nowMs);
  if (lastRoomTick.size > 5000) lastRoomTick.clear();
  try {
    const r = await sweepStreamingMeter({ roomId, limit: 20, checkLiveKit: false });
    return r.stopped.map((s) => s.egressId);
  } catch (e: any) {
    console.error("[streaming-meter] room tick failed", { roomId, error: e?.message || e });
    return [];
  }
}
