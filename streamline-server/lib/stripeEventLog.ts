/**
 * Stripe webhook event de-duplication.
 *
 * stripeEvents/{event.id} is created with create() before processing:
 *   - created            → process the event, then mark status "done"
 *   - exists, "done"     → duplicate delivery, skip (return 200)
 *   - exists, processing → another delivery is in flight; skip unless the
 *                          marker is stale (worker crashed mid-processing)
 * If processing throws, the marker is deleted so Stripe's retry is processed.
 */

import { firestore as db } from "../firebaseAdmin";
import { canReclaimStripeEvent, isAlreadyExists } from "./stripeEventPolicy";

const COLLECTION = "stripeEvents";

/** Returns true when this delivery should process the event. */
export async function claimStripeEvent(eventId: string, eventType: string): Promise<boolean> {
  const ref = db.collection(COLLECTION).doc(eventId);
  const now = Date.now();
  const marker = { eventId, type: eventType, status: "processing", startedAt: now, createdAt: now };
  try {
    await ref.create(marker);
    return true;
  } catch (err: any) {
    if (!isAlreadyExists(err)) throw err;
  }
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as any) : null;
    if (!canReclaimStripeEvent(existing, Date.now())) return false;
    tx.set(ref, { ...marker, startedAt: Date.now(), createdAt: existing?.createdAt ?? now });
    return true;
  });
}

export async function markStripeEventDone(eventId: string): Promise<void> {
  await db
    .collection(COLLECTION)
    .doc(eventId)
    .set({ status: "done", completedAt: Date.now() }, { merge: true });
}

/** Remove the marker after a processing failure so Stripe's retry is handled. */
export async function releaseStripeEvent(eventId: string): Promise<void> {
  await db.collection(COLLECTION).doc(eventId).delete();
}
