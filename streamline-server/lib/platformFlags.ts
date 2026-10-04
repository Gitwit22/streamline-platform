import type { Response } from "express";
import { readTranscodeEnabledEnv } from "./entitlements/flags";

// Global platform-level switch for transcoding/export features
// (PLATFORM_TRANSCODE_ENABLED). Defaults to true when unset so older
// deployments are not bricked. Firestore-backed platform flags live in
// lib/entitlements/flags.ts (single defaults table).
export function getPlatformTranscodeEnabled(): boolean {
  return readTranscodeEnabledEnv();
}

// Guard helper for transcode/export CREATE entrypoints (never for cleanup).
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
