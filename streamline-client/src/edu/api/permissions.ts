import { apiFetchAuth } from "../../lib/api";
import {
  type TeacherPermissions,
  coerceTeacherPermissions,
} from "../types/teacherPermissions";

/** Fetch the current permissions for a teacher (faculty_teacher) member. */
export async function getTeacherPermissions(memberId: string): Promise<TeacherPermissions> {
  const res = await apiFetchAuth(
    `/api/edu/people/${encodeURIComponent(memberId)}/permissions`,
  );
  const payload = (await res.json().catch(() => null)) as any;
  return coerceTeacherPermissions(payload?.permissions);
}

/** Update permissions for a teacher (faculty_teacher) member. */
export async function updateTeacherPermissions(
  memberId: string,
  permissions: TeacherPermissions,
): Promise<{ ok: boolean }> {
  const res = await apiFetchAuth(
    `/api/edu/people/${encodeURIComponent(memberId)}/permissions`,
    {
      method: "PATCH",
      body: JSON.stringify({ permissions }),
    },
  );
  const payload = (await res.json().catch(() => null)) as any;
  return { ok: payload?.ok === true };
}
