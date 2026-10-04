/**
 * ViewerEntitlement store (Firestore: viewerEntitlements/{id}).
 * Model + id scheme: lib/viewerEntitlementsPure.ts.
 */
import { firestore as db } from "../firebaseAdmin";
import {
  isEntitlementActive,
  ppvAccountEntitlementId,
  ppvDeviceEntitlementId,
  type ViewerEntitlement,
} from "./viewerEntitlementsPure";

function col() {
  return db.collection("viewerEntitlements");
}

export interface GrantPpvInput {
  eventId: string;
  roomId: string | null;
  channelId: string | null;
  purchaseId: string | null;
  deviceKey?: string | null;
  viewerUid?: string | null;
  source: ViewerEntitlement["source"];
  expiresAt?: number | null;
}

/**
 * Grant (or re-grant) PPV access for a device and/or an account. Returns the
 * ids written. Overwrites a previously revoked doc for the same viewer (a new
 * purchase after a refund restores access).
 */
export async function grantPpvEntitlement(input: GrantPpvInput): Promise<string[]> {
  const now = Date.now();
  const base = {
    kind: "ppv" as const,
    channelId: input.channelId ?? null,
    roomId: input.roomId ?? null,
    eventId: input.eventId,
    purchaseId: input.purchaseId ?? null,
    source: input.source,
    grantedAt: now,
    expiresAt: input.expiresAt ?? null,
    revokedAt: null,
    revokeReason: null,
  };
  const writes: Array<{ id: string; doc: ViewerEntitlement }> = [];
  if (input.deviceKey) {
    const id = ppvDeviceEntitlementId(input.eventId, input.deviceKey);
    writes.push({ id, doc: { ...base, id, viewerUid: input.viewerUid ?? null, deviceId: input.deviceKey } });
  }
  if (input.viewerUid) {
    const id = ppvAccountEntitlementId(input.eventId, input.viewerUid);
    writes.push({ id, doc: { ...base, id, viewerUid: input.viewerUid, deviceId: null } });
  }
  if (writes.length === 0) return [];
  const batch = db.batch();
  for (const w of writes) batch.set(col().doc(w.id), w.doc);
  await batch.commit();
  return writes.map((w) => w.id);
}

/** Active PPV entitlement for this viewer (device and/or account), or null. */
export async function findActivePpvEntitlement(
  eventId: string,
  viewer: { deviceKey?: string | null; uid?: string | null }
): Promise<ViewerEntitlement | null> {
  const ids: string[] = [];
  if (viewer.uid) ids.push(ppvAccountEntitlementId(eventId, viewer.uid));
  if (viewer.deviceKey) ids.push(ppvDeviceEntitlementId(eventId, viewer.deviceKey));
  if (ids.length === 0) return null;
  const snaps = await db.getAll(...ids.map((id) => col().doc(id)));
  const now = Date.now();
  for (const s of snaps) {
    if (!s.exists) continue;
    const e = s.data() as ViewerEntitlement;
    if (isEntitlementActive(e, now)) return { ...e, id: s.id };
  }
  return null;
}

/** Revoke every entitlement backed by a purchase (refund / dispute). */
export async function revokeEntitlementsForPurchase(purchaseId: string, reason: string): Promise<number> {
  if (!purchaseId) return 0;
  const snap = await col().where("purchaseId", "==", purchaseId).get();
  if (snap.empty) return 0;
  const now = Date.now();
  const batch = db.batch();
  let n = 0;
  for (const d of snap.docs) {
    if ((d.data() as any)?.revokedAt) continue;
    batch.set(d.ref, { revokedAt: now, revokeReason: reason }, { merge: true });
    n += 1;
  }
  if (n > 0) await batch.commit();
  entitlementCache.clear();
  return n;
}

/**
 * Single-person tickets: when the access code moves access to a new device,
 * revoke the purchase's OTHER device-bound docs (account-bound docs stay).
 */
export async function revokeOtherDeviceEntitlements(purchaseId: string, keepId: string): Promise<number> {
  if (!purchaseId) return 0;
  const snap = await col().where("purchaseId", "==", purchaseId).get();
  const now = Date.now();
  const batch = db.batch();
  let n = 0;
  for (const d of snap.docs) {
    const e = d.data() as ViewerEntitlement;
    if (d.id === keepId || !e.deviceId || e.revokedAt) continue;
    batch.set(d.ref, { revokedAt: now, revokeReason: "moved_to_other_device" }, { merge: true });
    n += 1;
  }
  if (n > 0) await batch.commit();
  entitlementCache.clear();
  return n;
}

// Revocation re-check on playlist fetches (every few seconds per viewer):
// cache the active flag briefly so it costs ~1 read per entitlement per window.
const ENTITLEMENT_CACHE_MS = 30_000;
const entitlementCache = new Map<string, { at: number; active: boolean }>();

export async function isEntitlementStillActive(id: string): Promise<boolean> {
  const hit = entitlementCache.get(id);
  const now = Date.now();
  if (hit && now - hit.at < ENTITLEMENT_CACHE_MS) return hit.active;
  let active = false;
  try {
    const s = await col().doc(id).get();
    active = s.exists && isEntitlementActive(s.data() as ViewerEntitlement, now);
  } catch {
    // Fail open only for a transient read error on an already-issued token
    // within its lifetime; keep the previous answer when we had one.
    active = hit ? hit.active : true;
  }
  if (entitlementCache.size > 5000) entitlementCache.clear();
  entitlementCache.set(id, { at: now, active });
  return active;
}
