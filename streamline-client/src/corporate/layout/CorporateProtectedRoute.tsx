import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getAuthToken } from "../../lib/api";
import { onFirebaseAuthStateChanged } from "../../lib/firebaseClient";
import { isCorporateBypassEnabled, setCorporateLane } from "../state/corporateMode";
import { fetchCorporateMe, type CorporateMe } from "../api/me";

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
        id: "corp-demo",
        uid: "corp-demo",
        name: "Demo Admin",
        displayName: "Demo Admin",
        email: "demo@streamline.corp",
        role: "admin",
        orgRole: "admin",
        orgType: "corporate",
        orgId: "demo-org",
        orgName: "StreamLine Corporate HQ",
        permissions: ["corp:admin", "corp:invite:create", "corp:invite:manage", "corp:member:manage"],
        corporateAccountId: "demo-org",
        organizationId: "demo-org",
        corporateAccount: {
          id: "demo-org",
          name: "StreamLine Corporate HQ",
          status: "active",
          planId: "enterprise",
        },
      });
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    fetchCorporateMe()
      .then((data) => {
        if (mounted) {
          setMe(data);
          setLoading(false);
        }
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

  if (!me) {
    const sp = new URLSearchParams();
    sp.set("returnTo", `${loc.pathname}${loc.search}`);
    return <Navigate to={`/corporate/login?${sp.toString()}`} replace />;
  }

  if (!me.corporateAccountId) {
    return <Navigate to="/corporate/login" replace />;
  }

  return <CorporateAuthContext.Provider value={{ me }}>{children}</CorporateAuthContext.Provider>;
}
