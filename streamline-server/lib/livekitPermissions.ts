// NOTE: LiveKit's JS client (`livekit-client`) represents Track.Source as
// string literals like "camera" and "microphone".
//
// The server SDK exposes protobuf numeric enums (e.g. TrackSource.CAMERA === 1).
// We intentionally emit *string* sources here so UI code (and LiveKit Components)
// can reliably compare `canPublishSources` against `Track.Source.*`.

import type { PresenceMode } from "./presenceMode";
import { getPresencePolicy } from "./presenceMode";

export type LiveKitTrackSource =
  | "camera"
  | "microphone"
  | "screen_share"
  | "screen_share_audio";

// VideoGrant-compatible return type (used for LiveKit token grants)
export type LiveKitGrant = {
  canSubscribe: boolean;
  canPublish: boolean;
  canPublishData: boolean;
  canPublishSources: LiveKitTrackSource[];
};

// Narrow type: just the realtime flags that matter for LiveKit permissions
export type RealtimePreset = {
  canPublishAudio?: boolean;
  canPublishVideo?: boolean;
  canScreenShare?: boolean;
  canSubscribe?: boolean;
  canSendData?: boolean; // chat/data
};

// Convert preset-style flags into LiveKit grant format
export function presetToLiveKitGrant(p: RealtimePreset): LiveKitGrant {
  const canPublish = !!p.canPublishAudio || !!p.canPublishVideo || !!p.canScreenShare;

  const sources: LiveKitTrackSource[] = [];
  if (p.canPublishAudio) sources.push("microphone");
  if (p.canPublishVideo) sources.push("camera");
  if (p.canScreenShare) {
    sources.push("screen_share");
    sources.push("screen_share_audio");
  }

  return {
    canSubscribe: p.canSubscribe ?? true,
    canPublish,
    canPublishData: p.canSendData ?? true,
    canPublishSources: sources,
  };
}

// Optional coarse role mapping so role-based grants can share the same truth.
// `opts.screenShare` adds screen_share sources for guest/participant (the
// owner's participant preset "Share Screen" toggle); it never affects
// viewers, and cohost/host always include screen share.
export function roleToParticipantPermission(
  role: "viewer" | "guest" | "participant" | "cohost" | "host",
  opts?: { screenShare?: boolean },
): LiveKitGrant {
  const canSubscribe = true;
  let canPublish = false;
  let canPublishData = false;
  let canPublishSources: LiveKitTrackSource[] = [];

  switch (role) {
    case "viewer": {
      // Reserved for HLS watch-only (future)
      canPublish = false;
      canPublishData = false;
      canPublishSources = [];
      break;
    }
    case "guest":
    case "participant": {
      // Invite-based guests and authenticated participants both get mic+cam
      canPublish = true;
      canPublishData = true;
      canPublishSources = opts?.screenShare
        ? ["microphone", "camera", "screen_share", "screen_share_audio"]
        : ["microphone", "camera"];
      break;
    }
    case "cohost":
    case "host":
    default: {
      canPublish = true;
      canPublishData = true;
      canPublishSources = [
        "microphone",
        "camera",
        "screen_share",
        "screen_share_audio",
      ];
      break;
    }
  }

  return {
    canSubscribe,
    canPublish,
    canPublishData,
    canPublishSources,
  };
}

/**
 * Apply presence-mode restrictions on top of the base role grant.
 * Invisible mode disables publish, screen-share, and data (chat)
 * capabilities while preserving subscribe so the participant can
 * still monitor the room.
 */
export function applyPresenceModeToGrant(
  base: LiveKitGrant,
  mode: PresenceMode,
): LiveKitGrant {
  if (mode === "normal") return base;

  const policy = getPresencePolicy(mode);
  return {
    canSubscribe: base.canSubscribe, // always keep subscribe for monitoring
    canPublish: policy.canPublishAudio || policy.canPublishVideo || policy.canScreenShare,
    canPublishData: policy.canSendChat,
    canPublishSources: [],
  };
}

// ---------------------------------------------------------------------------
// RoomService (server API) encoding
// ---------------------------------------------------------------------------
//
// Token grants (VideoGrant in the JWT) accept string sources such as
// "microphone". The RoomService API (`RoomServiceClient.updateParticipant`)
// does NOT: it builds a protobuf `ParticipantPermission`, whose
// `can_publish_sources` field is a repeated `TrackSource` enum. Passing
// strings there makes livekit-server-sdk 2.x throw
// "cannot encode field livekit.ParticipantPermission.can_publish_sources to JSON".
//
// Always run permissions through `toLiveKitParticipantPermission` before
// handing them to `updateParticipant`.

/** Numeric values of livekit.TrackSource (protocol enum). */
export const LIVEKIT_TRACK_SOURCE_ENUM = {
  unknown: 0,
  camera: 1,
  microphone: 2,
  screen_share: 3,
  screen_share_audio: 4,
} as const;

const TRACK_SOURCE_NUMBER_TO_STRING: Record<number, LiveKitTrackSource> = {
  1: "camera",
  2: "microphone",
  3: "screen_share",
  4: "screen_share_audio",
};

/**
 * Map a track source given as a string ("microphone", "SCREEN_SHARE",
 * "screenShare") or as the protobuf enum number to the enum number.
 * Returns null for unknown/unsupported values (including UNKNOWN=0).
 */
