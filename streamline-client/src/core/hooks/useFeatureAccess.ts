import { useMemo } from "react";
import {
  computeEffectiveFeatureAccess,
  type EffectiveEntitlementsLike,
} from "../lib/effectiveFeatureAccess";
import { usePlatformFlags } from "./usePlatformFlags";

export function useFeatureAccess(effectiveEntitlements?: EffectiveEntitlementsLike | null) {
  const { flags: platformFlags, loading: platformFlagsLoading } = usePlatformFlags();

  const access = useMemo(() => {
    return computeEffectiveFeatureAccess({
      effectiveEntitlements: effectiveEntitlements || {},
      platformFlags: platformFlags || {},
    });
  }, [effectiveEntitlements, platformFlags]);

  return {
    platformFlags,
    platformFlagsLoading,
    access,
  } as const;
}
