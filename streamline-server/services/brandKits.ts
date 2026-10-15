/**
 * Brand kit storage (Firestore). Rules live in lib/brandKitsPure.ts.
 *
 *   brandKits/{kitId}            { ownerId, name, title, subtitle, logoUrl, offlineMessage, theme, createdAt, updatedAt }
 *   users/{uid}.brandKitDefaultId  default kit for new rooms (absent/null = none)
 *   rooms/{roomId}.brandKitId      kit this room uses (absent/null = legacy hlsConfig branding)
 */
import { firestore as db } from "../firebaseAdmin";
import { kitBrandingForRoom, roomBrandKitId, type PublicKitBranding } from "../lib/brandKitsPure";

export const BRAND_KITS_COLLECTION = "brandKits";

export function brandKitsCol() {
  return db.collection(BRAND_KITS_COLLECTION);
}

/** The kit document, or null when missing. */
export async function getBrandKit(kitId: string): Promise<any | null> {
  const snap = await brandKitsCol().doc(kitId).get();
  return snap.exists ? snap.data() || null : null;
}

/** The kit only when it exists and belongs to ownerUid. */
export async function getOwnedBrandKit(kitId: string, ownerUid: string): Promise<any | null> {
  const kit = await getBrandKit(kitId);
  if (!kit || String(kit.ownerId || "") !== ownerUid) return null;
  return kit;
}

export async function getDefaultBrandKitId(ownerUid: string): Promise<string | null> {
  const snap = await db.collection("users").doc(ownerUid).get();
  const v = snap.exists ? (snap.data() as any)?.brandKitDefaultId : null;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Public branding from the room's kit, or null (no kit, deleted kit, other
 * owner's kit, or lookup failure). Never throws: viewers fall back to the
 * legacy hlsConfig branding.
 */
export async function getRoomKitBranding(room: any): Promise<PublicKitBranding | null> {
  const kitId = roomBrandKitId(room);
  if (!kitId) return null;
  try {
    return kitBrandingForRoom(await getBrandKit(kitId), room);
  } catch (e: any) {
    console.warn("[brandKits] kit lookup failed", { kitId, error: e?.message || e });
    return null;
  }
}
