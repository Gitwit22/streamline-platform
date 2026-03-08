import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetchAuth } from "../lib/api";

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

export default function Checkout() {
  const nav = useNavigate();
  const q = useQuery();
  const plan = (q.get("plan") || "").toLowerCase();
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    const run = async () => {
      setErr("");

      if (!plan) {
        setErr("Missing plan.");
        return;
      }

      // This endpoint accepts PlanId variants (e.g. "starter", "starter_paid", "starter_trial").
      // We keep only a minimal client-side sanity check; the server is the source of truth.
      const allowed = new Set([
        "free",
        "basic",
        "starter",
        "starter_paid",
        "starter_trial",
        "pro",
        "pro_paid",
        "pro_trial",
        "enterprise",
        "enterprise_paid",
        "enterprise_trial",
        "internal_unlimited",
        "internal_unlimited_paid",
        "internal_unlimited_trial",
      ]);
      if (!allowed.has(plan)) {
        setErr("Invalid plan.");
        return;
      }

      try {
        const requestId = `${plan}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const res = await apiFetchAuth("/api/billing/checkout", {
          method: "POST",
          body: JSON.stringify({ plan, requestId }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data?.error || "Failed to start checkout");
        }

        // Billing disabled returns a success response without a Stripe URL.
        if (data?.billing?.mode === "disabled") {
          setErr("Billing is disabled (Test Mode). Enable billing to use Stripe checkout.");
          return;
        }

        if (!data?.url) {
          throw new Error(data?.error || "Checkout URL missing");
        }

        window.location.href = data.url;
      } catch (e: any) {
        setErr(e?.message || "Checkout failed");
      }
    };

    run();
  }, [plan]);

  return (
    <div style={{ padding: 24 }}>
      <h2>Redirecting to secure checkout…</h2>

      {err ? (
        <>
          <p style={{ marginTop: 12 }}>{err}</p>
          <button onClick={() => nav("/settings/billing")} style={{ marginTop: 12 }}>
            Back to Billing
          </button>
        </>
      ) : (
        <p style={{ marginTop: 12 }}>Please wait.</p>
      )}
    </div>
  );
}
