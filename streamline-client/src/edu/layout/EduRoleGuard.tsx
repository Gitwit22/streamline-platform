import { ReactNode } from "react";
import { useEduMe } from "./EduProtectedRoute";

export default function EduRoleGuard({ allow, children }: { allow: string[]; children: ReactNode }) {
  const me = useEduMe();

  if (!me) return null;

  const role = String(me.orgRole || me.role || "");
  if (!role || !allow.includes(role)) {
    return <div className="p-6 text-slate-300">You don’t have access to this page.</div>;
  }

  return <>{children}</>;
}
