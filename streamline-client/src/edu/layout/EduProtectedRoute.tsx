import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getAuthToken } from "../../lib/api";
import { fetchEduMe, type EduMe } from "../api/me";
import { isEduBypassEnabled, setEduLane } from "../state/eduMode";

type EduAuthState = {
  me: EduMe;
};

const EduAuthContext = createContext<EduAuthState | null>(null);

export function useEduMe() {
  const ctx = useContext(EduAuthContext);
  return ctx?.me || null;
}

export default function EduProtectedRoute({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const [me, setMe] = useState<EduMe | null>(null);
  const [loading, setLoading] = useState(true);

  const authed = useMemo(() => {
    if (isEduBypassEnabled()) return true;
    try {
      return !!getAuthToken();
    } catch {
      return false;
    }
  }, [loc.key]);

  useEffect(() => {
    setEduLane();

    if (!authed) {
      setMe(null);
      setLoading(false);
      return;
    }

    if (isEduBypassEnabled()) {
      setMe({
        uid: "edu-demo",
        orgType: "edu",
        role: "faculty_admin",
        orgRole: "faculty_admin",
        orgName: "EDU Demo",
      });
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    fetchEduMe()
      .then((data) => {
        if (!mounted) return;
        setMe(data);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setMe(null);
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [authed]);

  if (loading) {
    return <div className="min-h-screen bg-slate-950 p-6 text-slate-300">Loading…</div>;
  }

  if (!me) {
    const sp = new URLSearchParams();
    sp.set("returnTo", `${loc.pathname}${loc.search}`);
    return <Navigate to={`/streamline/edu/login?${sp.toString()}`} replace />;
  }

  const eduAllowed = me.orgType === "edu";
  if (!eduAllowed) {
    return <Navigate to="/join" replace />;
  }

  return <EduAuthContext.Provider value={{ me }}>{children}</EduAuthContext.Provider>;
}
