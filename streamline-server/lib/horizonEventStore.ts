/**
 * Capped `horizon_events` writer for inbound Horizon bot events
 * (routes/horizon/botApi.ts). Rules live in lib/horizonEventStorePure.ts.
 */
import { firestore } from "../firebaseAdmin";
import {
  HORIZON_EVENTS_CAP,
  HORIZON_EVENTS_COLLECTION,
  buildHorizonEventDoc,
  horizonEventsToPrune,
} from "./horizonEventStorePure";

let writesSincePrune = 0;
const PRUNE_EVERY = 25;

export async function persistHorizonEvent(type: string, eventId: string, data: any): Promise<string | null> {
  try {
    const ref = await firestore.collection(HORIZON_EVENTS_COLLECTION).add(buildHorizonEventDoc(type, eventId, data, Date.now()));
    writesSincePrune += 1;
    if (writesSincePrune >= PRUNE_EVERY) {
      writesSincePrune = 0;
      void pruneHorizonEvents().catch((e) => console.warn("[horizon_events] prune failed:", e?.message || e));
    }
    return ref.id;
  } catch (err: any) {
    console.warn("[horizon_events] persist failed:", err?.message || err);
    return null;
  }
}

export async function pruneHorizonEvents(cap: number = HORIZON_EVENTS_CAP): Promise<number> {
  const col = firestore.collection(HORIZON_EVENTS_COLLECTION);
  const total = Number((await col.count().get()).data().count) || 0;
  const excess = Math.min(horizonEventsToPrune(total, cap), 400);
  if (excess <= 0) return 0;
  const oldest = await col.orderBy("createdAt", "asc").limit(excess).get();
  const batch = firestore.batch();
  oldest.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return oldest.size;
}
