import { firestore as db } from "../firebaseAdmin";
import type { CreatorContact } from "../events/emitters/commerceEmitter";

/** Creator email/name for commerce notifications (best effort; never throws). */
export async function getCreatorContact(uid: string): Promise<CreatorContact> {
  try {
    if (!uid) return { uid, email: null, name: null };
    const snap = await db.collection("users").doc(uid).get();
    const u = (snap.data() || {}) as any;
    return {
      uid,
      email: typeof u.email === "string" && u.email.includes("@") ? u.email : null,
      name: typeof u.displayName === "string" && u.displayName.trim() ? u.displayName.trim() : null,
    };
  } catch {
    return { uid, email: null, name: null };
  }
}
