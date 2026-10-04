/**
 * Back-compat feature gate. A thin wrapper over the entitlement engine
 * (lib/entitlements): the effective plan (admin override > platform admin >
 * base plan, billing-blocked paid plans fall back to free) AND the platform
 * switches decide. There is no separate plan/flag logic here any more.
 */
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import { checkFeature, FEATURE_KEYS, getPlatformFlag, type FeatureKey } from "../lib/entitlements";
import { LIMIT_ERRORS } from "../lib/limitErrors";
import type { UserAccount } from "../lib/userAccount";

type AccessResult = {
  allowed: boolean;
  code?: string;
  reason?: string;
  _diag?: Record<string, any>;
};

/** Historic feature names accepted by callers -> canonical entitlement keys. */
const FEATURE_ALIASES: Record<string, FeatureKey> = {
  rtmp: "multistream",
  rtmpMultistream: "multistream",
  destinations: "multistream",
  canHls: "hls",
  hlsEnabled: "hls",
  hlsCustomizationEnabled: "hlsCustomization",
  ppv: "payPerView",
  allowsOverages: "overages",
  overagesAllowed: "overages",
};

export function toFeatureKey(featureKey: string): FeatureKey | null {
  if ((FEATURE_KEYS as readonly string[]).includes(featureKey)) return featureKey as FeatureKey;
  return FEATURE_ALIASES[featureKey] || null;
}

export async function canAccessFeature(
  uidOrAccount: string | UserAccount,
  featureKey: string
): Promise<AccessResult> {
  const uid = typeof uidOrAccount === "string" ? uidOrAccount : uidOrAccount?.uid;
  const key = toFeatureKey(featureKey);
  if (!key) {
    return {
      allowed: false,
      code: LIMIT_ERRORS.FEATURE_NOT_ENTITLED,
      reason: "Unknown feature",
      _diag: { uid, feature: featureKey, failedAt: "unknown_feature" },
    };
  }
  const ent = await getEffectiveEntitlements(String(uid || ""));
  const check = checkFeature(ent, key);
  if (check.allowed) return { allowed: true };
  return {
    allowed: false,
    code: check.code,
    reason: check.reason,
    _diag: {
      uid,
      planId: ent.planId,
      feature: key,
      decidedBy: ent.source.decidedBy,
      failedAt: check.code === LIMIT_ERRORS.FEATURE_DISABLED ? "platform_gate" : "feature_flag",
    },
  };
}

/** Platform monetization / PPV switches (opt-in; default disabled). */
export async function getPlatformMonetizationFlag(key: "monetization" | "payPerView"): Promise<boolean> {
  return getPlatformFlag(key === "monetization" ? "monetizationEnabled" : "payPerViewEnabled");
}
