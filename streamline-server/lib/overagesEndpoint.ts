import type Stripe from "stripe";
import { PERMISSION_ERRORS } from "./permissionErrors";

export type OveragesEndpointDeps = {
  getAccount: (uid: string) => Promise<any>;
  getUserDoc: (uid: string) => Promise<any | null>;
  patchUserDoc: (uid: string, patch: any) => Promise<void>;
  retrieveStripeCustomer: (customerId: string) => Promise<Stripe.Customer | Stripe.DeletedCustomer | any>;
  now: () => number;
};

function isOveragesAllowedForAccount(account: any): boolean {
  const planId = String(account?.effectiveEntitlements?.planId || account?.planId || "").trim();
  if (planId === "pro") return true;

  // Optional capability flag (if present).
  const featureFlag =
    account?.effectiveEntitlements?.features?.overagesAllowed === true ||
    account?.effectiveEntitlements?.features?.allowsOverages === true;

  return featureFlag === true;
}

function readOveragesEnabledFromUserDoc(userDoc: any): boolean {
  const v =
    userDoc?.billingSettings?.overagesEnabled ??
    userDoc?.billing?.overagesEnabled ??
    userDoc?.overagesEnabled;
  return v === true;
}

function extractStripeCustomerIdFromUserDoc(userDoc: any): string | null {
  const billingTruthId = userDoc?.billingTruth?.stripeCustomerId;
  if (typeof billingTruthId === "string" && billingTruthId.trim()) return billingTruthId;

  const direct = userDoc?.stripeCustomerId;
  if (typeof direct === "string" && direct.trim()) return direct;

  const legacy = userDoc?.billing?.customerId;
  if (typeof legacy === "string" && legacy.trim()) return legacy;

  return null;
}

function customerHasDefaultPaymentMethod(customer: any): boolean {
  if (!customer || customer.deleted) return false;

  const defaultPm = customer?.invoice_settings?.default_payment_method;
  if (typeof defaultPm === "string" && defaultPm.trim()) return true;

  // Legacy fallback (sources)
  const defaultSource = customer?.default_source;
  if (typeof defaultSource === "string" && defaultSource.trim()) return true;

  return false;
}

export function createOveragesEndpointHandler(deps: OveragesEndpointDeps) {
  return async function overagesEndpointHandler(req: any, res: any) {
    try {
      const uid = (req as any).user?.uid;
      if (!uid) {
        return res.status(401).json({ success: false, error: PERMISSION_ERRORS.UNAUTHORIZED });
      }

      const { enabled } = (req.body || {}) as { enabled?: unknown };
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ success: false, error: "invalid_body" });
      }

      const account = (req as any).account || (await deps.getAccount(uid));
      if (!isOveragesAllowedForAccount(account)) {
        return res.status(403).json({ success: false, error: "overages_not_allowed" });
      }

      const userDoc = await deps.getUserDoc(uid);
      if (!userDoc) {
        return res.status(404).json({ success: false, error: "user_not_found" });
      }

      const now = deps.now();
      const stripeCustomerId = extractStripeCustomerIdFromUserDoc(userDoc);

      if (enabled) {
        if (!stripeCustomerId) {
          return res.status(409).json({ success: false, error: "payment_method_required" });
        }

        const customer = await deps.retrieveStripeCustomer(stripeCustomerId);
        if (!customerHasDefaultPaymentMethod(customer)) {
          return res.status(409).json({ success: false, error: "payment_method_required" });
        }
      }

      const current = readOveragesEnabledFromUserDoc(userDoc);
      if (current !== enabled) {
        const patch: any = {
          updatedAt: now,
          billingSettings: { overagesEnabled: enabled },

          // Backwards-compat: older enforcement code reads these.
          billing: { overagesEnabled: enabled },
          overagesEnabled: enabled,
        };

        await deps.patchUserDoc(uid, patch);
      }

      const status = String(userDoc?.billingTruth?.status || "free");

      return res.json({
        success: true,
        billingSettings: { overagesEnabled: enabled },
        billingTruth: {
          status,
          stripeConnected: !!stripeCustomerId,
        },
      });
    } catch (err: any) {
      console.error("POST /api/billing/overages failed:", err?.message || err);
      return res.status(500).json({ success: false, error: "internal_error" });
    }
  };
}
