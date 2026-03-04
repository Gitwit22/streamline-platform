import { apiFetchAuth } from "@/lib/api";

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
