/**
 * Who may use POST /api/billing/test/change-plan (switch plans without
 * Stripe). Platform admins only, and only while billing is off for them —
 * a self-service plan grant used to be open to every user (audit P2).
 */
export function testPlanChangeRefusal(opts: {
  isPlatformAdmin: boolean;
  effectiveBillingEnabled: boolean | null | undefined;
}): { status: 403; error: "insufficient_permissions" | "billing_live" } | null {
  if (!opts.isPlatformAdmin) return { status: 403, error: "insufficient_permissions" };
  if (opts.effectiveBillingEnabled !== false) return { status: 403, error: "billing_live" };
  return null;
}
