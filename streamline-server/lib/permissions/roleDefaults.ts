/**
 * Single source of truth for in-room role defaults (participant / cohost).
 *
 * Used by:
 *  - routes/account.ts      (Settings > Role Defaults: GET/PATCH role-presets)
 *  - routes/roomControls.ts (applying a role preset to rooms/{roomId}/controls/{identity})
 *  - lib/permissions/defaultRoleProfiles.ts -> lib/rolePermissions.ts ROLE_PERMISSIONS
 *    (what roomAccessTokens carry and the server enforces)
 *
 * A "role preset" is stored per owner at users/{uid}/rolePresets/{presetId}
 * and copied into a participant's controls doc when the role is applied.
 * presetToRoomPermissions() maps those scopes to roomAccessToken permissions.
 *
 * Pure module: no Firestore imports.
 */

import type { RolePermissionMap } from "./defaultRoleProfiles";

export type RolePresetId = "participant" | "cohost";

export type RolePresetControls = {
  role: RolePresetId;
  // Publishing / presence
  canPublishAudio: boolean;
  canPublishVideo: boolean;
  canScreenShare: boolean;
  tileVisible: boolean;
  // In-room scopes
  canMuteGuests: boolean;
  canRemoveGuests: boolean;
  canInviteLinks: boolean;
  canChangeLayoutScene: boolean;
  canManageDestinations: boolean;
  canStartStopStream: boolean;
  canStartStopRecording: boolean;
};

export const ROLE_PRESET_BOOLEAN_KEYS = [
  "canPublishAudio",
  "canPublishVideo",
  "canScreenShare",
  "tileVisible",
  "canMuteGuests",
  "canRemoveGuests",
  "canInviteLinks",
  "canChangeLayoutScene",
  "canManageDestinations",
  "canStartStopStream",
  "canStartStopRecording",
] as const;

export type RolePresetBooleanKey = (typeof ROLE_PRESET_BOOLEAN_KEYS)[number];

/**
 * Keys an owner may toggle in Settings > Role Defaults. Publishing basics
 * (mic/cam/tile) stay on; participants can never get moderation/production
 * scopes (those keys are clamped off for the participant preset).
 */
export const ROLE_PRESET_EDITABLE_KEYS: Record<RolePresetId, readonly RolePresetBooleanKey[]> = {
  participant: ["canScreenShare"],
  cohost: [
    "canScreenShare",
    "canInviteLinks",
    "canChangeLayoutScene",
    "canMuteGuests",
    "canRemoveGuests",
    "canStartStopStream",
    "canStartStopRecording",
    "canManageDestinations",
  ],
};

export const ROLE_PRESET_DEFAULTS: Record<RolePresetId, RolePresetControls> = {
  participant: {
    role: "participant",
    canPublishAudio: true,
    canPublishVideo: true,
    canScreenShare: false,
    tileVisible: true,
    canMuteGuests: false,
    canRemoveGuests: false,
    canInviteLinks: false,
    canChangeLayoutScene: false,
    canManageDestinations: false,
    canStartStopStream: false,
    canStartStopRecording: false,
  },
  cohost: {
    role: "cohost",
    canPublishAudio: true,
    canPublishVideo: true,
    canScreenShare: true,
    tileVisible: true,
    canMuteGuests: true,
    canRemoveGuests: true,
    canInviteLinks: true,
    canChangeLayoutScene: true,
    canManageDestinations: false,
    canStartStopStream: false,
    canStartStopRecording: false,
  },
};

/**
 * Normalize a role/preset id. Legacy "moderator" (and "co-host") is treated as
 * cohost everywhere; "guest"/"speaker" as participant. Unknown -> null.
 */
export function normalizeRolePresetId(raw: unknown): RolePresetId | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "cohost" || v === "co-host" || v === "co_host" || v === "moderator") return "cohost";
  if (v === "participant" || v === "guest" || v === "speaker") return "participant";
  return null;
}

/**
 * Full preset for `presetId`: stored values (users/{uid}/rolePresets/{id})
 * over the defaults. Non-editable keys always come from the defaults, so
 * stale or tampered data can't give participants moderation powers.
 */
export function normalizeRolePreset(presetId: RolePresetId, stored?: Record<string, unknown> | null): RolePresetControls {
  const base = ROLE_PRESET_DEFAULTS[presetId];
  const src = stored && typeof stored === "object" ? stored : {};
  const editable = new Set<string>(ROLE_PRESET_EDITABLE_KEYS[presetId]);
  const out: RolePresetControls = { ...base, role: presetId };
  for (const key of ROLE_PRESET_BOOLEAN_KEYS) {
    if (!editable.has(key)) continue;
    const v = (src as any)[key];
    if (typeof v === "boolean") (out as any)[key] = v;
  }
  return out;
}

/** Only the editable boolean keys of a patch (anything else is dropped). */
export function cleanRolePresetPatch(presetId: RolePresetId, body: unknown): Partial<RolePresetControls> {
  const src = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const out: Partial<RolePresetControls> = {};
  for (const key of ROLE_PRESET_EDITABLE_KEYS[presetId]) {
    if (typeof src[key] === "boolean") (out as any)[key] = src[key];
  }
  return out;
}

/**
 * roomAccessToken permissions implied by a role preset (before intersecting
 * with the owner's plan entitlements).
 */
export function presetToRoomPermissions(preset: RolePresetControls): RolePermissionMap {
  const canMuteGuests = !!preset.canMuteGuests;
  const canRemoveGuests = !!preset.canRemoveGuests;
  return {
    canStream: !!preset.canStartStopStream,
    canRecord: !!preset.canStartStopRecording,
    canDestinations: !!preset.canManageDestinations,
    canModerate: canMuteGuests || canRemoveGuests,
    canLayout: !!preset.canChangeLayoutScene,
    canScreenShare: !!preset.canScreenShare,
    canInvite: !!preset.canInviteLinks,
    canAnalytics: false,
    canMuteGuests,
    canRemoveGuests,
  };
}

/** Default roomAccessToken permissions per preset (the "system" defaults). */
export const ROLE_PRESET_DEFAULT_PERMISSIONS: Record<RolePresetId, RolePermissionMap> = {
  participant: presetToRoomPermissions(ROLE_PRESET_DEFAULTS.participant),
  cohost: presetToRoomPermissions(ROLE_PRESET_DEFAULTS.cohost),
};
