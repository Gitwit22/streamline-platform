// NOTE: Server canonical baseline lives in streamline-server/routes/account.ts
// under BASE_STREAM_DEFAULTS. If you change one, update the other to match.
export const DEFAULT_STREAM_DEFAULTS = Object.freeze({
  video: { resolution: "720p", fps: 30, bitrateKbps: 2500 },
  audio: { sampleRate: 48000, channels: 2 },
  platform: { youtubePrivacy: "public" as const },
  features: {
    recordingDefault: false,
    hlsDefault: false,
    transcodeDefault: false,
  },
} as const);

export type StreamDefaults = typeof DEFAULT_STREAM_DEFAULTS;

/**
 * Resolve effective stream defaults from an optional account-like object.
 * This mirrors the server-side accounts/{uid}.streamDefaults contract and
 * safely falls back to the shared baseline when missing.
 */
export function resolveStreamDefaults(account?: { streamDefaults?: StreamDefaults } | null) {
  const fromAccount = account?.streamDefaults;
  if (fromAccount && typeof fromAccount === "object") {
    return fromAccount;
  }
  return DEFAULT_STREAM_DEFAULTS;
}
