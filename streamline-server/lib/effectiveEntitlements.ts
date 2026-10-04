/**
 * Back-compat entry point. The entitlement engine lives in lib/entitlements;
 * this wrapper only accepts the older `UserAccount | uid` argument.
 */
import {
  getEffectiveEntitlements as getEntitlementsForUid,
  type ResolvedEntitlements,
} from "./entitlements";
import type { UserAccount } from "./userAccount";

export type { EffectiveEntitlements, ResolvedEntitlements } from "./entitlements";

/** Effective entitlements (override > platform admin > base plan; null = unlimited). */
export async function getEffectiveEntitlements(
  accountOrUid: UserAccount | string,
  options: { fresh?: boolean } = {}
): Promise<ResolvedEntitlements> {
  const uid = typeof accountOrUid === "string" ? accountOrUid : accountOrUid?.uid;
  return getEntitlementsForUid(String(uid || ""), options);
}
