import { firestore } from "../firebaseAdmin";
import { CanonicalPlan, normalizePlan } from "./normalizePlan";
import { getUserAccount, UserAccount } from "./userAccount";

export type EffectiveEntitlements = {
  planId: string;
  limits: CanonicalPlan["limits"];
  features: CanonicalPlan["features"];
  caps: CanonicalPlan["caps"];
};

function resolveEffectivePlanId(account: UserAccount): string {
  const raw = account.rawUser || {};
  const override = typeof raw.adminOverridePlanId === "string" ? raw.adminOverridePlanId.trim() : "";
  if (override) {
    return override;
  }
  return account.planId;
}

async function loadPlan(planId: string): Promise<CanonicalPlan> {
  const snap = await firestore.collection("plans").doc(planId).get();
  const data = snap.exists ? snap.data() || {} : {};
  return normalizePlan(planId, data);
}

/**
 * Compute the effective entitlements for a user.
 * - Respects adminOverridePlanId when present on the user doc.
 * - Falls back to the normalized account.planId otherwise.
 * - Always returns canonical limits/features from normalizePlan.
 */
export async function getEffectiveEntitlements(accountOrUid: UserAccount | string): Promise<EffectiveEntitlements & { plan: CanonicalPlan }> {
  const account = typeof accountOrUid === "string" ? await getUserAccount(accountOrUid) : accountOrUid;
  const effectivePlanId = resolveEffectivePlanId(account);
  const plan = await loadPlan(effectivePlanId);

  return {
    planId: plan.id,
    limits: plan.limits,
    features: plan.features,
    caps: plan.caps,
    plan,
  };
}
