/**
 * seed-edu-test-school.ts
 *
 * Seeds a real internal test school tenant for EDU QA, development, and demos.
 * Replaces reliance on demo-mode-first behaviour with a production-like school.
 *
 * Usage (CLI):
 *   npx tsx scripts/seed-edu-test-school.ts --adminEmail admin@example.com
 *
 * Usage (API — requires MAINTENANCE_KEY):
 *   POST /api/maintenance/edu/seed-test-school
 *   { "adminEmail": "admin@example.com" }
 *
 * What it creates:
 *   • Org: "StreamLine EDU Test School" (orgType=edu, slug=streamline-test-school)
 *   • Faculty admin membership for --adminEmail
 *   • 4 rooms: Morning Announcements, Teacher Meeting Room, Football Broadcast, Media Club Studio
 *   • 2 additional staff members (pending activation)
 *   • 5 student accounts with initial passwords
 *   • 3 example events
 *   • Org settings (branding defaults, embed visibility)
 *
 * This is idempotent — re-running will merge/update, not duplicate.
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import admin from "firebase-admin";
import { firestore } from "../firebaseAdmin";
import { tenantCol, globalCol } from "../lib/dbPaths";
import { buildNewUserDoc } from "../lib/newUserDefaults";

/* ── Constants ─────────────────────────────────────────────────── */

export const TEST_SCHOOL_ORG_ID = "edu-test-school-001";
export const TEST_SCHOOL_SLUG = "streamline-test-school";
export const TEST_SCHOOL_SHORT_CODE = "STS";
export const TEST_SCHOOL_NAME = "StreamLine EDU Test School";
export const TEST_SCHOOL_DISTRICT = "StreamLine Demo District";

/* ── Helpers ───────────────────────────────────────────────────── */

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function coerceEmail(value: any): string | null {
  const email = asString(value).trim().toLowerCase();
  if (!email) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
}

function getArg(name: string): string | null {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return null;
  return process.argv[idx + 1] ? String(process.argv[idx + 1]) : null;
}

/* ── Rooms ─────────────────────────────────────────────────────── */

const SEED_ROOMS = [
  {
    id: `${TEST_SCHOOL_ORG_ID}_room_announcements`,
    name: "Morning Announcements",
    description: "Daily school-wide announcements broadcast.",
    roomType: "broadcast" as const,
    broadcastEnabled: true,
    recordingEnabled: true,
    defaultLayout: "speaker" as const,
    allowedRoles: ["faculty_admin", "student_producer", "talent"],
  },
  {
    id: `${TEST_SCHOOL_ORG_ID}_room_teacher_meeting`,
    name: "Teacher Meeting Room",
    description: "Staff meetings and professional development sessions.",
    roomType: "meeting" as const,
    broadcastEnabled: false,
    recordingEnabled: false,
    defaultLayout: "grid" as const,
    allowedRoles: ["faculty_admin"],
  },
  {
    id: `${TEST_SCHOOL_ORG_ID}_room_football`,
    name: "Football Broadcast",
    description: "Live coverage of school football games.",
    roomType: "broadcast" as const,
    broadcastEnabled: true,
    recordingEnabled: true,
    defaultLayout: "custom" as const,
    allowedRoles: ["faculty_admin", "student_producer", "talent"],
  },
  {
    id: `${TEST_SCHOOL_ORG_ID}_room_media_club`,
    name: "Media Club Studio",
    description: "Media Club production room for student-led broadcasts.",
    roomType: "hybrid" as const,
    broadcastEnabled: true,
    recordingEnabled: true,
    defaultLayout: "grid" as const,
    allowedRoles: ["faculty_admin", "student_producer"],
  },
];

/* ── Staff (pending activation records) ────────────────────────── */

const SEED_PENDING_STAFF = [
  {
    id: `${TEST_SCHOOL_ORG_ID}_staff_carter`,
    fullName: "Mr. Carter",
    role: "faculty_admin" as const,
    positionTitle: "Media Arts Teacher",
    email: "carter@streamline-test.edu",
    onboardingCode: "CARTER-2026",
  },
  {
    id: `${TEST_SCHOOL_ORG_ID}_staff_brooks`,
    fullName: "Ms. Brooks",
    role: "faculty_admin" as const,
    positionTitle: "Athletic Director",
    email: "brooks@streamline-test.edu",
    onboardingCode: "BROOKS-2026",
  },
];

/* ── Students ──────────────────────────────────────────────────── */

