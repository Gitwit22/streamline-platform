import { ReactNode, createContext, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getAuthToken } from "../../lib/api";
import { onFirebaseAuthStateChanged } from "../../lib/firebaseClient";
import { fetchEduMe, type EduMe } from "../api/me";
import { setEduLane } from "../state/eduMode";

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
  const [firebaseAuthed, setFirebaseAuthed] = useState(false);

  useEffect(() => {
    return onFirebaseAuthStateChanged((user) => {
      setFirebaseAuthed(!!user);
    });
  }, []);

  const authed = (() => {
    try {
      return !!getAuthToken() || firebaseAuthed;
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    setEduLane();

    if (!authed) {
      setMe(null);
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
    return <Navigate to={`/streamline/edu?${sp.toString()}`} replace />;
  }

  const eduAllowed = me.orgType === "edu";
  if (!eduAllowed) {
    // Send non-EDU users to their own lane, or fallback to EDU login.
    if (me.orgType === "corporate") {
      return <Navigate to="/streamline/corporate/dashboard" replace />;
    }
    // Fallback: EDU landing page
    return <Navigate to="/streamline/edu" replace />;
  }

  return <EduAuthContext.Provider value={{ me }}>{children}</EduAuthContext.Provider>;
}
