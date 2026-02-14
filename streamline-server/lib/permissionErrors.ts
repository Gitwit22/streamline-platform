// Canonical error codes for role/permission/auth enforcement (not plan/usage)
// Use these for RoomPermissionError and related permission checks

export const PERMISSION_ERRORS = {
  INVALID_ROOM: 'invalid_room',
  ROOM_NOT_FOUND: 'room_not_found',
  UNAUTHORIZED: 'unauthorized',
  ROOM_TOKEN_REQUIRED: 'room_token_required',
  INVALID_ROOM_TOKEN: 'invalid_room_token',
  LIVEKIT_ROOM_MISSING: 'livekit_room_missing',
  ROOM_MISMATCH: 'room_mismatch',
  INSUFFICIENT_PERMISSIONS: 'insufficient_permissions',
  NOT_ROOM_OWNER: 'not_room_owner',
  // Add more as needed for domain-specific permission errors
} as const;

export type PermissionErrorCode = typeof PERMISSION_ERRORS[keyof typeof PERMISSION_ERRORS];
