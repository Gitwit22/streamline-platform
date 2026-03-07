/**
 * initializeSchool — One-time initialization for a newly onboarded EDU school.
 *
 * Creates:
 *  - Default editable rooms (Morning Announcements, Teacher Meeting, Student Media Studio, Events Broadcast)
 *  - Default roles configuration
 *  - Default permissions mapping
 *  - Default embed settings stub
 *  - Audit trail entries for everything
 *
 * Does NOT create:
 *  - Fake staff / students / recordings / events (new schools start empty)
 *
 * Safety: This function is idempotent — if default rooms already exist for the org, it skips re-seeding.
 */

import admin from "firebase-admin";
import { tenantCol } from "./dbPaths";
import { writeEduAudit } from "./eduAudit";

/* ── Default Room Definitions ────────────────────────────────────── */

type DefaultRoom = {
  name: string;
  description: string;
  roomType: "meeting" | "broadcast" | "hybrid";
  broadcastEnabled: boolean;
  recordingEnabled: boolean;
  defaultLayout: "grid" | "speaker";
  allowedRoles: string[];
};

const DEFAULT_ROOMS: DefaultRoom[] = [
  {
    name: "Morning Announcements",
    description: "Daily school announcements broadcast room",
    roomType: "broadcast",
    broadcastEnabled: true,
    recordingEnabled: true,
    defaultLayout: "speaker",
    allowedRoles: ["faculty_admin", "student_producer", "student_producer_assigned"],
  },
  {
    name: "Teacher Meeting Room",
    description: "Private meeting space for faculty and staff",
    roomType: "meeting",
    broadcastEnabled: false,
    recordingEnabled: true,
    defaultLayout: "grid",
    allowedRoles: ["faculty_admin", "staff"],
  },
  {
    name: "Student Media Studio",
    description: "Student-run hybrid production studio",
    roomType: "hybrid",
    broadcastEnabled: true,
    recordingEnabled: true,
    defaultLayout: "grid",
    allowedRoles: ["faculty_admin", "student_producer", "student_producer_assigned", "talent"],
  },
  {
    name: "Events Broadcast Room",
    description: "Multi-purpose room for school events and assemblies",
    roomType: "broadcast",
    broadcastEnabled: true,
    recordingEnabled: true,
    defaultLayout: "speaker",
    allowedRoles: ["faculty_admin", "student_producer", "student_producer_assigned"],
  },
];

/* ── Default Roles ───────────────────────────────────────────────── */

const DEFAULT_ROLES = [
  { id: "faculty_admin", label: "Faculty Admin", description: "Full administrative access to the school platform" },
  { id: "staff", label: "Staff", description: "Faculty and staff with access to meetings and content" },
  { id: "student_viewer", label: "Student Viewer", description: "Students who can view broadcasts and recordings" },
  { id: "student_talent", label: "Student Talent", description: "Students who can appear on camera during broadcasts" },
  { id: "student_producer", label: "Student Producer", description: "Students who can operate broadcast equipment and manage productions" },
];

/* ── Default Permissions ─────────────────────────────────────────── */

const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  "room.access":          ["faculty_admin", "staff", "student_producer", "student_talent", "student_viewer"],
  "room.create":          ["faculty_admin"],
  "room.edit":            ["faculty_admin"],
  "room.delete":          ["faculty_admin"],
  "studio.access":        ["faculty_admin", "student_producer"],
  "studio.go_live":       ["faculty_admin", "student_producer"],
  "student.manage":       ["faculty_admin"],
  "staff.manage":         ["faculty_admin"],
  "school.settings":      ["faculty_admin"],
  "events.manage":        ["faculty_admin", "student_producer"],
  "events.view":          ["faculty_admin", "staff", "student_producer", "student_talent", "student_viewer"],
  "embeds.manage":        ["faculty_admin"],
  "recordings.view":      ["faculty_admin", "staff", "student_producer"],
  "recordings.delete":    ["faculty_admin"],
};

/* ── Main Initialization Function ────────────────────────────────── */

