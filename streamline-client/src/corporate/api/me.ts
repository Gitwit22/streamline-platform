import { apiFetchAuth } from "@/lib/api";

export interface CorporateMe {
  id: string;
  uid: string;
  email: string;
  name: string;
  displayName: string;
  role: string;
  orgRole: string;
  orgType: "corporate";
  orgId: string;
  orgName: string;
  permissions: string[];
  corporateAccountId: string;
  organizationId: string;
  corporateAccount: {
    id: string;
    name: string;
    status: string;
    planId: string;
  };
}

export async function fetchCorporateMe(): Promise<CorporateMe> {
  const res = await apiFetchAuth("/api/corporate/auth/me", undefined, {
    suppressAuthSideEffects: true,
    allowNonOk: true,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "corporate_me_failed");
  }
  const raw = await res.json();
  return {
    ...raw,
    uid: raw.id,
    displayName: raw.name,
    orgRole: raw.role,
    orgType: "corporate",
    orgId: raw.corporateAccountId,
    orgName: raw?.corporateAccount?.name || "Corporate Account",
  };
}