const SEED_STUDENTS = [
  {
    id: `${TEST_SCHOOL_ORG_ID}_student_jake`,
    fullName: "Jake Thompson",
    username: "jake.t",
    grade: "11",
    classHomeroom: "Room 204",
    role: "student_producer" as const,
    mediaClubMember: true,
  },
  {
    id: `${TEST_SCHOOL_ORG_ID}_student_emily`,
    fullName: "Emily Chen",
    username: "emily.c",
    grade: "12",
    classHomeroom: "Room 118",
    role: "student_producer" as const,
    mediaClubMember: true,
  },
  {
    id: `${TEST_SCHOOL_ORG_ID}_student_marcus`,
    fullName: "Marcus Johnson",
    username: "marcus.j",
    grade: "11",
    classHomeroom: "Room 204",
    role: "talent" as const,
    mediaClubMember: true,
  },
  {
    id: `${TEST_SCHOOL_ORG_ID}_student_sofia`,
    fullName: "Sofia Patel",
    username: "sofia.p",
    grade: "10",
    classHomeroom: "Room 312",
    role: "viewer" as const,
    mediaClubMember: false,
  },
  {
    id: `${TEST_SCHOOL_ORG_ID}_student_liam`,
    fullName: "Liam O'Brien",
    username: "liam.o",
    grade: "9",
    classHomeroom: "Room 105",
    role: "viewer" as const,
    mediaClubMember: false,
  },
];

/* ── Events ────────────────────────────────────────────────────── */