export interface InitializeSchoolInput {
  orgId: string;
  orgName: string;
  slug?: string;
  timezone?: string;
  foundingAdminUid: string;
  foundingAdminName: string;
}

export interface InitializeSchoolResult {
  ok: true;
  roomsCreated: number;
  alreadyInitialized: boolean;
}

export async function initializeSchool(input: InitializeSchoolInput): Promise<InitializeSchoolResult> {
  const { orgId, orgName, slug, timezone, foundingAdminUid, foundingAdminName } = input;
  const now = Date.now();

  // ── Idempotency: check if already initialized ──────────────────
  const orgRef = tenantCol("orgs").doc(orgId);
  const orgSnap = await orgRef.get().catch(() => null as any);
  const orgData = orgSnap?.exists ? (orgSnap.data() as any) : {};

  if (orgData?.initializationComplete === true) {
    return { ok: true, roomsCreated: 0, alreadyInitialized: true };
  }

  // Also check if rooms already exist to prevent duplicate seeding
  const existingRooms = await tenantCol("rooms")
    .where("orgId", "==", orgId)
    .limit(1)
    .get()
    .catch(() => null as any);

  const hasRooms = existingRooms?.docs?.length > 0;

  // ── Create default rooms ───────────────────────────────────────
  let roomsCreated = 0;
  if (!hasRooms) {
    const batch = admin.firestore().batch();

    for (const room of DEFAULT_ROOMS) {
      const roomRef = tenantCol("rooms").doc();
      batch.set(roomRef, {
        ...room,
        orgId,
        createdBy: foundingAdminUid,
        isLive: false,
        participantCount: 0,
        isDefault: true,
        editable: true,
        renameable: true,
        archivable: true,
        deletable: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      roomsCreated++;
    }

    await batch.commit();
  }

  // ── Create default roles config ────────────────────────────────
  await tenantCol("config").doc(`${orgId}_roles`).set({
    orgId,
    roles: DEFAULT_ROLES,
    updatedAt: now,
    createdAt: now,
  }, { merge: true }).catch(() => void 0);

  // ── Create default permissions ─────────────────────────────────
  await tenantCol("config").doc(`${orgId}_permissions`).set({
    orgId,
    permissions: DEFAULT_PERMISSIONS,
    updatedAt: now,
    createdAt: now,
  }, { merge: true }).catch(() => void 0);

  // ── Create default embed config ────────────────────────────────
  await tenantCol("config").doc(`${orgId}_embed`).set({
    orgId,
    embedEnabled: true,
    embedVisibility: "public",
    playerTitleText: orgName,
    accentColor: null,
    updatedAt: now,
    createdAt: now,
  }, { merge: true }).catch(() => void 0);

  // ── Update org doc with initialization flags ───────────────────
  const orgSlug = slug || orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);

  await orgRef.set({
    name: orgName,
    slug: orgSlug,
    status: "active",
    timezone: timezone || "America/New_York",
    plan: "edu_starter",
    planStatus: "active",
    branding: {
      logoDataUrl: null,
      accentColor: null,
      playerTitleText: orgName,
    },
    schoolPortalEnabled: true,
    onboardingComplete: true,
    initializationComplete: true,
    initializedAt: now,
    initializedByUid: foundingAdminUid,
    updatedAt: now,
  }, { merge: true });

  // ── Write audit log ────────────────────────────────────────────
  const auditEntries: Array<{ action: string; targetId?: string }> = [
    { action: "school.created", targetId: orgId },
    { action: "school.founding_admin_created", targetId: foundingAdminUid },
    { action: "school.default_rooms_created", targetId: `${roomsCreated}_rooms` },
    { action: "school.portal_enabled", targetId: orgId },
    { action: "school.initialization_complete", targetId: orgId },
  ];

  for (const entry of auditEntries) {
    await writeEduAudit({
      orgId,
      action: entry.action,
      actorUid: foundingAdminUid,
      actorName: foundingAdminName,
      targetId: entry.targetId || null,
    }).catch(() => void 0);
  }

  return { ok: true, roomsCreated, alreadyInitialized: false };
}
