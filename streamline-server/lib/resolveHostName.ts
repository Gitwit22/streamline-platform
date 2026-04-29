import { firestore } from "../firebaseAdmin";

/**
 * Resolve a human-readable host name from a user UID.
 * Returns the user's displayName or "Host" as a fallback.
 */
export async function resolveHostName(ownerId: string): Promise<string> {
  if (!ownerId) return "Host";
  try {
    const snap = await firestore.doc(`users/${ownerId}`).get();
    const name = snap.data()?.displayName;
    return typeof name === "string" && name.trim() ? name.trim() : "Host";
  } catch {
    return "Host";
  }
}
