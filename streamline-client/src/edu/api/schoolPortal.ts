import { apiFetch } from "../../lib/api";

/* ── Types ──────────────────────────────────────────────────────── */

export type SchoolPublicInfo = {
  id: string;
  name: string;
  slug: string;
  shortCode: string;
  logoUrl: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  status: "active" | "inactive" | "pending";
};

export type PortalLoginResult = {
  ok: true;
  token: string;
  mustChangePassword?: boolean;
  role: string;
};

export type StaffActivationResult = {
  ok: true;
  token: string;
  userId: string;
  role: string;
};

export type PendingStaffRecord = {
  id: string;
  orgId: string;
  fullName: string;
  role: "faculty_admin" | "faculty_teacher" | "staff";
  positionTitle: string;
  email: string | null;
  onboardingCode: string;
  status: "pending" | "active" | "inactive";
  createdBy: string;
  createdAt: number;
  usedAt: number | null;
};

export type StudentRecord = {
  id: string;
  orgId: string;
  fullName: string;
  username: string;
  grade: string;
  classHomeroom: string;
  role: "student_producer" | "student_talent" | "student_viewer";
  mediaClubMember: boolean;
  status: "active" | "inactive";
  mustChangePassword: boolean;
  createdBy: string;
  createdAt: number;
  lastLoginAt: number | null;
};

/* ── School Lookup ──────────────────────────────────────────────── */

export async function lookupSchoolBySlug(slug: string): Promise<SchoolPublicInfo | null> {
  const res = await apiFetch(`/api/edu/portal/${encodeURIComponent(slug)}`, { method: "GET" }, { allowNonOk: true });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.school ?? null;
}

/* ── Portal Auth ────────────────────────────────────────────────── */

export async function portalLogin(slug: string, body: { username: string; password: string; accountType: "staff" | "student" }): Promise<PortalLoginResult> {
  const res = await apiFetch(`/api/edu/portal/${encodeURIComponent(slug)}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, { allowNonOk: true });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error || "Invalid credentials");
  }
  return res.json();
}

export async function portalChangePassword(slug: string, body: { username: string; currentPassword: string; newPassword: string }): Promise<{ ok: true }> {
  const res = await apiFetch(`/api/edu/portal/${encodeURIComponent(slug)}/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, { allowNonOk: true });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error || "Password change failed");
  }
  return res.json();
}

/* ── Student Activation (2-step) ─────────────────────────────────── */

export type StudentValidationResult = {
  ok: true;
  studentId: string;
  fullName: string;
};

export type StudentActivationResult = {
  ok: true;
  token: string;
  role: string;
};

/** Step 1 — check that the username exists & is eligible for activation */
export async function validateStudentForActivation(slug: string, username: string): Promise<StudentValidationResult> {
  const res = await apiFetch(`/api/edu/portal/${encodeURIComponent(slug)}/validate-student`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  }, { allowNonOk: true });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error || "Username not found or not eligible for activation.");
  }
  return res.json();
}

/** Step 2 — set password and activate the student account */
export async function activateStudentAccount(slug: string, body: {
  studentId: string;
  username: string;
  password: string;
  confirmPassword: string;
}): Promise<StudentActivationResult> {
  const res = await apiFetch(`/api/edu/portal/${encodeURIComponent(slug)}/activate-student`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, { allowNonOk: true });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error || "Activation failed");
  }
  return res.json();
}

/* ── Staff Activation ───────────────────────────────────────────── */

export async function activateStaffAccount(slug: string, body: {
  onboardingCode: string;
  fullName: string;
  username: string;
  password: string;
  confirmPassword: string;
  positionTitle: string;
}): Promise<StaffActivationResult> {
  const res = await apiFetch(`/api/edu/portal/${encodeURIComponent(slug)}/activate-staff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, { allowNonOk: true });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error || "Activation failed");
  }
  return res.json();
}

/* ── Staff Management (admin) ───────────────────────────────────── */

export async function fetchPendingStaff(): Promise<PendingStaffRecord[]> {
  const res = await apiFetch("/api/edu/staff", { method: "GET" });
  const data = await res.json();
  return data?.staff ?? [];
}

export async function createPendingStaff(body: {
  fullName: string;
  role: "faculty_admin" | "faculty_teacher";
  positionTitle: string;
  email?: string;
}): Promise<PendingStaffRecord> {
  const res = await apiFetch("/api/edu/staff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data?.staff ?? data;
}

export async function regenerateStaffCode(staffId: string): Promise<{ onboardingCode: string }> {
  const res = await apiFetch(`/api/edu/staff/${encodeURIComponent(staffId)}/regenerate-code`, { method: "POST" });
  return res.json();
}

export async function updateStaffStatus(staffId: string, status: "active" | "inactive"): Promise<PendingStaffRecord> {
  const res = await apiFetch(`/api/edu/staff/${encodeURIComponent(staffId)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const data = await res.json();
  return data?.staff ?? data;
}

/* ── Student Management (admin) ─────────────────────────────────── */

export async function fetchStudents(): Promise<StudentRecord[]> {
  const res = await apiFetch("/api/edu/students", { method: "GET" });
  const data = await res.json();
  return data?.students ?? [];
}

export async function createStudent(body: {
  fullName: string;
  grade: string;
  classHomeroom?: string;
  role: "student_producer" | "student_talent" | "student_viewer";
  mediaClubMember: boolean;
  username?: string;
}): Promise<{ student: StudentRecord; tempPassword: string }> {
  const res = await apiFetch("/api/edu/students", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function resetStudentPassword(studentId: string): Promise<{ tempPassword: string }> {
  const res = await apiFetch(`/api/edu/students/${encodeURIComponent(studentId)}/reset-password`, { method: "POST" });
  return res.json();
}

export async function updateStudentStatus(studentId: string, status: "active" | "inactive"): Promise<StudentRecord> {
  const res = await apiFetch(`/api/edu/students/${encodeURIComponent(studentId)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const data = await res.json();
  return data?.student ?? data;
}
