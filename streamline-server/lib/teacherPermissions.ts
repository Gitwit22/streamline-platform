/* ── Teacher Permissions (server-side) ───────────────────────────
   Mirrors the client-side type.
   ────────────────────────────────────────────────────────────── */

export interface TeacherPermissions {
  canGoLive: boolean;
  canUseBroadcastStudio: boolean;
  canManageOwnEvents: boolean;
  canManageAllEvents: boolean;
  canAddStudents: boolean;
  canRemoveStudents: boolean;
  canResetStudentPasswords: boolean;
  canUploadMedia: boolean;
  canManageMediaLibrary: boolean;
  canUseFacultyChat: boolean;
  canUseVideoCalls: boolean;
  canManageRooms: boolean;
  canUseWebsiteEmbed: boolean;
  canAccessSchoolSettings: boolean;
  canManageFaculty: boolean;
  canInviteFaculty: boolean;
  canRemoveFaculty: boolean;
}

export const TEACHER_PERMISSION_KEYS: (keyof TeacherPermissions)[] = [
  "canGoLive",
  "canUseBroadcastStudio",
  "canManageOwnEvents",
  "canManageAllEvents",
  "canAddStudents",
  "canRemoveStudents",
  "canResetStudentPasswords",
  "canUploadMedia",
  "canManageMediaLibrary",
  "canUseFacultyChat",
  "canUseVideoCalls",
  "canManageRooms",
  "canUseWebsiteEmbed",
  "canAccessSchoolSettings",
  "canManageFaculty",
  "canInviteFaculty",
  "canRemoveFaculty",
];

export const DEFAULT_TEACHER_PERMISSIONS: TeacherPermissions = {
  canGoLive: true,
  canUseBroadcastStudio: true,
  canManageOwnEvents: true,
  canManageAllEvents: false,
  canAddStudents: true,
  canRemoveStudents: true,
  canResetStudentPasswords: true,
  canUploadMedia: true,
  canManageMediaLibrary: false,
  canUseFacultyChat: true,
  canUseVideoCalls: true,
  canManageRooms: false,
  canUseWebsiteEmbed: false,
  canAccessSchoolSettings: false,
  canManageFaculty: false,
  canInviteFaculty: false,
  canRemoveFaculty: false,
};

export function coerceTeacherPermissions(raw: any): TeacherPermissions {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_TEACHER_PERMISSIONS };
  const result: any = {};
  for (const key of TEACHER_PERMISSION_KEYS) {
    result[key] = typeof raw[key] === "boolean" ? raw[key] : DEFAULT_TEACHER_PERMISSIONS[key];
  }
  return result as TeacherPermissions;
}
