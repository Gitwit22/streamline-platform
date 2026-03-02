import { apiFetchAuth } from "../../lib/api";

export type EduPersonRole = "faculty_admin" | "student_producer" | "student_producer_assigned" | "talent" | "viewer";
export type EduPersonStatus = "active" | "invited" | "disabled";

export type EduPerson = {
  id: string;
  name: string;
  email: string;
  role: EduPersonRole;
  status: EduPersonStatus;
  lastActiveAt: string | null;
  assignedEventsCount: number;
  assignedEventIds?: string[];
};

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function coerceRole(v: any): EduPersonRole {
  const r = asString(v).trim();
  if (r === "faculty_admin") return "faculty_admin";
  if (r === "student_producer") return "student_producer";
  if (r === "student_producer_assigned") return "student_producer_assigned";
  if (r === "talent") return "talent";
  return "viewer";
}

function coerceStatus(v: any): EduPersonStatus {
  const s = asString(v).trim();
  if (s === "invited") return "invited";
  if (s === "disabled") return "disabled";
  return "active";
}

function normalizePerson(x: any): EduPerson | null {
  const id = asString(x?.id).trim();
  if (!id) return null;
  return {
    id,
    name: asString(x?.name).trim(),
    email: asString(x?.email).trim(),
    role: coerceRole(x?.role),
    status: coerceStatus(x?.status),
    lastActiveAt: typeof x?.lastActiveAt === "string" ? x.lastActiveAt : null,
    assignedEventsCount: typeof x?.assignedEventsCount === "number" && Number.isFinite(x.assignedEventsCount) ? x.assignedEventsCount : 0,
    assignedEventIds: Array.isArray(x?.assignedEventIds)
      ? x.assignedEventIds.map((v: any) => asString(v).trim()).filter(Boolean)
      : [],
  };
}

export async function listEduPeopleFromApi(opts?: { limit?: number }): Promise<EduPerson[]> {
  const sp = new URLSearchParams();
  if (typeof opts?.limit === "number" && Number.isFinite(opts.limit)) {
    sp.set("limit", String(Math.max(1, Math.min(200, Math.floor(opts.limit)))));
  }

  const res = await apiFetchAuth(`/api/edu/people${sp.toString() ? `?${sp.toString()}` : ""}`);
  const payload = (await res.json().catch(() => null)) as any;
  const items = Array.isArray(payload?.people) ? payload.people : [];
  return items.map(normalizePerson).filter(Boolean) as EduPerson[];
}

export async function inviteEduPerson(input: { email: string; role: Exclude<EduPersonRole, "faculty_admin">; assignEventId?: string | null }) {
  const res = await apiFetchAuth(`/api/edu/people/invite`, {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      role: input.role,
      assignEventId: input.assignEventId || "",
    }),
  });
  const payload = (await res.json().catch(() => null)) as any;
  return {
    ok: payload?.ok === true,
    person: normalizePerson(payload?.person),
  };
}

export async function setEduPersonRole(memberId: string, role: EduPersonRole) {
  const res = await apiFetchAuth(`/api/edu/people/${encodeURIComponent(memberId)}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
  const payload = (await res.json().catch(() => null)) as any;
  return {
    ok: payload?.ok === true,
    person: normalizePerson(payload?.person),
  };
}

export async function disableEduPerson(memberId: string) {
  const res = await apiFetchAuth(`/api/edu/people/${encodeURIComponent(memberId)}/disable`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const payload = (await res.json().catch(() => null)) as any;
  return {
    ok: payload?.ok === true,
    person: normalizePerson(payload?.person),
  };
}

export async function resendEduInvite(memberId: string) {
  const res = await apiFetchAuth(`/api/edu/people/${encodeURIComponent(memberId)}/resend`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const payload = (await res.json().catch(() => null)) as any;
  return {
    ok: payload?.ok === true,
    person: normalizePerson(payload?.person),
  };
}
