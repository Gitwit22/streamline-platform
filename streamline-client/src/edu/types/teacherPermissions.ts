/* ── Teacher Permissions ─────────────────────────────────────────
   Granular permissions for faculty_teacher accounts.
   Admins (faculty_admin) always have all permissions implicitly.
   Students never have these permissions.
   ────────────────────────────────────────────────────────────── */

export interface TeacherPermissions {
  /* Broadcast */
  canGoLive: boolean;
  canUseBroadcastStudio: boolean;

  /* Event Management */
  canManageOwnEvents: boolean;
  canManageAllEvents: boolean;

  /* Student Management */
  canAddStudents: boolean;
  canRemoveStudents: boolean;
  canResetStudentPasswords: boolean;

  /* Media */
  canUploadMedia: boolean;
  canManageMediaLibrary: boolean;

  /* Communication */
  canUseFacultyChat: boolean;
  canUseVideoCalls: boolean;

  /* Administration */
  canManageRooms: boolean;
  canUseWebsiteEmbed: boolean;
  canAccessSchoolSettings: boolean;
  canManageFaculty: boolean;
  canInviteFaculty: boolean;
  canRemoveFaculty: boolean;
}

/** All permission keys */
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

/** Default permissions assigned to newly-created teachers */
export const DEFAULT_TEACHER_PERMISSIONS: TeacherPermissions = {
  /* Broadcast */
  canGoLive: true,
  canUseBroadcastStudio: true,

  /* Event Management */
  canManageOwnEvents: true,
  canManageAllEvents: false,

  /* Student Management */
  canAddStudents: true,
  canRemoveStudents: true,
  canResetStudentPasswords: true,

  /* Media */
  canUploadMedia: true,
  canManageMediaLibrary: false,

  /* Communication */
  canUseFacultyChat: true,
  canUseVideoCalls: true,

  /* Administration */
  canManageRooms: false,
  canUseWebsiteEmbed: false,
  canAccessSchoolSettings: false,
  canManageFaculty: false,
  canInviteFaculty: false,
  canRemoveFaculty: false,
};

/* ── Permission Groups (for UI rendering) ───────────────────── */

export interface PermissionGroup {
  id: string;
  label: string;
  parentLabel: string;
  keys: (keyof TeacherPermissions)[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: "broadcast",
    label: "Broadcast",
    parentLabel: "Broadcast Access",
    keys: ["canGoLive", "canUseBroadcastStudio"],
  },
  {
    id: "events",
    label: "Event Management",
    parentLabel: "Event Management",
    keys: ["canManageOwnEvents", "canManageAllEvents"],
  },
  {
    id: "students",
    label: "Student Management",
    parentLabel: "Student Management",
    keys: ["canAddStudents", "canRemoveStudents", "canResetStudentPasswords"],
  },
  {
    id: "media",
    label: "Media",
    parentLabel: "Media Access",
    keys: ["canUploadMedia", "canManageMediaLibrary"],
  },
  {
    id: "communication",
    label: "Communication",
    parentLabel: "Communication Tools",
    keys: ["canUseFacultyChat", "canUseVideoCalls"],
  },
  {
    id: "administration",
    label: "Administration",
    parentLabel: "Administrative Access",
    keys: ["canManageRooms", "canUseWebsiteEmbed", "canAccessSchoolSettings", "canManageFaculty", "canInviteFaculty", "canRemoveFaculty"],
  },
];

/** Human-readable labels for each permission key */
export const PERMISSION_LABELS: Record<keyof TeacherPermissions, string> = {
  canGoLive: "Go Live",
  canUseBroadcastStudio: "Use Broadcast Studio",
  canManageOwnEvents: "Manage Own Events",
  canManageAllEvents: "Manage All Events",
  canAddStudents: "Add Students",
  canRemoveStudents: "Remove Students",
  canResetStudentPasswords: "Reset Student Passwords",
  canUploadMedia: "Upload Media",
  canManageMediaLibrary: "Manage Media Library",
  canUseFacultyChat: "Use Faculty Chat",
  canUseVideoCalls: "Use Video Calls",
  canManageRooms: "Manage Rooms",
  canUseWebsiteEmbed: "Use Website Embed",
  canAccessSchoolSettings: "Access School Settings",
  canManageFaculty: "Manage Faculty",
  canInviteFaculty: "Invite Faculty",
  canRemoveFaculty: "Remove Faculty",
};

/** Coerce raw Firestore data into a safe TeacherPermissions object */
export function coerceTeacherPermissions(raw: any): TeacherPermissions {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_TEACHER_PERMISSIONS };
  const result: any = {};
  for (const key of TEACHER_PERMISSION_KEYS) {
    result[key] = typeof raw[key] === "boolean" ? raw[key] : DEFAULT_TEACHER_PERMISSIONS[key];
  }
  return result as TeacherPermissions;
}
