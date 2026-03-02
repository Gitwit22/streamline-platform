import { getMeCached } from "../../lib/meCache";

export type EduMe = {
  uid: string;
  orgType?: string | null;
  role?: string | null;
  orgRole?: string | null;
  orgName?: string | null;
  orgId?: string | null;
  [k: string]: any;
};

export async function fetchEduMe(): Promise<EduMe | null> {
  const me = await getMeCached();
  if (!me) return null;

  const uid = String((me as any).uid || (me as any).id || "").trim();
  return {
    ...(me as any),
    uid: uid || "unknown",
    orgType: (me as any).orgType ?? null,
    orgRole: (me as any).orgRole ?? (me as any).role ?? null,
    role: (me as any).orgRole ?? (me as any).role ?? null,
    orgName: (me as any).orgName ?? null,
    orgId: (me as any).orgId ?? null,
  };
}
