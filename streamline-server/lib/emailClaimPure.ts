/**
 * One account per email at signup (audit P2: the users-by-email query and the
 * user create were separate, so two simultaneous signups both got through).
 * Signup writes emailClaims/{emailClaimId(email)} in the same transaction as
 * the user doc; a second signup sees the claim and gets 409.
 */
import { createHash } from "crypto";

/** Doc id for a normalized email (hashed: no raw emails in doc ids). */
export function emailClaimId(emailNorm: string): string {
  return createHash("sha256").update(emailNorm.trim().toLowerCase()).digest("hex");
}

/**
 * Whether an existing claim still holds the email. A claim whose account is
 * gone or soft-deleted is released (the same rule signup already applies to
 * soft-deleted users found by email).
 */
export function emailClaimBlocks(
  claim: { uid?: unknown } | null,
  claimedUser: { accountStatus?: unknown } | null
): boolean {
  if (!claim || typeof claim.uid !== "string" || !claim.uid) return false;
  if (!claimedUser) return false;
  return claimedUser.accountStatus !== "deleted";
}
