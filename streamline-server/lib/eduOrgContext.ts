import { firestore } from "../firebaseAdmin";

export type EduOrgRole =
  | "faculty_admin"
  | "student_producer"
  | "student_producer_assigned"
  | "talent"
  | "viewer";

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

export function coerceEduOrgRole(value: any): EduOrgRole | null {
  const r = asString(value).trim();
  if (r === "faculty_admin") return "faculty_admin";
  if (r === "student_producer") return "student_producer";
  if (r === "student_producer_assigned") return "student_producer_assigned";
  if (r === "talent") return "talent";
  if (r === "viewer") return "viewer";
  return null;
}

export type EduOrgSettings = {
  id: string;
  orgType: string | null;
  name: string | null;
  defaults: {
    publishToWebsite: boolean;
    recordToArchive: boolean;
    defaultLayout: "grid" | "speaker";
    studentProducersCanStart: boolean;
    requireAssignmentToStart: boolean;
  };
  accessPolicy: {
    embedVisibility: "public" | "unlisted";
  };
};

export async function loadEduOrgSettingsForUid(uid: string): Promise<
  | {
      orgId: string;
      orgRole: EduOrgRole | null;
      org: EduOrgSettings | null;
      userName: string | null;
    }
  | null
> {
  const userSnap = await firestore.collection("users").doc(uid).get().catch(() => null as any);
  const user = userSnap && userSnap.exists ? ((userSnap.data() as any) || {}) : null;
  if (!user) return null;

  const rawOrgId = user?.orgId ?? user?.org?.id ?? user?.org?.orgId;
  const orgId = typeof rawOrgId === "string" && rawOrgId.trim() ? rawOrgId.trim() : "";
  if (!orgId) return null;

  const memberId = `${orgId}_${uid}`;
  const memberSnap = await firestore.collection("orgMembers").doc(memberId).get().catch(() => null as any);
  const member = memberSnap && memberSnap.exists ? (memberSnap.data() as any) : null;
  const orgRole = coerceEduOrgRole(member?.role);

  const userName =
    typeof user?.name === "string"
      ? user.name
      : typeof user?.displayName === "string"
        ? user.displayName
        : typeof user?.email === "string"
          ? user.email
          : null;

  let org: EduOrgSettings | null = null;
  try {
    const orgSnap = await firestore.collection("orgs").doc(orgId).get();
    if (orgSnap.exists) {
      const data = (orgSnap.data() as any) || {};
      const orgType = typeof data.orgType === "string" ? data.orgType : null;
      const name = typeof data.name === "string" ? data.name : null;
      org = {
        id: orgId,
        orgType,
        name,
        defaults: {
          publishToWebsite: data?.defaults?.publishToWebsite !== false,
          recordToArchive: data?.defaults?.recordToArchive !== false,
          defaultLayout: data?.defaults?.defaultLayout === "speaker" ? "speaker" : "grid",
          studentProducersCanStart: data?.defaults?.studentProducersCanStart === true,
          requireAssignmentToStart: data?.defaults?.requireAssignmentToStart !== false,
        },
        accessPolicy: {
          embedVisibility: data?.accessPolicy?.embedVisibility === "unlisted" ? "unlisted" : "public",
        },
      };
    }
  } catch {
    // non-fatal
  }

  return { orgId, orgRole, org, userName };
}

export function isEduOrgType(orgType: string | null | undefined): boolean {
  const t = String(orgType || "").trim().toLowerCase();
  return t === "edu" || t.includes("edu");
}
