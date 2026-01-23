import type { Response } from "express";

function parseEnvBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "off", "no", "disabled"].includes(normalized)) return false;
  if (["true", "1", "on", "yes", "enabled"].includes(normalized)) return true;
  return defaultValue;
}

// Global platform-level switch for transcoding/export features.
// Defaults to true when unset so older deployments are not bricked.
export function getPlatformTranscodeEnabled(): boolean {
  return parseEnvBoolean(process.env.PLATFORM_TRANSCODE_ENABLED, true);
}

// Guard helper for transcode/export API entrypoints.
// Returns true when transcoding is allowed; when disabled, sends a friendly
// JSON error response and returns false so callers can early-return.
export function assertPlatformTranscodeEnabled(res: Response): boolean {
  const enabled = getPlatformTranscodeEnabled();
  if (!enabled) {
    res.status(409).json({
      error: "TRANSCODE_DISABLED",
      message: "Transcoding is temporarily disabled during beta testing.",
    });
    return false;
  }
  return true;
}
