import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getAuthToken } from "../../lib/api";
import { onFirebaseAuthStateChanged } from "../../lib/firebaseClient";
import { isCorporateBypassEnabled, setCorporateLane } from "../state/corporateMode";
import { fetchCorporateMe, isNeedsOrg, type CorporateMe } from "../api/me";

export type { CorporateMe };

type CorporateAuthState = {
  me: CorporateMe;
};

const CorporateAuthContext = createContext<CorporateAuthState | null>(null);

export function useCorporateMe() {
  const ctx = useContext(CorporateAuthContext);
  return ctx?.me || null;
}

export default function CorporateProtectedRoute({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const [me, setMe] = useState<CorporateMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [firebaseAuthed, setFirebaseAuthed] = useState(false);
  const [needsOrg, setNeedsOrg] = useState(false);

  useEffect(() => {
    return onFirebaseAuthStateChanged((user) => {
      setFirebaseAuthed(!!user);
    });
  }, []);

  const authed = useMemo(() => {
    if (isCorporateBypassEnabled()) return true;
    try {
      return !!getAuthToken() || firebaseAuthed;
    } catch {
      return false;
    }
  }, [loc.key, firebaseAuthed]);

  useEffect(() => {
    setCorporateLane();

    if (!authed) {
      setMe(null);
      setLoading(false);
      return;
    }

    if (isCorporateBypassEnabled()) {
      setMe({
        uid: "corp-demo",
        orgType: "corporate",
        role: "admin",
        orgRole: "admin",
        orgName: "StreamLine Corporate HQ",
        displayName: "Demo Admin",
        email: "demo@streamline.corp",
        orgId: "demo-org",
      });
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    setNeedsOrg(false);
    fetchCorporateMe()
      .then((data) => {
        if (!mounted) return;
        if (isNeedsOrg(data)) {
          setMe(null);
          setNeedsOrg(true);
        } else {
          setMe(data);
        }
        setLoading(false);
      })
      .catch(() => {
        if (mounted) {
          setMe(null);
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [authed]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(218 50% 6%)", color: "hsl(216 40% 93%)" }}>
        Loading…
      </div>
    );
  }

  // User is authenticated but doesn't belong to any org → join page
  if (needsOrg) {
    return <Navigate to="/streamline/corporate/join" replace />;
  }

  if (!me) {
    const sp = new URLSearchParams();
    sp.set("returnTo", `${loc.pathname}${loc.search}`);
    return <Navigate to={`/streamline/corporate/login?${sp.toString()}`} replace />;
  }

  // Prevent non-corporate users from accessing Corporate routes.
  if (me.orgType !== "corporate") {
    if ((me as any).orgType === "edu") {
      return <Navigate to="/streamline/edu/dashboard" replace />;
    }
    // Fallback: Corporate login page
    return <Navigate to="/streamline/corporate/login" replace />;
  }

  return <CorporateAuthContext.Provider value={{ me }}>{children}</CorporateAuthContext.Provider>;
}
