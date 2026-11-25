/**
 * Turns LiveKit `RoomEvent.MediaDevicesError` events into the in-room
 * permission banner (Room.tsx: MediaPermissionErrorBanner).
 *
 * LiveKit emits the same event for camera, microphone AND screen share; only
 * camera/mic carry a device kind ("videoinput" / "audioinput"). Cancelling the
 * browser's screen-share picker rejects with NotAllowedError and no kind, so
 * treating every NotAllowedError as "camera/mic blocked" showed a false
 * alarm while the camera and mic were working.
 */

export type MediaPermissionErrorType = "denied" | "notFound" | "notReadable" | "notSupported" | "inAppBrowser";

/** Which capture failed; null when unknown (e.g. in-app browser warning). */
export type MediaErrorDevice = "audioinput" | "videoinput" | "screen";

export type MediaPermissionError = {
  type: MediaPermissionErrorType;
  message: string;
  device: MediaErrorDevice | null;
};

/** LiveKit passes "audioinput" / "videoinput" for mic / camera, undefined otherwise (screen share). */
export function deviceFromKind(kind: unknown): MediaErrorDevice {
  return kind === "audioinput" || kind === "videoinput" ? kind : "screen";
}

function label(device: MediaErrorDevice): string {
  if (device === "audioinput") return "Microphone";
  if (device === "videoinput") return "Camera";
  return "Screen sharing";
}

function errorName(error: unknown): string {
  const e = error as { name?: unknown } | null;
  return typeof e?.name === "string" && e.name ? e.name : String(error);
}

function errorMessage(error: unknown): string {
  const e = error as { message?: unknown } | null;
  return typeof e?.message === "string" ? e.message : "";
}

export function isPermissionDenied(error: unknown): boolean {
  const name = errorName(error);
  return name === "NotAllowedError" || name === "PermissionDeniedError";
}

/**
 * The banner to show for a device error, or null when nothing should be
 * shown (the user cancelled the screen-share picker).
 */
export function classifyMediaDeviceError(error: unknown, kind?: unknown): MediaPermissionError | null {
  const device = deviceFromKind(kind);
  const name = errorName(error);

  if (device === "screen") {
    if (!isPermissionDenied(error)) {
      return { type: "notSupported", device, message: `⚠️ Couldn't start screen sharing: ${name}` };
    }
    // Chrome: "Permission denied by system" = the OS blocks screen recording.
    // Anything else (e.g. "Permission denied by user") is the picker being cancelled.
    if (/system/i.test(errorMessage(error))) {
      return {
        type: "notSupported",
        device,
        message: "🔒 Screen sharing is blocked by your computer. Allow screen recording for this browser in your system settings, then try again.",
      };
    }
    return null;
  }

  const what = label(device);
  if (isPermissionDenied(error)) {
    return {
      type: "denied",
      device,
      message: `🔒 ${what} blocked. Click the lock icon in the address bar → allow ${what.toLowerCase()} → reload.`,
    };
  }
  if (name === "NotFoundError") {
    return { type: "notFound", device, message: `⚠️ No ${what.toLowerCase()} found. Check that it's connected.` };
  }
  if (name === "NotReadableError") {
    return {
      type: "notReadable",
      device,
      message: `⚠️ ${what} is in use by another app. Close other apps and reload.`,
    };
  }
  if (name === "NotSupportedError" || name === "OverconstrainedError") {
    return { type: "notSupported", device, message: "⚠️ Browser or device limitation. Try a different browser." };
  }
  return { type: "notSupported", device, message: `⚠️ Unable to access ${what.toLowerCase()}: ${name}` };
}
