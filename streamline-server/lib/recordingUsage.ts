/**
 * Recording usage (minutes) + storage release, billed to the ROOM OWNER.
 *
 * Recording minutes are tracked separately from streaming minutes: they are
 * shown to the user but are NOT part of the monthly streaming gate (recordings
 * are gated by storage instead).
 *
 * Billing uid: recordings store `ownerUid` / `billingUid` (room owner) at
 * start; `userId` stays the actor for ownership/UI compatibility. Older docs
 * without ownerUid fall back to userId.
 */
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../firebaseAdmin";
import { monthKeyUTC, recordingBilledMinutes, toEpochMs } from "./streamingMeterPure";

export function recordingBillingUid(data: any, fallback?: string | null): string | null {
  const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return pick(data?.billingUid) || pick(data?.ownerUid) || pick(data?.userId) || pick(fallback) || null;
}

/**
 * Count recording minutes once (usageCounted flip inside the transaction) and
 * apply `patch(recData)` to the recording doc in the same transaction.
 * The billed interval is [startedAt, endedAt] where endedAt is, in order:
 * the explicit `endedAt` (stop time / egress end), the doc's stoppedAt, now.
 */
export async function countRecordingMinutes(
  recordingRef: FirebaseFirestore.DocumentReference,
  opts: {
    endedAt?: Date | null;
    now?: Date;
    patch?: (recData: any, billed: { minutes: number; durationMs: number; endedAt: Date }) => Record<string, any>;
  } = {}
): Promise<{ counted: boolean; billedMinutes: number; billingUid: string | null }> {
  const now = opts.now ?? new Date();
  const monthKey = monthKeyUTC(now);

  return firestore.runTransaction(async (tx) => {
    const recSnap = await tx.get(recordingRef);
    if (!recSnap.exists) return { counted: false, billedMinutes: 0, billingUid: null };
    const rec = (recSnap.data() || {}) as any;
    const billingUid = recordingBillingUid(rec);

    const explicitEnd = opts.endedAt ? toEpochMs(opts.endedAt) : null;
    const endMs = Math.min(explicitEnd ?? toEpochMs(rec.stoppedAt) ?? now.getTime(), now.getTime());
    const endedAt = new Date(endMs);
    const billed = recordingBilledMinutes(rec.startedAt, endedAt);
    const extra = opts.patch ? opts.patch(rec, { ...billed, endedAt }) : {};

    if (rec.usageCounted === true || !billingUid) {
      if (Object.keys(extra).length) tx.update(recordingRef, extra);
      return { counted: false, billedMinutes: 0, billingUid };
    }

    const usageRef = firestore.collection("usageMonthly").doc(`${billingUid}_${monthKey}`);
    const userRef = firestore.collection("users").doc(billingUid);
    const [usageSnap, userSnap] = await tx.getAll(usageRef, userRef);

    const usageType = typeof rec.usageType === "string" && rec.usageType ? rec.usageType : "recording_only";
    const m = billed.minutes;

    tx.update(recordingRef, {
      usageCounted: true,
      usageCountedAt: now,
      billingUid,
      billedMinutes: m,
      durationMs: rec.durationMs ?? billed.durationMs,
      updatedAt: now,
      ...extra,
    });

    if (m > 0) {
      const usageWrite: Record<string, any> = {
        uid: billingUid,
        monthKey,
        usage: {
          recordingMinutes: FieldValue.increment(m),
          minutes: {
            recording: { currentPeriod: FieldValue.increment(m) },
            byUsageType: { [usageType]: { currentPeriod: FieldValue.increment(m) } },
          },
        },
        updatedAt: now,
      };
      if (!usageSnap.exists || !(usageSnap.data() as any)?.createdAt) usageWrite.createdAt = now;
      tx.set(usageRef, usageWrite, { merge: true });
      if (userSnap.exists) {
        tx.set(userRef, { usage: { lifetime: { recordingMinutes: FieldValue.increment(m) } } }, { merge: true });
      }
    }
    return { counted: true, billedMinutes: m, billingUid };
  });
}

/**
 * Release a recording's counted storage exactly once. In ONE transaction:
 * only when the bytes were counted (storageCounted === true, or a legacy doc
 * that predates the flag) and not yet released; decrements the billing uid's
 * counter (floored at 0) and flips storageReleased.
 */
export async function releaseRecordingStorageOnce(
  recordingRef: FirebaseFirestore.DocumentReference,
  context: Record<string, any> = {}
): Promise<{ released: boolean; bytes: number; billingUid: string | null }> {
  return firestore.runTransaction(async (tx) => {
    const recSnap = await tx.get(recordingRef);
    if (!recSnap.exists) return { released: false, bytes: 0, billingUid: null };
    const rec = (recSnap.data() || {}) as any;
    const bytes = typeof rec.fileSize === "number" && rec.fileSize > 0 ? rec.fileSize : 0;
    const billingUid = recordingBillingUid(rec);
    const counted = rec.storageCounted === true || (rec.storageCounted === undefined && bytes > 0);
    if (!counted || rec.storageReleased === true || !billingUid || bytes <= 0) {
      return { released: false, bytes: 0, billingUid };
    }
    const userRef = firestore.collection("users").doc(billingUid);
    const userSnap = await tx.get(userRef);
    tx.set(recordingRef, { storageReleased: true, storageReleasedAt: new Date() }, { merge: true });
    if (userSnap.exists) {
      const raw = Number((userSnap.data() as any)?.usage?.storageUsedBytes);
      const current = Number.isFinite(raw) ? raw : 0;
      tx.set(
        userRef,
        { usage: { storageUsedBytes: Math.max(0, current - bytes), lastStorageUpdate: new Date() } },
        { merge: true }
      );
    }
    console.log(`[storage] released ${bytes} bytes for user ${billingUid}`, { recordingId: recordingRef.id, ...context });
    return { released: true, bytes, billingUid };
  });
}
