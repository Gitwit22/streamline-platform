/**
 * EDU Demo Data — "Detroit Demo District"
 *
 * Provides realistic sandbox data for demo mode.
 * All data is ephemeral and resets when the session ends.
 */

/* ── Types ────────────────────────────────────────────────────── */

export type DemoSchool = {
  id: string;
  name: string;
  district: string;
  city: string;
  state: string;
  type: "high_school" | "k12" | "district_office";
};

export type DemoUser = {
  id: string;
  name: string;
  email: string;
  role: "school_admin" | "teacher" | "student_media" | "student";
  /** maps to existing EDU org roles */
  orgRole: "faculty_admin" | "student_producer" | "talent" | "viewer";
  department: string | null;
  avatar: string | null;
};

export type DemoRoom = {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  isLive: boolean;
  participantCount: number;
};

export type DemoBroadcast = {
  id: string;
  title: string;
  roomId: string;
  status: "live" | "ended" | "scheduled";
  startedAt: string;
  endedAt: string | null;
  viewers: number;
};

export type DemoRecording = {
  id: string;
  title: string;
  duration: string;
  durationSec: number;
  date: string;
  status: "ready" | "processing";
  roomId: string;
};

export type DemoStudent = {
  id: string;
  name: string;
  email: string;
  grade: string;
  role: "student" | "student_media";
  mediaClub: boolean;
};

/* ── District ──────────────────────────────────────────────────── */

export const DEMO_DISTRICT: { name: string; schools: DemoSchool[] } = {
  name: "Detroit Demo District",
  schools: [
    {
      id: "school_central",
      name: "Detroit Central High School",
      district: "Detroit Demo District",
      city: "Detroit",
      state: "MI",
      type: "high_school",
    },
    {
      id: "school_east",
      name: "East Tech Academy",
      district: "Detroit Demo District",
      city: "Detroit",
      state: "MI",
      type: "high_school",
    },
  ],
};

/* ── Users ─────────────────────────────────────────────────────── */

export const DEMO_USERS: DemoUser[] = [
  {
    id: "user_principal",
    name: "Principal Johnson",
    email: "principal@centralhs.edu",
    role: "school_admin",
    orgRole: "faculty_admin",
    department: "Administration",
    avatar: null,
  },
  {
    id: "user_carter",
    name: "Mr. Carter",
    email: "carter@centralhs.edu",
    role: "teacher",
    orgRole: "faculty_admin",
    department: "Media Arts",
    avatar: null,
  },
  {
    id: "user_media1",
    name: "Jake Thompson",
    email: "jake.t@student.centralhs.edu",
    role: "student_media",
    orgRole: "student_producer",
    department: "Media Club",
    avatar: null,
  },
  {
    id: "user_media2",
    name: "Emily Chen",
    email: "emily.c@student.centralhs.edu",
    role: "student_media",
    orgRole: "student_producer",
    department: "Media Club",
    avatar: null,
  },
  {
    id: "user_talent1",
    name: "Marcus Johnson",
    email: "marcus.j@student.centralhs.edu",
    role: "student_media",
    orgRole: "talent",
    department: "Drama",
    avatar: null,
  },
  {
    id: "user_student1",
    name: "Sofia Patel",
    email: "sofia.p@student.centralhs.edu",
    role: "student",
    orgRole: "viewer",
    department: null,
    avatar: null,
  },
  {
    id: "user_student2",
    name: "Liam O'Brien",
    email: "liam.o@student.centralhs.edu",
    role: "student",
    orgRole: "viewer",
    department: null,
    avatar: null,
  },
];

/* ── Rooms ─────────────────────────────────────────────────────── */

export const DEMO_ROOMS: DemoRoom[] = [
  {
    id: "room_announcements",
    name: "Morning Announcements",
    description: "Daily school-wide announcements broadcast.",
    createdBy: "user_principal",
    isLive: false,
    participantCount: 0,
  },
  {
    id: "room_media_studio",
    name: "Student Media Studio",
    description: "Media Club production room for student-led broadcasts.",
    createdBy: "user_carter",
    isLive: false,
    participantCount: 0,
  },
  {
    id: "room_teacher_meeting",
    name: "Teacher Meeting Room",
    description: "Staff meetings and professional development sessions.",
    createdBy: "user_principal",
    isLive: false,
    participantCount: 0,
  },
  {
    id: "room_football",
    name: "Football Game Broadcast",
    description: "Live coverage of school football games.",
    createdBy: "user_carter",
    isLive: false,
    participantCount: 0,
  },
  {
    id: "room_board",
    name: "Board Meetings",
    description: "School board meeting broadcast room.",
    createdBy: "user_principal",
    isLive: false,
    participantCount: 0,
  },
  {
    id: "room_classroom101",
    name: "Classroom 101",
    description: "Classroom broadcast channel.",
    createdBy: "user_carter",
    isLive: false,
    participantCount: 0,
  },
];

/* ── Broadcasts ────────────────────────────────────────────────── */

