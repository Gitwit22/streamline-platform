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

export async function fetchCorporateMe(): Promise<CorporateMe> {
  const res = await apiFetchAuth("/api/corp/me");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "corporate_me_failed");
  }
  return res.json();
}
