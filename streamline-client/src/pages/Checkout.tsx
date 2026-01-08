import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

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

      if (plan !== "starter" && plan !== "pro") {
        setErr("Invalid plan.");
        return;
      }

      try {
        const res = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ plan }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data?.url) {
          throw new Error(data?.error || "Failed to start checkout");
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