function futureDate(daysFromNow: number, hour: number, minute = 0): number {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

const SEED_EVENTS = [
  {
    id: `${TEST_SCHOOL_ORG_ID}_event_announcements_tomorrow`,
    title: "Morning Announcements",
    description: "Daily school-wide morning announcements broadcast.",
    scheduledStartAt: futureDate(1, 7, 45),
    durationMinutes: 15,
    roomId: `${TEST_SCHOOL_ORG_ID}_room_announcements`,
    status: "scheduled" as const,
    producerName: "Jake Thompson",
    isRecurring: true,
  },
  {
    id: `${TEST_SCHOOL_ORG_ID}_event_football_friday`,
    title: "Friday Night Football",
    description: "Live broadcast of the varsity football game.",
    scheduledStartAt: futureDate(5, 19, 0),
    durationMinutes: 180,
    roomId: `${TEST_SCHOOL_ORG_ID}_room_football`,
    status: "scheduled" as const,
    producerName: "Emily Chen",
    isRecurring: false,
  },
  {
    id: `${TEST_SCHOOL_ORG_ID}_event_media_club_show`,
    title: "Media Club Show - Episode 13",
    description: "Weekly student-produced news show.",
    scheduledStartAt: futureDate(3, 14, 30),
    durationMinutes: 30,
    roomId: `${TEST_SCHOOL_ORG_ID}_room_media_club`,
    status: "scheduled" as const,
    producerName: "Marcus Johnson",
    isRecurring: true,
  },
];

/* ── Example Recordings (metadata-only) ────────────────────────── */

const SEED_RECORDINGS = [
  {
    id: `${TEST_SCHOOL_ORG_ID}_rec_announcements_yesterday`,
    title: "Morning Announcements - Yesterday",
    durationSec: 754,
    roomId: `${TEST_SCHOOL_ORG_ID}_room_announcements`,
    status: "ready" as const,
    recordedAt: Date.now() - 86400_000,
  },
  {
    id: `${TEST_SCHOOL_ORG_ID}_rec_media_club_ep12`,
    title: "Media Club Show - Episode 12",
    durationSec: 2712,
    roomId: `${TEST_SCHOOL_ORG_ID}_room_media_club`,
    status: "ready" as const,
    recordedAt: Date.now() - 3 * 86400_000,
  },
  {
    id: `${TEST_SCHOOL_ORG_ID}_rec_football_last_game`,
    title: "Football Game - Last Week",
    durationSec: 7275,
    roomId: `${TEST_SCHOOL_ORG_ID}_room_football`,
    status: "ready" as const,
    recordedAt: Date.now() - 7 * 86400_000,
  },
];

/* ── Main Seed Function ────────────────────────────────────────── */

export interface SeedResult {
  ok: true;
  orgId: string;
  orgName: string;
  slug: string;
  adminUid: string | null;
  adminEmail: string;
  rooms: number;
  pendingStaff: number;
  students: number;
  events: number;
  recordings: number;
}

export async function seedEduTestSchool(adminEmail: string): Promise<SeedResult> {
  const email = coerceEmail(adminEmail);
  if (!email) throw new Error("Invalid adminEmail");

  const now = Date.now();
  const orgId = TEST_SCHOOL_ORG_ID;
  const defaultPassword = "Changeme1!";
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  /* ── 1. Create/update org ─────────────────────────────── */
  await tenantCol("orgs").doc(orgId).set(
    {
      id: orgId,
      name: TEST_SCHOOL_NAME,
      slug: TEST_SCHOOL_SLUG,
      shortCode: TEST_SCHOOL_SHORT_CODE,
      orgType: "edu",
      isDemo: false,
      isTestSchool: true,
      district: TEST_SCHOOL_DISTRICT,
      city: "Detroit",
      state: "MI",
      schoolType: "high_school",
      contactEmail: email,
      primaryContactEmail: email,
      status: "active",
      onboardingStep: 5,
      onboardingCompletedAt: now,
      branding: {
        logoDataUrl: null,
        accentColor: "#f97316",
        playerTitleText: TEST_SCHOOL_NAME,
      },
      defaults: {
        publishToWebsite: true,
        recordToArchive: true,
        defaultLayout: "grid",
        studentProducersCanStart: true,
        requireAssignmentToStart: false,
      },
      accessPolicy: {
        embedVisibility: "public",
      },
      retentionDays: null,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  );

  console.log(`[seed] ✓ Org created: ${TEST_SCHOOL_NAME} (${orgId})`);

  /* ── 2. Link admin user ───────────────────────────────── */
  let adminUid: string | null = null;
  const userSnap = await globalCol("users").where("email", "==", email).limit(1).get();

  if (!userSnap.empty) {
    const userDoc = userSnap.docs[0];
    adminUid = userDoc.id;

    await globalCol("users").doc(adminUid).set(
      {
        orgId,
        orgType: "edu",
        orgName: TEST_SCHOOL_NAME,
        orgRole: "faculty_admin",
        updatedAt: now,
      },
      { merge: true },
    );

    const memberId = `${orgId}_${adminUid}`;
    await tenantCol("orgMembers").doc(memberId).set(
      {
        orgId,
        uid: adminUid,
        email,
        name: userDoc.data()?.displayName || userDoc.data()?.name || "Admin",
        role: "faculty_admin",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );

    console.log(`[seed] ✓ Admin linked: ${email} (${adminUid})`);
  } else {
    console.warn(`[seed] ⚠ Admin user not found for ${email}. Sign up first, then re-run.`);
  }

  /* ── 3. Seed rooms ────────────────────────────────────── */
  for (const room of SEED_ROOMS) {
    await tenantCol("rooms").doc(room.id).set(
      {
        ...room,
        orgId,
        isLive: false,
        participantCount: 0,
        createdBy: adminUid || "seed",
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  }
  console.log(`[seed] ✓ Rooms seeded: ${SEED_ROOMS.length}`);

  /* ── 4. Seed pending staff ────────────────────────────── */
  for (const staff of SEED_PENDING_STAFF) {
    await tenantCol("pendingStaff").doc(staff.id).set(
      {
        ...staff,
        orgId,
        status: "pending",
        createdBy: adminUid || "seed",
        createdAt: now,
        usedAt: null,
      },
      { merge: true },
    );
  }
  console.log(`[seed] ✓ Pending staff seeded: ${SEED_PENDING_STAFF.length}`);

  /* ── 5. Seed students ─────────────────────────────────── */
  for (const student of SEED_STUDENTS) {
    await tenantCol("students").doc(student.id).set(
      {
        ...student,
        orgId,
        password: passwordHash,
        status: "active",
        mustChangePassword: true,
        createdBy: adminUid || "seed",
        createdAt: now,
        lastLoginAt: null,
      },
      { merge: true },
    );
  }
  console.log(`[seed] ✓ Students seeded: ${SEED_STUDENTS.length} (default password: ${defaultPassword})`);

  /* ── 6. Seed events ───────────────────────────────────── */
  for (const event of SEED_EVENTS) {
    await tenantCol("events").doc(event.id).set(
      {
        ...event,
        orgId,
        createdBy: adminUid || "seed",
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  }
  console.log(`[seed] ✓ Events seeded: ${SEED_EVENTS.length}`);

  /* ── 7. Seed recordings (metadata only) ───────────────── */
  for (const rec of SEED_RECORDINGS) {
    await tenantCol("recordings").doc(rec.id).set(
      {
        ...rec,
        orgId,
        createdBy: adminUid || "seed",
        createdAt: now,
      },
      { merge: true },
    );
  }
  console.log(`[seed] ✓ Recordings seeded: ${SEED_RECORDINGS.length}`);

  /* ── Done ─────────────────────────────────────────────── */
  const result: SeedResult = {
    ok: true,
    orgId,
    orgName: TEST_SCHOOL_NAME,
    slug: TEST_SCHOOL_SLUG,
    adminUid,
    adminEmail: email,
    rooms: SEED_ROOMS.length,
    pendingStaff: SEED_PENDING_STAFF.length,
    students: SEED_STUDENTS.length,
    events: SEED_EVENTS.length,
    recordings: SEED_RECORDINGS.length,
  };

  console.log("\n[seed] ✅ Test school seeded successfully:");
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n[seed] Portal URL: /streamline/edu/portal/${TEST_SCHOOL_SLUG}`);
  console.log(`[seed] Staff activation codes:`);
  for (const s of SEED_PENDING_STAFF) {
    console.log(`  ${s.fullName}: ${s.onboardingCode}`);
  }
  console.log(`[seed] Student default password: ${defaultPassword}`);

  return result;
}

/* ── CLI Entry Point ───────────────────────────────────────────── */

if (require.main === module || process.argv[1]?.includes("seed-edu-test-school")) {
  const adminEmail = getArg("adminEmail");
  if (!adminEmail) {
    console.error("Usage: npx tsx scripts/seed-edu-test-school.ts --adminEmail <email>");
    process.exit(1);
  }

  seedEduTestSchool(adminEmail)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[seed] Failed:", err);
      process.exit(99);
    });
}
