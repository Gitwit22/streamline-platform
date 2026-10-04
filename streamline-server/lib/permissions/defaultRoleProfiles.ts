import { ROLE_PRESET_DEFAULT_PERMISSIONS } from "./roleDefaults";

export type RolePermissionMap = {
  canStream: boolean;
  canRecord: boolean;
  canDestinations: boolean;
  canModerate: boolean;
  canLayout: boolean;
  canScreenShare: boolean;
  canInvite: boolean;
  canAnalytics: boolean;
  canMuteGuests: boolean;
  canRemoveGuests: boolean;
};

export type DefaultRoleId = "host" | "cohost" | "moderator" | "participant" | "viewer";

export type DefaultRoleProfile = {
  id: DefaultRoleId;
  name: string;
  permissions: RolePermissionMap;
  lockedName?: boolean;
  isSystemDefault: true;
};

function perms(p: Partial<RolePermissionMap>): RolePermissionMap {
  return {
    canStream: !!p.canStream,
    canRecord: !!p.canRecord,
    canDestinations: !!p.canDestinations,
    canModerate: !!p.canModerate,
    canLayout: !!p.canLayout,
    canScreenShare: !!p.canScreenShare,
    canInvite: !!p.canInvite,
    canAnalytics: !!p.canAnalytics,
    canMuteGuests: !!p.canMuteGuests,
    canRemoveGuests: !!p.canRemoveGuests,
  };
}

// Canonical default role profiles. Participant/cohost permissions are derived
// from lib/permissions/roleDefaults.ts (the single authored source of role
// defaults, also used by Settings > Role Defaults and room role presets).
export const DEFAULT_ROLE_PROFILES: DefaultRoleProfile[] = [
  {
    id: "host",
    name: "Host",
    lockedName: true,
    isSystemDefault: true,
    permissions: perms({
      canStream: true,
      canRecord: true,
      canDestinations: true,
      canModerate: true,
      canLayout: true,
      canScreenShare: true,
      canInvite: true,
      canAnalytics: true,
      canMuteGuests: true,
      canRemoveGuests: true,
    }),
  },
  {
    id: "cohost",
    name: "Co-Host",
    lockedName: true,
    isSystemDefault: true,
    permissions: perms(ROLE_PRESET_DEFAULT_PERMISSIONS.cohost),
  },
  {
    // Legacy alias: "moderator" is treated as cohost everywhere.
    id: "moderator",
    name: "Moderator",
    lockedName: true,
    isSystemDefault: true,
    permissions: perms(ROLE_PRESET_DEFAULT_PERMISSIONS.cohost),
  },
  {
    id: "participant",
    name: "Participant",
    lockedName: true,
    isSystemDefault: true,
    permissions: perms(ROLE_PRESET_DEFAULT_PERMISSIONS.participant),
  },
  {
    id: "viewer",
    name: "Viewer",
    lockedName: true,
    isSystemDefault: true,
    permissions: perms({}),
  },
];

export const DEFAULT_ROLE_PROFILES_BY_ID: Record<DefaultRoleId, DefaultRoleProfile> =
  DEFAULT_ROLE_PROFILES.reduce((acc, profile) => {
    acc[profile.id] = profile;
    return acc;
  }, {} as Record<DefaultRoleId, DefaultRoleProfile>);
