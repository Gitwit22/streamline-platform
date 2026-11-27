import admin from "firebase-admin";
import { firestore } from "../firebaseAdmin";
import {
  admissionState,
  visibleWaitingEntries,
  waitingEntryId,
  type VisibleWaitingEntry,
  type WaitingEntry,
} from "./waitingRoomPure";

/**
 * Firestore side of the waiting room (rules in lib/waitingRoomPure.ts).
 * Entries: rooms/{roomId}/waitingRoom/{waitingEntryId(identity)}. They are
 * written only by the join gate (create, or refresh lastSeen/displayName on a
 * waiting entry) and by host actions, so a guest can never admit themselves.
 * Deleted with the room (recursive room delete in account purge).
 */

function entriesCol(roomId: string) {
  return firestore.collection("rooms").doc(roomId).collection("waitingRoom");
}

export type GateResult = "admitted" | "denied" | "waiting";

/**
 * The join gate for one identity: admitted/denied per the host's decision,
 * else (re)queued as waiting. Transactional so a poll never overwrites a
 * decision the host made at the same moment.
 */
export async function waitingRoomGate(params: {
  roomId: string;
  identity: string;
  displayName: string;
  uid?: string | null;
}): Promise<GateResult> {
  const ref = entriesCol(params.roomId).doc(waitingEntryId(params.identity));
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const state = admissionState(snap.exists ? (snap.data() as WaitingEntry) : null, now);
    if (state === "admitted" || state === "denied") return state;
    if (state === "waiting") {
      tx.set(ref, { lastSeenAtMs: now, displayName: params.displayName }, { merge: true });
      return "waiting";
    }
    // New, or a decision that has expired: queue (again).
    tx.set(ref, {
      identity: params.identity,
      displayName: params.displayName,
      uid: params.uid || null,
      status: "waiting",
      requestedAtMs: now,
      lastSeenAtMs: now,
      decidedAtMs: null,
      decidedBy: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return "waiting";
  });
}

/** Records identities as admitted (host put them on stage, or they were already in the room). */
export async function markAdmitted(roomId: string, identities: string[], decidedBy: string): Promise<void> {
  const unique = Array.from(new Set(identities.map((i) => String(i || "").trim()).filter(Boolean)));
  const now = Date.now();
  // Firestore batches hold at most 500 writes.
  for (let i = 0; i < unique.length; i += 450) {
    const batch = firestore.batch();
    for (const identity of unique.slice(i, i + 450)) {
      batch.set(
        entriesCol(roomId).doc(waitingEntryId(identity)),
        {
          identity,
          status: "admitted",
          decidedAtMs: now,
          decidedBy,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }
}

/** Forgets an identity's admission (host removed them): they wait again next time. */
export async function clearWaitingEntry(roomId: string, identity: string): Promise<void> {
  await entriesCol(roomId).doc(waitingEntryId(identity)).delete();
}

/** Empties the waiting room (the session ended): next session everyone waits again. */
export async function clearWaitingRoom(roomId: string): Promise<void> {
  // Bounded loop: a room never holds anywhere near this many entries.
  for (let round = 0; round < 20; round++) {
    const snap = await entriesCol(roomId).limit(450).get();
    if (snap.empty) return;
    const batch = firestore.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < 450) return;
  }
}

/** People currently waiting, oldest first. */
export async function listWaiting(roomId: string): Promise<VisibleWaitingEntry[]> {
  const snap = await entriesCol(roomId).where("status", "==", "waiting").limit(300).get();
  const entries = snap.docs.map((d) => ({ id: d.id, ...(d.data() as WaitingEntry) }));
  return visibleWaitingEntries(entries, Date.now());
}

/**
 * Admit or deny one waiting entry. Returns false when there is no such entry.
 * Admit/deny can be changed later (the host changing their mind).
 */
export async function decideWaitingEntry(
  roomId: string,
  entryId: string,
  decision: "admitted" | "denied",
  decidedBy: string,
): Promise<boolean> {
  const ref = entriesCol(roomId).doc(entryId);
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    tx.set(
      ref,
      {
        status: decision,
        decidedAtMs: Date.now(),
        decidedBy,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  });
}

/** Admits everyone currently waiting; returns how many. */
export async function admitAllWaiting(roomId: string, decidedBy: string): Promise<number> {
  const waiting = await listWaiting(roomId);
  if (waiting.length === 0) return 0;
  const now = Date.now();
  const batch = firestore.batch();
  for (const e of waiting) {
    batch.set(
      entriesCol(roomId).doc(e.id),
      { status: "admitted", decidedAtMs: now, decidedBy, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  await batch.commit();
  return waiting.length;
}
