import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../lib/apiBase";

export default function BillingCanceled() {
  const nav = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await fetch(`${API_BASE}/api/billing/clear-pending`, { method: "POST", credentials: "include" });
      } catch {}
      if (!cancelled) nav("/settings/billing", { replace: true });
    })();
    return () => { cancelled = true; };
  }, [nav]);

  return null;
}
