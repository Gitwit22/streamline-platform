/**
 * Room Customization Types
 *
 * Stored at: rooms/{roomId}.settings.customization
 *
 * Security note: These are presentation-layer fields only.
 * Access control / admission logic lives in RoomSettingsPolicy
 * (stored at rooms/{roomId}.settings.greenroom) — never in this object.
 */

export type RoomCustomizationConfig = {
  banner?: {
    enabled: boolean;
    url: string;
    position: "top" | "bottom";
    height: number;
    opacity: number;
  };

  roomBackground?: {
    enabled: boolean;
    type: "image" | "gradient" | "solid";
    url?: string;
    value?: string;
    overlayOpacity?: number;
  };

  placeholderMedia?: {
    enabled: boolean;
    imageUrl: string;
    title?: string;
    subtitle?: string;
  };

  layoutStyle?: "default" | "speaker" | "grid" | "host-focus";

  introClip?: {
    enabled: boolean;
    assetId?: string;
    durationSeconds?: number;
    autoPlayBeforeLive?: boolean;
    allowHostSkip?: boolean;
    fadeInMs?: number;
    fadeOutMs?: number;
  };

  roomSfx?: {
    enabled: boolean;
    volume: number;
    cooldownMs: number;
    allowedEffects: Array<"applause" | "boo" | "crickets" | "airhorn">;
  };

  greenroom?: {
    waitingRoomMessage?: string;
    waitingRoomBackground?: string;
    waitingRoomMusic?: string;
  };
};

/**
 * Greenroom Policy Model
 *
 * Stored at: rooms/{roomId}.settings.greenroom
 *
 * Controls admission, blocking, and approval logic.
 * These are security fields — never mix with customization/UI fields.
 */
export type RoomSettingsPolicy = {
  greenroom: {
    mode: "off" | "prejoin" | "hls_waiting";
    requireApproval: boolean;
    autoAdmit: boolean;
    vipBypass: boolean;
    vipList: string[];
    blockedList: string[];
  };
};

/**
 * Room lifecycle state machine.
 *
 * Stored at: rooms/{roomId}.runtime.lifecycleState
 *
 * Standard flow:  draft → setup → greenroom → intro_playing → live → ending → ended
 * Fallback flow:  draft → live  (when greenroom disabled)
 *
 * Terminal states: "ended" (normal), "error" (unrecoverable failure).
 * States cannot be skipped arbitrarily — the host must advance the lifecycle
 * forward; backward transitions are not permitted.
 * "error" may occur at any non-terminal stage and signals that the room
 * requires manual intervention before it can proceed.
 */
export type RoomLifecycleState =
  | "draft"
  | "setup"
  | "greenroom"
  | "intro_playing"
  | "live"
  | "ending"
  | "ended"
  | "error";

/**
 * Intro clip runtime object.
 *
 * Stored at: rooms/{roomId}.runtime.intro
 */
export type RoomIntroRuntime = {
  status: "idle" | "queued" | "playing" | "skipped" | "completed" | "failed";
  assetId?: string;
  startedAt?: FirebaseFirestore.Timestamp;
  endedAt?: FirebaseFirestore.Timestamp;
};

/**
 * Guest staging runtime object.
 *
 * Stored at: rooms/{roomId}.runtime.guestStaging
 */
export type RoomGuestStagingRuntime = {
  enabled: boolean;
  pendingGuestIds: string[];
  admittedGuestIds: string[];
};

/** Built-in sound effects (not user-uploaded). */
export type BuiltInRoomSfx = "applause" | "boo" | "crickets" | "airhorn";
