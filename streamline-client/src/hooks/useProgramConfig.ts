/**
 * React hooks for consuming the active program/lane config.
 *
 * Program config is resolved from VITE_STREAMLINE_PROGRAM at build time, so
 * these hooks return stable values for the lifetime of the page — they do not
 * subscribe to any runtime state. Components can rely on the return value
 * never changing without a full page reload.
 *
 * Usage:
 *   const config = useProgramConfig();
 *   const key    = useCurrentProgramKey();
 *   const canUse = useFeatureFlag("canUseWebinars");
 */

import { useMemo } from "react";
import {
  getProgramConfig,
  getCurrentProgramKey,
  isFeatureEnabled,
} from "../config/programs";
import type { ProgramConfig, ProgramKey, ProgramFeatureFlags } from "../config/programs";

/** Returns the full ProgramConfig for the active program. */
export function useProgramConfig(): ProgramConfig {
  return useMemo(() => getProgramConfig(), []);
}

/** Returns the active program key ("edu" | "corporate"). */
export function useCurrentProgramKey(): ProgramKey {
  return useMemo(() => getCurrentProgramKey(), []);
}

/**
 * Returns the boolean value of a single feature flag for the active program.
 * The dependency array is intentionally empty because program config and
 * feature keys are resolved at build time and never change at runtime.
 *
 * @example
 *   const canUseWebinars = useFeatureFlag("canUseWebinars");
 */
export function useFeatureFlag(featureKey: keyof ProgramFeatureFlags): boolean {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => isFeatureEnabled(featureKey), []);
}
