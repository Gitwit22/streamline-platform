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

// Canonical default role profiles shared by simple and advanced modes.
// This is the single authored source of default role permissions.
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
    permissions: perms({
      canStream: true,
      canRecord: true,
      canDestinations: true,
      canModerate: false,
      canLayout: true,
      canScreenShare: true,
      canInvite: true,
      canAnalytics: false,
      canMuteGuests: false,
      canRemoveGuests: false,
    }),
  },
  {
    id: "moderator",
    name: "Moderator",
    lockedName: true,
    isSystemDefault: true,
    permissions: perms({
      canStream: false,
      canRecord: false,
      canDestinations: false,
      canModerate: false,
      canLayout: true,
      canScreenShare: false,
      canInvite: false,
      canAnalytics: false,
      canMuteGuests: false,
      canRemoveGuests: false,
    }),
  },
  {
    id: "participant",
    name: "Participant",
    lockedName: true,
    isSystemDefault: true,
    permissions: perms({
      canStream: false,
      canRecord: false,
      canDestinations: false,
      canModerate: false,
      canLayout: false,
      canScreenShare: false,
      canInvite: false,
      canAnalytics: false,
      canMuteGuests: false,
      canRemoveGuests: false,
    }),
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
