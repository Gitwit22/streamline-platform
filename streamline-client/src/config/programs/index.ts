/**
 * Program/Lane config resolver.
 *
 * Reads VITE_STREAMLINE_PROGRAM at build time and returns the matching
 * ProgramConfig. All components and utilities should consume the program
 * config through these accessors — never read import.meta.env directly.
 *
 * Allowed values: "edu" | "corporate"
 * Default (when unset or invalid): "edu"
 */

import type { ProgramKey, ProgramConfig, ProgramFeatureFlags } from "./types";
import { eduConfig } from "./edu";
import { corporateConfig } from "./corporate";

const VALID_PROGRAMS: readonly ProgramKey[] = ["edu", "corporate"];
const DEFAULT_PROGRAM: ProgramKey = "edu";

const PROGRAM_CONFIGS: Record<ProgramKey, ProgramConfig> = {
  edu: eduConfig,
  corporate: corporateConfig,
};

/**
 * Resolve the active program key from VITE_STREAMLINE_PROGRAM.
 * Logs a console warning and falls back to the default lane when the value
 * is missing or invalid — the app should never crash due to a bad env value.
 */
function resolveProgram(): ProgramKey {
  const raw = (import.meta.env.VITE_STREAMLINE_PROGRAM || "").trim().toLowerCase();

  if (!raw) {
    return DEFAULT_PROGRAM;
  }

  if ((VALID_PROGRAMS as string[]).includes(raw)) {
    return raw as ProgramKey;
  }

  console.warn(
    `[StreamLine] Invalid VITE_STREAMLINE_PROGRAM value: "${raw}". ` +
      `Valid values are: ${VALID_PROGRAMS.join(", ")}. ` +
      `Falling back to "${DEFAULT_PROGRAM}".`
  );
  return DEFAULT_PROGRAM;
}

/**
 * Returns true only when VITE_STREAMLINE_PROGRAM was explicitly set to a
 * recognised program key. When false, the app should treat both lanes as
 * accessible (backwards-compatible behaviour for local development).
 */
export function isProgramExplicitlyConfigured(): boolean {
  const raw = (import.meta.env.VITE_STREAMLINE_PROGRAM || "").trim().toLowerCase();
  return (VALID_PROGRAMS as string[]).includes(raw);
}

/** Returns the full typed config for the active program. */
export function getProgramConfig(): ProgramConfig {
  return PROGRAM_CONFIGS[resolveProgram()];
}

/** Returns the active program key ("edu" | "corporate"). */
export function getCurrentProgramKey(): ProgramKey {
  return resolveProgram();
}

/**
 * Returns the value of a single feature flag for the active program.
 * Prefer `useProgramConfig().features.canUseX` in React components.
 */
export function isFeatureEnabled(featureKey: keyof ProgramFeatureFlags): boolean {
  return getProgramConfig().features[featureKey];
}

export type { ProgramKey, ProgramConfig, ProgramFeatureFlags } from "./types";