export function toLiveKitTrackSourceNumber(source: unknown): number | null {
  if (typeof source === "number") {
    return TRACK_SOURCE_NUMBER_TO_STRING[source] ? source : null;
  }
  if (typeof source !== "string") return null;
  const key = source
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase();
  const n = (LIVEKIT_TRACK_SOURCE_ENUM as Record<string, number>)[key];
  return typeof n === "number" && n > 0 ? n : null;
}

/** Reverse of toLiveKitTrackSourceNumber (enum number or string -> string). */
export function toLiveKitTrackSourceString(source: unknown): LiveKitTrackSource | null {
  const n = toLiveKitTrackSourceNumber(source);
  return n == null ? null : TRACK_SOURCE_NUMBER_TO_STRING[n] ?? null;
}

export type LiveKitParticipantPermissionInit = {
  canSubscribe?: boolean;
  canPublish?: boolean;
  canPublishData?: boolean;
  canPublishSources: number[];
  hidden?: boolean;
  recorder?: boolean;
  canUpdateMetadata?: boolean;
  canSubscribeMetrics?: boolean;
};

const PASSTHROUGH_BOOLEAN_PERMISSION_KEYS = [
  "canSubscribe",
  "canPublish",
  "canPublishData",
  "hidden",
  "recorder",
  "canUpdateMetadata",
  "canSubscribeMetrics",
] as const;

/**
 * Convert a permission object (grant-style with string sources, or a
 * ParticipantPermission read back from listParticipants with numeric
 * sources) into a plain object that `new ParticipantPermission(...)`
 * can encode. Unknown keys and unknown sources are dropped; sources are
 * de-duplicated and keep their original order.
 */
export function toLiveKitParticipantPermission(perm: any): LiveKitParticipantPermissionInit {
  const src = perm && typeof perm === "object" ? perm : {};
  const out: LiveKitParticipantPermissionInit = { canPublishSources: [] };

  for (const key of PASSTHROUGH_BOOLEAN_PERMISSION_KEYS) {
    if (typeof src[key] === "boolean") (out as any)[key] = src[key];
  }

  const rawSources: unknown[] = Array.isArray(src.canPublishSources) ? src.canPublishSources : [];
  const seen = new Set<number>();
  for (const s of rawSources) {
    const n = toLiveKitTrackSourceNumber(s);
    if (n != null && !seen.has(n)) {
      seen.add(n);
      out.canPublishSources.push(n);
    }
  }

  return out;
}

/**
 * Restrict a LiveKit participant permission according to room controls
 * (host toggles). Used to enforce canPublishAudio / canPublishVideo /
 * forcedMute / forcedVideoOff server-side so a modified client cannot
 * ignore them. Only ever removes sources from the base permission.
 *
 * Note: in LiveKit an empty `canPublishSources` list means "all sources",
 * so when restricting an unrestricted participant we expand to the full
 * list first.
 */
export function restrictPermissionByControls(
  base: any,
  controls: {
    canPublishAudio?: boolean;
    canPublishVideo?: boolean;
    canScreenShare?: boolean;
    forcedMute?: boolean;
    forcedVideoOff?: boolean;
    muteLocked?: boolean;
  },
): LiveKitParticipantPermissionInit {
  const perm = toLiveKitParticipantPermission(base);
  if (perm.canPublish === false) return perm;

  const blockAudio = controls.canPublishAudio === false || controls.forcedMute === true || controls.muteLocked === true;
  const blockVideo = controls.canPublishVideo === false || controls.forcedVideoOff === true;
  const blockScreen = controls.canScreenShare === false;
  if (!blockAudio && !blockVideo && !blockScreen) return perm;

  let sources = perm.canPublishSources.length
    ? perm.canPublishSources.slice()
    : [
        LIVEKIT_TRACK_SOURCE_ENUM.camera,
        LIVEKIT_TRACK_SOURCE_ENUM.microphone,
        LIVEKIT_TRACK_SOURCE_ENUM.screen_share,
        LIVEKIT_TRACK_SOURCE_ENUM.screen_share_audio,
      ];

  sources = sources.filter((n) => {
    if (blockAudio && n === LIVEKIT_TRACK_SOURCE_ENUM.microphone) return false;
    if (blockVideo && n === LIVEKIT_TRACK_SOURCE_ENUM.camera) return false;
    if (blockScreen && (n === LIVEKIT_TRACK_SOURCE_ENUM.screen_share || n === LIVEKIT_TRACK_SOURCE_ENUM.screen_share_audio)) {
      return false;
    }
    return true;
  });

  if (sources.length === 0) {
    // Nothing left to publish. An empty list would mean "everything" to
    // LiveKit, so turn publishing off instead (data/chat stays as-is).
    return { ...perm, canPublish: false, canPublishSources: [] };
  }
  return { ...perm, canPublishSources: sources };
}

/**
 * Base LiveKit permission for a role plus restrictions from room controls.
 * `screenShareScope` is the identity's own screen-share scope (the applied
 * role preset's canScreenShare): participants get screen_share only when it
 * is true. Restrictions (canPublishAudio/Video === false, forcedMute, mute
 * lock, canScreenShare === false...) then remove sources.
 */
export function permissionForRoleWithControls(
  role: "viewer" | "guest" | "participant" | "cohost" | "host",
  controls: Parameters<typeof restrictPermissionByControls>[1],
  screenShareScope?: boolean,
): LiveKitParticipantPermissionInit {
  return restrictPermissionByControls(
    roleToParticipantPermission(role, { screenShare: screenShareScope === true }),
    controls || {},
  );
}
