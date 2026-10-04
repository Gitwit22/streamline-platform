/**
 * Platform feature flags: ONE defaults table + ONE resolver.
 *
 * Flags live in Firestore `featureFlags/{name}` as `{ enabled: boolean }`.
 * A missing doc (or a non-boolean `enabled`) uses PLATFORM_FLAG_DEFAULTS.
 *
 *   - Kill switches (default ON): the plan decides; the flag can only turn a
 *     feature off platform-wide.
 *   - Opt-in switches (default OFF): unfinished / risky surfaces that must be
 *     enabled explicitly.
 *
 * Every server surface (/api/account/me, /api/plans, featureAccess, editing,
 * recordings, monetization, collaborators) reads flags through this module,
 * and clients use the values the server sends (no client-side defaults).
 *
 * Flags never block cleanup (DELETE / revoke / download of own data).
 */
import type { PlatformFlags } from "./types";

export const PLATFORM_FLAG_DEFAULTS = {
  // Kill switches (default enabled)
  recording: true,
  hlsSettingsTab: true,
  contentLibraryEnabled: true,
  projectsEnabled: true,
  editorEnabled: true,
  myContentEnabled: true,
  myContentRecordingsEnabled: true,
  // Opt-in switches (default disabled)
  audioMixerEnabled: false,
  advancedScreenShareEnabled: false,
  mixedAudioPublishEnabled: false,
  monetizationEnabled: false,
  payPerViewEnabled: false,
  invisibleHostEnabled: false,
  collaboratorDelegationEnabled: false,
} as const;

export type PlatformFlagName = keyof typeof PLATFORM_FLAG_DEFAULTS;

export const PLATFORM_FLAG_NAMES = Object.keys(PLATFORM_FLAG_DEFAULTS) as PlatformFlagName[];

export function isPlatformFlagName(name: unknown): name is PlatformFlagName {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(PLATFORM_FLAG_DEFAULTS, name);
}

export function parseEnvBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "off", "no", "disabled"].includes(normalized)) return false;
  if (["true", "1", "on", "yes", "enabled"].includes(normalized)) return true;
  return defaultValue;
}

/** PLATFORM_TRANSCODE_ENABLED (default true so older deployments are not bricked). */
export function readTranscodeEnabledEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvBoolean(env.PLATFORM_TRANSCODE_ENABLED, true);
}

/**
 * Resolve one flag from its Firestore doc data (undefined = doc missing).
 * `enabled` (what the admin toggle writes) wins; the HLS doc also accepts the
 * historic `hlsEnabled` key when `enabled` is absent.
 */
export function resolveFlagValue(name: PlatformFlagName, docData: any | undefined | null): boolean {
  const d = docData && typeof docData === "object" ? docData : {};
  if (typeof d.enabled === "boolean") return d.enabled;
  if (name === "hlsSettingsTab" && typeof d.hlsEnabled === "boolean") return d.hlsEnabled;
  return PLATFORM_FLAG_DEFAULTS[name];
}

/** Resolve all flags from a map of doc data keyed by flag name (missing => default). */
export function resolvePlatformFlags(
  docs: Partial<Record<PlatformFlagName, any>>,
  transcodeEnabled: boolean = readTranscodeEnabledEnv()
): PlatformFlags {
  const out: any = {};
  for (const name of PLATFORM_FLAG_NAMES) out[name] = resolveFlagValue(name, docs[name]);
  out.transcodeEnabled = transcodeEnabled;
  return out as PlatformFlags;
}

export function defaultPlatformFlags(transcodeEnabled: boolean = readTranscodeEnabledEnv()): PlatformFlags {
  return resolvePlatformFlags({}, transcodeEnabled);
}

/**
 * Wire format for `platformFlags` on /api/account/me and /api/plans
 * (legacy aliases included so older clients keep working).
 */
export function toPlatformFlagsPayload(flags: PlatformFlags) {
  return {
    hlsEnabled: flags.hlsSettingsTab,
    hlsSettingsTab: flags.hlsSettingsTab,
    transcodeEnabled: flags.transcodeEnabled,
    recordingEnabled: flags.recording,
    contentLibraryEnabled: flags.contentLibraryEnabled,
    projectsEnabled: flags.projectsEnabled,
    editorEnabled: flags.editorEnabled,
    myContentEnabled: flags.myContentEnabled,
    myContentRecordingsEnabled: flags.myContentRecordingsEnabled,
    audioMixerEnabled: flags.audioMixerEnabled,
    advancedScreenShareEnabled: flags.advancedScreenShareEnabled,
    mixedAudioPublishEnabled: flags.mixedAudioPublishEnabled,
    monetizationEnabled: flags.monetizationEnabled,
    payPerViewEnabled: flags.payPerViewEnabled,
    invisibleHostEnabled: flags.invisibleHostEnabled,
    collaboratorDelegationEnabled: flags.collaboratorDelegationEnabled,
  };
}

/** Flags the Admin UI must always list (with their effective default) even before a doc exists. */
export function adminSeededFlagList(): Array<{ name: PlatformFlagName; enabled: boolean }> {
  return PLATFORM_FLAG_NAMES.map((name) => ({ name, enabled: PLATFORM_FLAG_DEFAULTS[name] }));
}
