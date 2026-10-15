/**
 * Whether a room's owner has deleted their account (audit P2: during the
 * purge window a deleted owner's rooms and invites kept admitting guests).
 * Cached briefly per process; a failed lookup returns false so a Firestore
 * hiccup never blocks a join (the purge job removes the rooms anyway).
 */
import { firestore } from "../firebaseAdmin";
import { isDeletedAccountDoc } from "./accountStatusPure";

const TTL_MS = 60_000;
const MAX_ENTRIES = 5000;
const cache = new Map<string, { deleted: boolean; atMs: number }>();

export async function isRoomOwnerDeleted(ownerId: string | null | undefined): Promise<boolean> {
  const uid = typeof ownerId === "string" ? ownerId.trim() : "";
  if (!uid || uid.includes("/")) return false;
  const now = Date.now();
  const hit = cache.get(uid);
  if (hit && now - hit.atMs < TTL_MS) return hit.deleted;
  try {
    const snap = await firestore.collection("users").doc(uid).get();
    const deleted = snap.exists ? isDeletedAccountDoc(snap.data() as any) : false;
    if (cache.size >= MAX_ENTRIES) cache.clear();
    cache.set(uid, { deleted, atMs: now });
    return deleted;
  } catch (e: any) {
    console.warn("[roomOwnerStatus] owner lookup failed; allowing", { ownerId: uid, error: e?.message || e });
    return false;
  }
}
