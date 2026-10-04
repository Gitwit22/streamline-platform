/**
 * Account deletion service (Firestore / Firebase Auth / Stripe wiring).
 * The workflow itself is lib/accountDeletionCore.ts (pure, tested); the
 * dialog shaping is lib/deletionImpact.ts.
 *
 * Used by:
 *   DELETE /api/admin/users/:id                 (admin; options from the dialog)
 *   POST   /api/account/close { mode: "delete" } (self-service; all options on)
 *   GET    /api/admin/users/:id/deletion-impact
 *   POST   /api/admin/users/:id/restore
 */
import { FieldValue } from "firebase-admin/firestore";
import { firestore, auth as firebaseAuth } from "../firebaseAdmin";
import { stripe } from "./stripe";
import { invalidateEntitlements } from "./entitlements";
import {
  readSubscriptionId,
  runAccountDeletion,
  type DeletionActor,
  type DeletionDeps,
  type DeletionOptions,
  type DeletionResult,
  type StripeCancelResult,
} from "./accountDeletionCore";
import {
  RESTORE_CLEARED_FIELDS,
  evaluateRestore,
  shapeDeletionImpact,
  type DeletionImpact,
  type SubscriptionLookup,
} from "./deletionImpact";

export const ACCOUNT_DELETION_AUDIT = "accountDeletionAudit";

function isStripeMissing(e: any): boolean {
  return e?.code === "resource_missing" || e?.statusCode === 404 || e?.raw?.code === "resource_missing";
}

function isFirebaseUserMissing(e: any): boolean {
  return String(e?.code || "") === "auth/user-not-found";
}

/**
 * Cancel a Stripe subscription immediately. Already-canceled / unknown
 * subscriptions are reported as such (nothing left to bill); every other
 * error is a failure the caller must surface.
 */
