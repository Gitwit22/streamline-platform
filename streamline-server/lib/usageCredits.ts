/**
 * Usage credits (one-time bonus streaming minutes): Firestore I/O.
 * Rules live in lib/usageCreditsPure.ts.
 *
 *   users/{uid}/usageCredits/{id}   UsageCredit
 *   users/{uid}.bonusMinutes        LEGACY (monthly top-up). Migrated once to a
 *                                   one_time credit (id legacy_bonus_minutes),
 *                                   then set to 0 with bonusMinutesMigratedAt.
 *
 * Consumption happens in the streaming meter's bill transaction
 * (lib/streamingMeter.ts), never here.
 */
import { firestore } from "../firebaseAdmin";
import {
  LEGACY_BONUS_CREDIT_ID,
  activeCreditRemaining,
  creditAllowanceMinutes,
  creditToDoc,
  planLegacyBonusMigration,
  isCreditActive,
  needsLegacyBonusMigration,
  normalizeCredit,
  readCreditMinutesConsumed,
  serializeCredit,
  withPendingLegacyCredit,
  type UsageCredit,
} from "./usageCreditsPure";

export const USAGE_CREDITS = "usageCredits";

export function creditsCollection(uid: string) {
  return firestore.collection("users").doc(uid).collection(USAGE_CREDITS);
}

export { creditToDoc };

/**
 * Inside an existing transaction: create the legacy credit and zero
 * users.bonusMinutes. Caller must already have read `userDoc` and
 * `legacySnap` in `tx` (reads before writes). Idempotent: the credit id is
 * deterministic and bonusMinutesMigratedAt is written atomically with it
 * (rules: planLegacyBonusMigration in usageCreditsPure.ts).
 */
export function applyLegacyBonusMigrationInTx(
  tx: FirebaseFirestore.Transaction,
  params: {
    userRef: FirebaseFirestore.DocumentReference;
    userDoc: any;
    legacyRef: FirebaseFirestore.DocumentReference;
    legacyExists: boolean;
    nowMs: number;
  }
): UsageCredit | null {
  const plan = planLegacyBonusMigration(params.userDoc, params.legacyExists, params.nowMs);
  if (plan.creditDoc) tx.set(params.legacyRef, plan.creditDoc);
  if (plan.userPatch) tx.set(params.userRef, plan.userPatch, { merge: true });
  return plan.creditDoc ? plan.credit : null;
}

/** Migrate users.bonusMinutes -> one_time credit when needed (own transaction). */
export async function migrateLegacyBonusMinutes(uid: string, nowMs: number = Date.now()): Promise<{ migrated: boolean; minutes: number }> {
  const userRef = firestore.collection("users").doc(uid);
  const legacyRef = creditsCollection(uid).doc(LEGACY_BONUS_CREDIT_ID);
  return firestore.runTransaction(async (tx) => {
    const [userSnap, legacySnap] = await tx.getAll(userRef, legacyRef);
    if (!userSnap.exists) return { migrated: false, minutes: 0 };
    const userDoc = userSnap.data() || {};
    if (!needsLegacyBonusMigration(userDoc)) return { migrated: false, minutes: 0 };
    const created = applyLegacyBonusMigrationInTx(tx, { userRef, userDoc, legacyRef, legacyExists: legacySnap.exists, nowMs });
    if (created) {
      console.log("[usage-credits] migrated legacy bonusMinutes", { uid, minutes: created.amount });
    }
    return { migrated: true, minutes: created?.amount ?? 0 };
  });
}

/** Credits with remaining > 0 (active-or-expired; filter with isCreditActive). */
export async function loadCreditsWithRemaining(uid: string): Promise<UsageCredit[]> {
  const snap = await creditsCollection(uid).where("remaining", ">", 0).get();
  return snap.docs.map((d) => normalizeCredit(d.id, d.data()));
}

/** Every credit (newest first) for admin listing. */
export async function loadAllCredits(uid: string, limit = 200): Promise<UsageCredit[]> {
  const snap = await creditsCollection(uid).limit(Math.max(1, Math.min(500, limit))).get();
  return snap.docs.map((d) => normalizeCredit(d.id, d.data())).sort((a, b) => b.createdAt - a.createdAt);
}

export type CreditSummary = {
  /** Remaining minutes across active credits (carries over month to month). */
  remainingMinutes: number;
  /** Minutes of this month's usage paid by credits. */
  consumedThisMonth: number;
  /** Credit minutes counted in this month's allowance (consumed + remaining). */
  allowanceMinutes: number;
  activeCount: number;
  /** Legacy users.bonusMinutes not migrated yet (counted as a credit). */
  pendingLegacyMinutes: number;
};

export function summarizeCredits(params: {
  credits: UsageCredit[];
  userDoc: any;
  usageDoc: any;
  usedMinutes: number;
  includedMinutes: number | null;
  nowMs: number;
}): CreditSummary {
  const credits = withPendingLegacyCredit(params.credits, params.userDoc, params.nowMs);
  const consumedThisMonth = readCreditMinutesConsumed(params.usageDoc);
  const remainingMinutes = activeCreditRemaining(credits, params.nowMs);
  return {
    remainingMinutes,
    consumedThisMonth,
    allowanceMinutes: creditAllowanceMinutes({
      usedMinutes: params.usedMinutes,
      includedMinutes: params.includedMinutes,
      consumedThisMonth,
      credits,
      nowMs: params.nowMs,
    }),
    activeCount: credits.filter((c) => isCreditActive(c, params.nowMs)).length,
    pendingLegacyMinutes: needsLegacyBonusMigration(params.userDoc) ? Math.floor(Number(params.userDoc.bonusMinutes) || 0) : 0,
  };
}

export async function grantCredit(
  uid: string,
  input: { amount: number; reason: string; expiresAt: number | null; source: string },
  actorUid: string,
  nowMs: number = Date.now()
): Promise<UsageCredit> {
  const ref = creditsCollection(uid).doc();
  const credit: UsageCredit = {
    id: ref.id,
    amount: input.amount,
    remaining: input.amount,
    type: "one_time",
    recurrence: null,
    expiresAt: input.expiresAt,
    source: input.source,
    reason: input.reason,
    createdBy: actorUid,
    createdAt: nowMs,
    consumedMinutes: 0,
    lastConsumedAt: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  };
  await ref.set(creditToDoc(credit));
  return credit;
}

/** Set remaining to 0 and mark revoked. Returns the credit before revocation (null when missing). */
export async function revokeCredit(
  uid: string,
  creditId: string,
  actorUid: string,
  reason: string,
  nowMs: number = Date.now()
): Promise<{ before: UsageCredit; after: UsageCredit } | null> {
  const ref = creditsCollection(uid).doc(creditId);
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const before = normalizeCredit(snap.id, snap.data());
    const after: UsageCredit = {
      ...before,
      remaining: 0,
      revokedAt: before.revokedAt ?? nowMs,
      revokedBy: before.revokedAt ? before.revokedBy ?? null : actorUid,
      revokeReason: before.revokedAt ? before.revokeReason ?? null : reason || null,
    };
    tx.set(
      ref,
      { remaining: 0, revokedAt: after.revokedAt, revokedBy: after.revokedBy, revokeReason: after.revokeReason, revokedRemaining: before.remaining },
      { merge: true }
    );
    return { before, after };
  });
}

export { serializeCredit };
