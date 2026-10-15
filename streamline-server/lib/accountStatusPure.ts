/** True for a soft-deleted account (same rule requireAuth applies to the user themself). */
export function isDeletedAccountDoc(user: { accountStatus?: unknown; deletedAtMs?: unknown } | null | undefined): boolean {
  if (!user) return false;
  if (String(user.accountStatus || "").toLowerCase() === "deleted") return true;
  return typeof user.deletedAtMs === "number" && user.deletedAtMs > 0;
}
