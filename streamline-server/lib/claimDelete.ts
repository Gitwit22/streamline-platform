/**
 * Delete a document only once, atomically, and hand its data to the caller
 * that actually deleted it. Quota is released by that caller only, so two
 * concurrent DELETE requests can't both release the same bytes (audit: a
 * repeated double release let users exceed their storage limit).
 */
import { firestore as db } from "../firebaseAdmin";

export type ClaimDeleteResult =
  | { status: "deleted"; data: any }
  | { status: "not_found" }
  | { status: "forbidden" };

type TxRunner = <T>(fn: (tx: FirebaseFirestore.Transaction) => Promise<T>) => Promise<T>;

export async function claimAndDeleteDoc(
  ref: FirebaseFirestore.DocumentReference,
  isOwner: (data: any) => boolean,
  runTransaction: TxRunner = (fn) => db.runTransaction(fn)
): Promise<ClaimDeleteResult> {
  return runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { status: "not_found" } as const;
    const data = snap.data() || {};
    if (!isOwner(data)) return { status: "forbidden" } as const;
    tx.delete(ref);
    return { status: "deleted", data } as const;
  });
}
