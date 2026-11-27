/**
 * Pre-join device check: what the participant chose before entering the
 * room (camera / mic on or off, which devices) and when the step is shown.
 * The background effect is chosen in the same screen but lives in
 * lib/cameraEffects.ts, which the in-room controller already applies.
 *
 * Choices are remembered per browser so the next visit starts the same way.
 */

export type PreJoinChoices = {
  videoEnabled: boolean;
  audioEnabled: boolean;
  /** "" = browser default. */
  videoDeviceId: string;
  audioDeviceId: string;
};

export const DEFAULT_PREJOIN_CHOICES: PreJoinChoices = {
  videoEnabled: true,
  audioEnabled: true,
  videoDeviceId: "",
  audioDeviceId: "",
};

export const PREJOIN_STORAGE_KEY = "sl_prejoin_choices";
const MAX_DEVICE_ID = 512;

function deviceId(v: unknown): string {
  return typeof v === "string" && v.length <= MAX_DEVICE_ID ? v : "";
}

export function normalizePreJoinChoices(raw: unknown): PreJoinChoices {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREJOIN_CHOICES };
  const r = raw as Record<string, unknown>;
  return {
    videoEnabled: typeof r.videoEnabled === "boolean" ? r.videoEnabled : DEFAULT_PREJOIN_CHOICES.videoEnabled,
    audioEnabled: typeof r.audioEnabled === "boolean" ? r.audioEnabled : DEFAULT_PREJOIN_CHOICES.audioEnabled,
    videoDeviceId: deviceId(r.videoDeviceId),
    audioDeviceId: deviceId(r.audioDeviceId),
  };
}

export function loadPreJoinChoices(): PreJoinChoices {
  try {
    const raw = localStorage.getItem(PREJOIN_STORAGE_KEY);
    return normalizePreJoinChoices(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PREJOIN_CHOICES };
  }
}

export function savePreJoinChoices(choices: PreJoinChoices): void {
  try {
    localStorage.setItem(PREJOIN_STORAGE_KEY, JSON.stringify(normalizePreJoinChoices(choices)));
  } catch {
    // Not remembered next time; this join still uses the choices.
  }
}

/**
 * The LiveKitRoom `audio` / `video` prop for one device.
 *  - not allowed (viewer, host controls)  -> false, whatever was chosen
 *  - no pre-join choices (step skipped)   -> the previous behavior: on when allowed
 *  - turned off in the pre-join           -> false
 *  - a specific device                    -> { deviceId }, merged by LiveKit with
 *                                            the room's capture defaults (resolution)
 */
export function captureOptionFor(
  allowed: boolean,
  enabled: boolean | undefined,
  chosenDeviceId: string | undefined,
): boolean | { deviceId: string } {
  if (!allowed) return false;
  if (enabled === undefined) return true;
  if (!enabled) return false;
  return chosenDeviceId ? { deviceId: chosenDeviceId } : true;
}

/**
 * Show the device check to anyone who will publish, once per visit:
 * hosts as soon as they have a name (no need to wait for the token), guests
 * once their token says they're on stage (viewers never publish, so they
 * skip it).
 */
export function shouldShowPreJoin(s: {
  done: boolean;
  hasName: boolean;
  isHost: boolean;
  hasToken: boolean;
  isAudience: boolean;
  blocked: boolean;
}): boolean {
  if (s.done || !s.hasName || s.blocked) return false;
  if (s.isHost) return true;
  return s.hasToken && !s.isAudience;
}

/** Keeps a saved device only if it's still connected ("" = default otherwise). */
export function availableDeviceId(saved: string, devices: Array<{ deviceId: string }>): string {
  return saved && devices.some((d) => d.deviceId === saved) ? saved : "";
}
