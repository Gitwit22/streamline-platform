/**
 * Room-level presence policy system.
 *
 * Presence mode controls how a participant appears and behaves in a room.
 * The old "silent" mode has been unified into "invisible" — legacy callers
 * that send "silent" are transparently mapped to "invisible".
 *
 * - "normal"    – Visible in roster, standard permissions.
 * - "invisible" – Hidden from standard roster; cannot publish audio/video,
 *                 screen-share, send chat, or request stage.  May still
 *                 receive room media, mute/remove participants, and send
 *                 invite links.  Admin/moderator views may still list
 *                 invisible participants in a protected admin-only roster.
 */
export type PresenceMode = "normal" | "invisible";

/** Roles that can meaningfully use non-normal presence modes. */
export type PresenceCapableRole = "host" | "cohost" | "mod" | "bot";

/** Extended room role that includes moderator and bot roles. */
export type ExtendedRoomRole =
  | "host"
  | "cohost"
  | "speaker"
  | "participant"
  | "mod"
  | "bot";

/** Metadata shape embedded in the LiveKit participant token. */
export interface PresenceMetadata {
  role?: string;
  presenceMode?: PresenceMode;
  isVisibleInRoster?: boolean;
  canSendChat?: boolean;
  canReadChat?: boolean;
  canScreenShare?: boolean;
  canRequestStage?: boolean;
  rolePresetId?: string;
}

/**
 * Policy object describing what a presence mode allows / disallows.
 * Structured so that future modes (e.g. "listen_only") can be added
 * without a major refactor — just add a new entry to PRESENCE_POLICIES.
 */
export interface PresencePolicy {
  canPublishAudio: boolean;
  canPublishVideo: boolean;
  canScreenShare: boolean;
  canSendChat: boolean;
  canReadChat: boolean;
  canRequestStage: boolean;
  isVisibleInRoster: boolean;
  canModerate: boolean;
}

/** @deprecated Use {@link PresencePolicy} instead. */
export type PresenceModeDefaults = PresencePolicy;

const PRESENCE_POLICIES: Record<PresenceMode, PresencePolicy> = {
  normal: {
    canPublishAudio: true,
    canPublishVideo: true,
    canScreenShare: true,
    canSendChat: true,
    canReadChat: true,
    canRequestStage: true,
    isVisibleInRoster: true,
    canModerate: false,
  },
  invisible: {
    canPublishAudio: false,
    canPublishVideo: false,
    canScreenShare: false,
    canSendChat: false,
    canReadChat: true,
    canRequestStage: false,
    isVisibleInRoster: false,
    canModerate: true,
  },
};

/**
 * Returns true when the value is a recognized presence mode literal.
 * Accepts the legacy "silent" value for backwards compatibility
 * (callers should follow up with {@link normalizePresenceMode}).
 */
export function isValidPresenceMode(v: unknown): v is PresenceMode {
  return v === "normal" || v === "silent" || v === "invisible";
}

/**
 * Normalize a raw presence mode value.
 * Maps the legacy "silent" value to "invisible"; unknown values
 * fall back to "normal".
 */
export function normalizePresenceMode(v: unknown): PresenceMode {
  if (v === "invisible" || v === "silent") return "invisible";
  return "normal";
}

/** Look up the policy for a presence mode. */
export function getPresencePolicy(mode: PresenceMode): PresencePolicy {
  return PRESENCE_POLICIES[mode];
}

/** @deprecated Use {@link getPresencePolicy} instead. */
export function getPresenceModeDefaults(mode: PresenceMode): PresencePolicy {
  return getPresencePolicy(mode);
}

/**
 * Build LiveKit participant metadata that the frontend uses to
 * decide visibility and capabilities for a given participant.
 */
export function buildPresenceMetadata(opts: {
  role: string;
  presenceMode: PresenceMode;
  rolePresetId?: string;
}): PresenceMetadata {
  const policy = getPresencePolicy(opts.presenceMode);
  return {
    role: opts.role,
    presenceMode: opts.presenceMode,
    isVisibleInRoster: policy.isVisibleInRoster,
    canSendChat: policy.canSendChat,
    canReadChat: policy.canReadChat,
    canScreenShare: policy.canScreenShare,
    canRequestStage: policy.canRequestStage,
    ...(opts.rolePresetId ? { rolePresetId: opts.rolePresetId } : {}),
  };
}
