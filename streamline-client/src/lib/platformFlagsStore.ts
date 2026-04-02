export type PlatformFlags = {
  hlsEnabled?: boolean;
  hlsSettingsTab?: boolean;
  recordingEnabled?: boolean;
  transcodeEnabled?: boolean;
  /** Experimental: publish mixed program audio instead of raw mic. */
  mixedAudioPublishEnabled?: boolean;
  /** Advanced screen share routing (pop-out, main-stage modes). */
  advancedScreenShareEnabled?: boolean;
  /** Audio mixer panel (bus routing, ducking, program output). */
  audioMixerEnabled?: boolean;
  /** Platform-wide monetization kill-switch (opt-in, default disabled). */
  monetizationEnabled?: boolean;
  /** Platform-wide PPV kill-switch (opt-in, default disabled). */
  payPerViewEnabled?: boolean;
  /** Invisible host mode (opt-in, default disabled). */
  invisibleHostEnabled?: boolean;
  /** Owner/collaborator delegated production mode (opt-in, default disabled). */
  collaboratorDelegationEnabled?: boolean;
  [key: string]: any;
};

let currentFlags: PlatformFlags | null | undefined = undefined; // undefined => not set yet
let currentFlagsAt = 0;

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}

export function getPlatformFlagsValue(): PlatformFlags | null | undefined {
  return currentFlags;
}

export function getPlatformFlagsFetchedAt(): number {
  return currentFlagsAt;
}

export function setPlatformFlagsValue(
  flags: PlatformFlags | null | undefined,
  opts?: { fetchedAt?: number },
) {
  const at = typeof opts?.fetchedAt === "number" ? opts.fetchedAt : Date.now();
  if (at < currentFlagsAt) return;

  const normalized = flags && typeof flags === "object" ? (flags as PlatformFlags) : {};
  currentFlags = normalized;
  currentFlagsAt = at;
  notify();
}

export function clearPlatformFlagsValue() {
  currentFlags = undefined;
  currentFlagsAt = 0;
  notify();
}

export function subscribePlatformFlags(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
