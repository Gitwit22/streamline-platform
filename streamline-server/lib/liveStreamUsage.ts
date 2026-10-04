/**
 * Server-computed live stream usage (replaces trusting client `minutes`).
 *
 * Bills live minutes for a room from the server-written `egressSessions`
 * docs (startedAt/endedAt from the multistream start/stop routes and the
 * LiveKit egress_ended webhook). Everything happens in ONE Firestore
 * transaction:
 *   - each billed session is stamped `liveCountedAt` + billed interval, so a
 *     repeated/concurrent streamEnded call bills nothing extra;
 *   - users/{uid}.usage.* and usageMonthly/{uid}_{month} counters are bumped
 *     with FieldValue.increment (no read-modify-write lost updates).
 *
 * Transcode (egress) minutes are NOT handled here: they are already billed
 * server-side per egress session by stop-multistream / egress_ended
 * (`countedAt` on the same egressSessions docs).
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getCurrentMonthKey } from "./usageTracker";
import { planLiveSessionBilling, type LiveSessionToMark } from "./liveSessionMinutes";

export class LiveUsageUserNotFoundError extends Error {
  constructor(uid: string) {
    super(`user not found: ${uid}`);
    this.name = "LiveUsageUserNotFoundError";
  }
}

export type LiveUsageResult = {
  minutes: number;
  billableMs: number;
  sessionsCounted: LiveSessionToMark[];
  skipped: Array<{ id: string; reason: string }>;
  monthKey: string;
  usageDocId: string;
  /** Post-write counters (as seen inside the transaction). Null when nothing was billed. */
  totals: null | {
    participantMinutes: number;
    transcodeMinutes: number;
    liveCurrentPeriod: number;
    liveLifetime: number;
    hoursStreamedThisMonth: number;
    ytdHours: number;
  };
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toDateOrNull(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v?.toDate === "function") {
    try {
      return v.toDate();
    } catch {
      return null;
    }
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Optional deploy cutover: sessions started before LIVE_MINUTES_CUTOVER_ISO are never live-billed. */
export function getLiveMinutesCutoverMs(): number | null {
  const raw = String(process.env.LIVE_MINUTES_CUTOVER_ISO || "").trim();
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
}

export async function billLiveStreamMinutes(params: {
  db: Firestore;
  ownerUid: string;
  roomId: string;
  guestCount?: number;
  now?: Date;
}): Promise<LiveUsageResult> {
  const { db, ownerUid, roomId } = params;
  const now = params.now ?? new Date();
  const nowMs = now.getTime();
  const guestCount = Math.max(0, Math.min(1000, Math.floor(num(params.guestCount))));

  const monthKey = getCurrentMonthKey();
  const usageDocId = `${ownerUid}_${monthKey}`;
  const userRef = db.collection("users").doc(ownerUid);
  const usageRef = db.collection("usageMonthly").doc(usageDocId);

  // Equality-only filters: served by single-field indexes, no composite index needed.
  const sessionsSnap = await db
    .collection("egressSessions")
    .where("roomId", "==", roomId)
    .where("uid", "==", ownerUid)
    .get();
  const sessionRefs = sessionsSnap.docs.map((d) => d.ref);

  const empty: LiveUsageResult = {
    minutes: 0,
    billableMs: 0,
    sessionsCounted: [],
    skipped: [],
    monthKey,
    usageDocId,
    totals: null,
  };
  if (sessionRefs.length === 0) return empty;

  return db.runTransaction(async (tx) => {
    const [userSnap, usageSnap, ...sessionSnaps] = await tx.getAll(userRef, usageRef, ...sessionRefs);
    if (!userSnap.exists) throw new LiveUsageUserNotFoundError(ownerUid);

    const plan = planLiveSessionBilling(
      sessionSnaps
        .filter((s) => s.exists)
        .map((s) => {
          const d = (s.data() || {}) as any;
          return {
            id: s.id,
            uid: d.uid,
            kind: d.kind,
            startedAt: d.startedAt,
            endedAt: d.endedAt,
            liveCountedAt: d.liveCountedAt,
            liveBilledStartMs: d.liveBilledStartMs,
            liveBilledEndMs: d.liveBilledEndMs,
          };
        }),
      { ownerUid, nowMs, cutoverMs: getLiveMinutesCutoverMs() }
    );

    if (plan.sessionsToMark.length === 0) {
      return { ...empty, skipped: plan.skipped };
    }

    // Mark sessions billed (even if the new billable time was 0 because it
    // was fully covered by an earlier billed interval).
    const sessionRefById = new Map(sessionSnaps.map((s) => [s.id, s.ref]));
    for (const s of plan.sessionsToMark) {
      const ref = sessionRefById.get(s.id);
      if (!ref) continue;
      tx.set(
        ref,
        {
          liveCountedAt: now,
          liveBilledStartMs: s.startMs,
          liveBilledEndMs: s.endMs,
          liveOpenEndedAtBilling: s.openEnded,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    const minutes = plan.minutes;
    if (minutes <= 0) {
      return { ...empty, sessionsCounted: plan.sessionsToMark, skipped: plan.skipped };
    }

    const hours = minutes / 60;

    // ---- users/{uid}.usage (legacy counters) --------------------------------
    const userData = (userSnap.data() || {}) as any;
    const legacy = (userData.usage || {}) as any;
    const resetDate = toDateOrNull(legacy.resetDate);
    const needsReset = !!resetDate && resetDate.getTime() < nowMs;

    const userUpdate: Record<string, any> = {
      "usage.hoursStreamedToday": FieldValue.increment(hours),
      "usage.ytdHours": FieldValue.increment(hours),
      "usage.guestCountToday": FieldValue.increment(guestCount),
      "usage.lastUsageUpdate": now,
    };
    let hoursStreamedThisMonth: number;
    if (needsReset) {
      // Reset decided on the transaction snapshot, so it cannot race with increments.
      const nextReset = new Date(now);
      nextReset.setMonth(nextReset.getMonth() + 1);
      userUpdate["usage.hoursStreamedThisMonth"] = hours;
      userUpdate["usage.periodStart"] = now;
      userUpdate["usage.resetDate"] = nextReset;
      hoursStreamedThisMonth = hours;
    } else {
      userUpdate["usage.hoursStreamedThisMonth"] = FieldValue.increment(hours);
      hoursStreamedThisMonth = num(legacy.hoursStreamedThisMonth) + hours;
    }
    tx.update(userRef, userUpdate);

    // ---- usageMonthly/{uid}_{month} (canonical counters) --------------------
    const existing = usageSnap.exists ? ((usageSnap.data() || {}) as any) : {};
    const prevUsage = existing.usage || {};
    const prevYtd = existing.ytd || {};
    const prevLiveCur = num(prevUsage.minutes?.live?.currentPeriod);
    const prevLiveLifetimeRaw = prevUsage.minutes?.live?.lifetime;
    const prevYtdLiveLifetimeRaw = prevYtd.minutes?.live?.lifetime;

    // Preserve the old seeding rule (usage lifetime falls back to ytd lifetime)
    // without a read-modify-write on the common path.
    const usageLiveLifetime =
      prevLiveLifetimeRaw === undefined && prevYtdLiveLifetimeRaw !== undefined
        ? num(prevYtdLiveLifetimeRaw) + minutes
        : FieldValue.increment(minutes);
    const ytdLiveLifetime =
      prevYtdLiveLifetimeRaw === undefined && prevLiveLifetimeRaw !== undefined
        ? num(prevLiveLifetimeRaw) + minutes
        : FieldValue.increment(minutes);

    const usageDoc: Record<string, any> = {
      uid: ownerUid,
      monthKey,
      usage: {
        participantMinutes: FieldValue.increment(minutes),
        minutes: {
          live: {
            currentPeriod: FieldValue.increment(minutes),
            lifetime: usageLiveLifetime,
          },
        },
      },
      ytd: {
        participantMinutes: FieldValue.increment(minutes),
        minutes: {
          live: {
            lifetime: ytdLiveLifetime,
          },
        },
      },
      lastLiveSession: {
        roomId,
        minutes,
        sessionIds: plan.sessionsToMark.map((s) => s.id),
        at: now,
        source: "server",
      },
      updatedAt: now,
    };
    if (!usageSnap.exists || !existing.createdAt) usageDoc.createdAt = now;
    // set+merge with nested objects deep-merges, and FieldValue.increment
    // works on nested fields (dotted keys are NOT interpreted by set()).
    tx.set(usageRef, usageDoc, { merge: true });

    const liveLifetimeBase =
      prevLiveLifetimeRaw !== undefined ? num(prevLiveLifetimeRaw) : num(prevYtdLiveLifetimeRaw);

    return {
      minutes,
      billableMs: plan.billableMs,
      sessionsCounted: plan.sessionsToMark,
      skipped: plan.skipped,
      monthKey,
      usageDocId,
      totals: {
        participantMinutes: num(prevUsage.participantMinutes) + minutes,
        transcodeMinutes: num(prevUsage.transcodeMinutes),
        liveCurrentPeriod: prevLiveCur + minutes,
        liveLifetime: liveLifetimeBase + minutes,
        hoursStreamedThisMonth,
        ytdHours: num(legacy.ytdHours) + hours,
      },
    };
  });
}