export async function cancelStripeSubscription(subscriptionId: string): Promise<StripeCancelResult> {
  let sub: any;
  try {
    sub = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (e: any) {
    if (isStripeMissing(e)) return { status: "not_found", subscriptionId };
    return { status: "failed", subscriptionId, error: String(e?.message || e?.code || e) };
  }
  const status = String(sub?.status || "");
  if (status === "canceled" || status === "incomplete_expired") {
    return { status: "already_canceled", subscriptionId };
  }
  try {
    await stripe.subscriptions.cancel(subscriptionId);
    return { status: "canceled", subscriptionId };
  } catch (e: any) {
    if (isStripeMissing(e)) return { status: "not_found", subscriptionId };
    return { status: "failed", subscriptionId, error: String(e?.message || e?.code || e) };
  }
}

export function createAccountDeletionDeps(extraAudit?: (event: Record<string, any>) => Promise<void>): DeletionDeps {
  return {
    now: () => Date.now(),
    loadUser: async (uid) => {
      const snap = await firestore.collection("users").doc(uid).get();
      return snap.exists ? (snap.data() as any) || {} : null;
    },
    cancelSubscription: cancelStripeSubscription,
    patchUser: async (uid, patch) => {
      const p: Record<string, any> = {};
      for (const [k, v] of Object.entries(patch)) p[k] = v === null && k === "deleteAfterMs" ? FieldValue.delete() : v;
      await firestore.collection("users").doc(uid).set(p, { merge: true });
    },
    revokeAuthTokens: async (uid) => {
      try {
        await firebaseAuth.revokeRefreshTokens(uid);
      } catch (e) {
        if (!isFirebaseUserMissing(e)) throw e;
      }
    },
    disableAuthUser: async (uid) => {
      try {
        await firebaseAuth.updateUser(uid, { disabled: true });
      } catch (e) {
        if (!isFirebaseUserMissing(e)) throw e;
      }
    },
    audit: async (event) => {
      await firestore.collection(ACCOUNT_DELETION_AUDIT).add({ ...event, createdAt: new Date() });
      if (extraAudit) await extraAudit(event);
    },
  };
}

/** Run the shared deletion workflow for one account. */
export async function deleteAccount(params: {
  uid: string;
  actor: DeletionActor;
  options: DeletionOptions;
  reason: string;
  extraAudit?: (event: Record<string, any>) => Promise<void>;
}): Promise<DeletionResult> {
  const result = await runAccountDeletion(createAccountDeletionDeps(params.extraAudit), {
    uid: params.uid,
    actor: params.actor,
    options: params.options,
    reason: params.reason,
  });
  try {
    invalidateEntitlements(params.uid);
  } catch {}
  const log = result.outcome === "completed" ? console.log : console.error;
  log("[account-deletion]", {
    uid: params.uid,
    actor: params.actor,
    outcome: result.outcome,
    stripe: result.steps.stripe.status,
    sessions: result.steps.sessions.status,
    disable: result.steps.disable.status,
    cleanup: result.steps.cleanup.status,
  });
  return result;
}

async function countWhere(collection: string, field: string, uid: string): Promise<number | null> {
  try {
    const agg = await firestore.collection(collection).where(field, "==", uid).count().get();
    return agg.data().count;
  } catch (e: any) {
    console.warn("[account-deletion] impact count failed", { collection, uid, error: e?.message || e });
    return null;
  }
}

export async function loadDeletionImpact(uid: string): Promise<DeletionImpact | null> {
  const snap = await firestore.collection("users").doc(uid).get();
  if (!snap.exists) return null;
  const user = (snap.data() as any) || {};
  const subscriptionId = readSubscriptionId(user);

  let subscription: any = null;
  let lookup: SubscriptionLookup = "none";
  let lookupError: string | undefined;
  if (subscriptionId) {
    try {
      subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price.product"] } as any);
      lookup = "ok";
    } catch (e: any) {
      if (isStripeMissing(e)) {
        lookup = "not_found";
      } else {
        lookup = "error";
        lookupError = String(e?.message || e?.code || e);
      }
    }
  }

  const [rooms, recordings] = await Promise.all([countWhere("rooms", "ownerId", uid), countWhere("recordings", "userId", uid)]);
  const storageBytes = Number(user?.usage?.storageUsedBytes) || 0;

  return shapeDeletionImpact({
    uid,
    user,
    subscription,
    subscriptionLookup: lookup,
    subscriptionLookupError: lookupError,
    rooms,
    recordings,
    storageBytes,
  });
}

/**
 * Undo a soft delete inside the purge window: clears the deletion fields and
 * re-enables the Firebase user. Does NOT restore a canceled Stripe
 * subscription (the user must subscribe again).
 */
export async function restoreAccount(
  uid: string,
  actorUid: string
): Promise<{
  ok: boolean;
  firebaseReenabled?: boolean;
  stripeWasCanceled?: boolean;
  status?: number;
  error?: string;
  details?: string;
}> {
  const ref = firestore.collection("users").doc(uid);
  const snap = await ref.get();
  const user = snap.exists ? (snap.data() as any) || {} : null;
  const nowMs = Date.now();
  const check = evaluateRestore(user, nowMs);
  if (!check.ok) return check;

  const patch: Record<string, any> = {
    restoredAtMs: nowMs,
    restoredBy: actorUid,
    updatedAt: nowMs,
  };
  for (const f of RESTORE_CLEARED_FIELDS) patch[f] = FieldValue.delete();
  await ref.set(patch, { merge: true });

  let firebaseReenabled = true;
  try {
    await firebaseAuth.updateUser(uid, { disabled: false });
  } catch (e: any) {
    firebaseReenabled = isFirebaseUserMissing(e);
    if (!firebaseReenabled) console.warn("[account-deletion] restore: Firebase re-enable failed", { uid, error: e?.code || e?.message || e });
  }
  try {
    invalidateEntitlements(uid);
  } catch {}
  const stripeStatus = String(user?.deletion?.stripe?.status || "");
  await firestore
    .collection(ACCOUNT_DELETION_AUDIT)
    .add({ uid, action: "restore", actor: { type: "admin", uid: actorUid }, atMs: nowMs, firebaseReenabled, createdAt: new Date() })
    .catch(() => {});
  return { ok: true, firebaseReenabled, stripeWasCanceled: stripeStatus === "canceled" };
}
