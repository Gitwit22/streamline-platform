/**
 * ViewerEntitlement model — pure parts (ids, device keys, liveness).
 *
 * viewerEntitlements/{id} {
 *   channelId|null, roomId|null, eventId|null,
 *   kind: "ppv" | "registered" | "subscriber" | "comp",
 *   viewerUid?, deviceId? (SHA-256 of the sl_device_id cookie, never the raw
 *   cookie), purchaseId?, grantedAt, expiresAt?, revokedAt?, revokeReason?
 * }
 *
 * Doc ids are deterministic so the playback check is two direct reads:
 *   ppv_<eventId>__dev_<deviceKey>   (device-bound)
 *   ppv_<eventId>__uid_<uid>         (account-bound, buyer signed in)
 * A purchase can back several docs (buyer device, buyer account, devices
 * that redeemed the access code); refunds revoke all docs with that purchaseId.
 */
import crypto from "crypto";

export type ViewerEntitlementKind = "ppv" | "registered" | "subscriber" | "comp";

export interface ViewerEntitlement {
  id: string;
  kind: ViewerEntitlementKind;
  channelId: string | null;
  roomId: string | null;
  eventId: string | null;
  viewerUid: string | null;
  deviceId: string | null;
  purchaseId: string | null;
  source: "checkout" | "access_code" | "legacy_code" | "comp";
  grantedAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  revokeReason?: string | null;
}

/** Stable, non-reversible key for a device cookie value. */
export function deviceKeyFor(rawDeviceId: string): string {
  return crypto.createHash("sha256").update(`sl-device:${String(rawDeviceId || "")}`).digest("hex").slice(0, 40);
}

function safeIdPart(s: string): string {
  return String(s || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
}

export function ppvDeviceEntitlementId(eventId: string, deviceKey: string): string {
  return `ppv_${safeIdPart(eventId)}__dev_${safeIdPart(deviceKey)}`;
}

export function ppvAccountEntitlementId(eventId: string, uid: string): string {
  return `ppv_${safeIdPart(eventId)}__uid_${safeIdPart(uid)}`;
}

export function isEntitlementActive(e: Partial<ViewerEntitlement> | null | undefined, nowMs: number = Date.now()): boolean {
  if (!e) return false;
  if (e.revokedAt) return false;
  if (typeof e.expiresAt === "number" && e.expiresAt > 0 && nowMs >= e.expiresAt) return false;
  return true;
}

/** Checkout return target: only same-app viewer pages /live|/ig|/ppv/<id>. */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const p = raw.trim();
  if (!/^\/(live|ig|ppv)\/[A-Za-z0-9_-]{1,128}$/.test(p)) return null;
  return p;
}

/** Valid sl_device_id cookie values (UUIDs minted by the server). */
export function isValidDeviceId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9-]{16,64}$/.test(v);
}
