import { apiFetchAuth } from "@/lib/api";

export type CorpRole = "leader" | "employee" | "external";

export interface CorporateMe {
  uid: string;
  orgType: "corporate";
  orgId: string;
  orgName: string;
  role: string;
  orgRole: string;
  displayName: string;
  email: string;
}

/** Helper: true when the user has the "leader" role */
export function isCorporateLeader(me: CorporateMe | null): boolean {
  return me?.orgRole === "leader";
}

/** Sentinel returned when user is authenticated but has no org yet. */
export interface CorporateNeedsOrg {
  needsOrg: true;
  uid: string;
}

export type CorporateMeResult = CorporateMe | CorporateNeedsOrg;

export function isNeedsOrg(result: CorporateMeResult): result is CorporateNeedsOrg {
  return "needsOrg" in result && (result as any).needsOrg === true;
}

export async function fetchCorporateMe(): Promise<CorporateMeResult> {
  const res = await apiFetchAuth("/api/corp/me");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "corporate_me_failed");
  }
  return res.json();
}
