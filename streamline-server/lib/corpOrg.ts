import { firestore as db } from "../firebaseAdmin";

export type CorpOrgRole = "admin" | "manager" | "member" | "viewer";

export function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

export function coerceCorpRole(value: any): CorpOrgRole | null {
  const r = asString(value).trim();
  if (r === "admin") return "admin";
  if (r === "manager") return "manager";
  if (r === "member") return "member";
  if (r === "viewer") return "viewer";
  return null;
}

export function coerceEmail(value: any): string | null {
  const email = asString(value).trim().toLowerCase();
  if (!email) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
}

export function coerceMillis(value: any): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Date.parse(value);
    if (Number.isFinite(n)) return n;
  }
  if (value && typeof value === "object" && typeof value.toDate === "function") {
    try {
      const d = value.toDate();
      const n = d instanceof Date ? d.getTime() : NaN;
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  return null;
}

export type CorpOrgContext = {
  orgId: string;
  orgRole: CorpOrgRole | null;
  orgName: string;
};

/**
 * Resolves the corporate org context for a given user uid.
 * Reads from the `users` collection to find the orgId,
 * then looks up membership in `orgMembers` for the role.
 * Validates that the org is of type "corporate".
 */
export async function getCorpOrgContext(uid: string): Promise<CorpOrgContext | null> {
  /* ── Demo bypass ──────────────────────────────────────────────────── */
  if (uid === "corp-demo") {
    return {
      orgId: "corp-demo-org",
      orgRole: "admin",
      orgName: "StreamLine Corporate Demo",
    };
  }

  const userSnap = await db.collection("users").doc(uid).get().catch(() => null as any);
  const user = userSnap && userSnap.exists ? (userSnap.data() as any) : null;
  if (!user) return null;

  const rawOrgId = user?.orgId ?? user?.org?.id ?? user?.org?.orgId;
  const orgId = typeof rawOrgId === "string" && rawOrgId.trim() ? rawOrgId.trim() : "";
  if (!orgId) return null;

  // Verify org exists and is corporate type
  const orgSnap = await db.collection("orgs").doc(orgId).get().catch(() => null as any);
  const org = orgSnap && orgSnap.exists ? (orgSnap.data() as any) : null;
  if (!org) return null;
  // Allow both "corporate" and missing orgType (for dev/bypass scenarios)
  if (org.orgType && org.orgType !== "corporate") return null;

  const orgName = asString(org.name || "Corporate");

  const memberId = `${orgId}_${uid}`;
  const memberSnap = await db.collection("orgMembers").doc(memberId).get().catch(() => null as any);
  const member = memberSnap && memberSnap.exists ? (memberSnap.data() as any) : null;
  const orgRole = coerceCorpRole(member?.role);

  return { orgId, orgRole, orgName };
}

export function assertCorpRole(orgRole: CorpOrgRole | null, allow: CorpOrgRole[]): boolean {
  if (!orgRole) return false;
  return allow.includes(orgRole);
}