const now = Date.now();
const oneHour = 3600_000;
const oneDay = 86400_000;

export const DEMO_BROADCASTS: DemoBroadcast[] = [
  {
    id: "bcast_1",
    title: "Morning Announcements - Today",
    roomId: "room_announcements",
    status: "ended",
    startedAt: new Date(now - 2 * oneHour).toISOString(),
    endedAt: new Date(now - 2 * oneHour + 12 * 60_000).toISOString(),
    viewers: 127,
  },
  {
    id: "bcast_2",
    title: "Basketball Game",
    roomId: "room_football",
    status: "ended",
    startedAt: new Date(now - 13 * oneDay).toISOString(),
    endedAt: new Date(now - 13 * oneDay + 2 * oneHour).toISOString(),
    viewers: 342,
  },
  {
    id: "bcast_3",
    title: "Board Meeting",
    roomId: "room_board",
    status: "ended",
    startedAt: new Date(now - 15 * oneDay).toISOString(),
    endedAt: new Date(now - 15 * oneDay + 90 * 60_000).toISOString(),
    viewers: 89,
  },
  {
    id: "bcast_4",
    title: "Media Club Show - Episode 12",
    roomId: "room_media_studio",
    status: "ended",
    startedAt: new Date(now - 3 * oneDay).toISOString(),
    endedAt: new Date(now - 3 * oneDay + 45 * 60_000).toISOString(),
    viewers: 203,
  },
];

/* ── Recordings ────────────────────────────────────────────────── */

export const DEMO_RECORDINGS: DemoRecording[] = [
  {
    id: "rec_1",
    title: "Morning Announcements - Today",
    duration: "12:34",
    durationSec: 754,
    date: new Date(now - 2 * oneHour).toISOString(),
    status: "ready",
    roomId: "room_announcements",
  },
  {
    id: "rec_2",
    title: "Basketball Game - Feb 20",
    duration: "2:01:15",
    durationSec: 7275,
    date: new Date(now - 13 * oneDay).toISOString(),
    status: "ready",
    roomId: "room_football",
  },
  {
    id: "rec_3",
    title: "Board Meeting - Feb 18",
    duration: "1:28:45",
    durationSec: 5325,
    date: new Date(now - 15 * oneDay).toISOString(),
    status: "ready",
    roomId: "room_board",
  },
  {
    id: "rec_4",
    title: "Media Club Show - Episode 12",
    duration: "45:12",
    durationSec: 2712,
    date: new Date(now - 3 * oneDay).toISOString(),
    status: "ready",
    roomId: "room_media_studio",
  },
  {
    id: "rec_5",
    title: "Principal Address",
    duration: "8:45",
    durationSec: 525,
    date: new Date(now - 5 * oneDay).toISOString(),
    status: "ready",
    roomId: "room_announcements",
  },
  {
    id: "rec_6",
    title: "Fall Play - Act 1",
    duration: "1:23:45",
    durationSec: 5025,
    date: new Date(now - 20 * oneDay).toISOString(),
    status: "ready",
    roomId: "room_media_studio",
  },
];

/* ── Students ──────────────────────────────────────────────────── */

export const DEMO_STUDENTS: DemoStudent[] = [
  { id: "stu_1", name: "Jake Thompson", email: "jake.t@student.centralhs.edu", grade: "11", role: "student_media", mediaClub: true },
  { id: "stu_2", name: "Emily Chen", email: "emily.c@student.centralhs.edu", grade: "12", role: "student_media", mediaClub: true },
  { id: "stu_3", name: "Marcus Johnson", email: "marcus.j@student.centralhs.edu", grade: "11", role: "student_media", mediaClub: true },
  { id: "stu_4", name: "Sofia Patel", email: "sofia.p@student.centralhs.edu", grade: "10", role: "student", mediaClub: false },
  { id: "stu_5", name: "Liam O'Brien", email: "liam.o@student.centralhs.edu", grade: "9", role: "student", mediaClub: false },
  { id: "stu_6", name: "Ava Martinez", email: "ava.m@student.centralhs.edu", grade: "10", role: "student", mediaClub: false },
  { id: "stu_7", name: "Noah Williams", email: "noah.w@student.centralhs.edu", grade: "12", role: "student_media", mediaClub: true },
  { id: "stu_8", name: "Isabella Rodriguez", email: "isabella.r@student.centralhs.edu", grade: "9", role: "student", mediaClub: false },
  { id: "stu_9", name: "Ethan Davis", email: "ethan.d@student.centralhs.edu", grade: "11", role: "student", mediaClub: false },
  { id: "stu_10", name: "Mia Jackson", email: "mia.j@student.centralhs.edu", grade: "10", role: "student_media", mediaClub: true },
];

/* ── Helpers ───────────────────────────────────────────────────── */

export function getDemoSchool(): DemoSchool {
  return DEMO_DISTRICT.schools[0];
}

export function getDemoOrgName(): string {
  return DEMO_DISTRICT.schools[0].name;
}
