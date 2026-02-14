import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetchAuth } from "../lib/api";
import { clearMeCache } from "../lib/meCache";

export default function BillingCanceled() {
  const nav = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await apiFetchAuth("/api/billing/clear-pending", { method: "POST" }, { allowNonOk: true });
      } catch {}
      // Ensure any cached /api/account/me payload is discarded.
      clearMeCache();
      if (!cancelled) nav("/settings/billing", { replace: true });
    })();
    return () => { cancelled = true; };
  }, [nav]);

  return null;
}
