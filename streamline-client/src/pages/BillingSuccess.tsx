import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clearMeCache } from "../lib/meCache";
import { ApiUnauthorizedError, apiFetch, apiFetchAuth } from "../lib/api";

async function fetchMeFresh(): Promise<any | null> {
  try {
    const res = await apiFetchAuth("/api/account/me", { cache: "no-store" });
    return await res.json();
  } catch (err: any) {
    // In cookie-auth setups (Admin flow), we may not have a localStorage JWT.
    // Fall back to cookie-based auth.
    if (err instanceof ApiUnauthorizedError) {
      const res = await apiFetch("/api/account/me", { cache: "no-store" });
      return await res.json();
    }
    throw err;
  }
}

function isUpgradeReflected(me: any | null): boolean {
  const planId = me?.effectiveEntitlements?.planId ?? me?.planId;
  const canHls =
    me?.effectiveEntitlements?.features?.canHls ??
    me?.effectiveEntitlements?.features?.hlsEnabled;

  // Canonical success signal: plan is Pro OR HLS is enabled.
  // (Keeps this unambiguous and aligned with feature gating.)
  return planId === "pro" || canHls === true;
}

export default function BillingSuccess() {
  const nav = useNavigate();
  const [message, setMessage] = useState("Finalizing your upgrade…");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // 1) Always invalidate cache first
      clearMeCache();

      // 2) Poll for entitlement flip (webhook lag)
      const start = Date.now();
      const timeoutMs = 15_000;
      let attempt = 0;
      let upgraded = false;

      while (!cancelled && Date.now() - start < timeoutMs) {
        attempt++;

        // force network fetch; do NOT allow cached response here
        const me = await fetchMeFresh().catch(() => null);

        if (isUpgradeReflected(me)) {
          upgraded = true;
          break;
        }

        const delayMs = attempt <= 2 ? 1000 : 2000;
        setMessage(
          delayMs === 1000
            ? "Finalizing your upgrade…"
            : "Still syncing your subscription…"
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }

      if (cancelled) return;

      // 3) Navigate after either success or timeout.
      // If we time out, Billing can show a non-scary "processing" banner.
      nav("/settings/billing", {
        replace: true,
        state: upgraded ? undefined : { upgradeProcessing: true },
      });
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [nav]);

  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "60vh", color: "#fff" }}>
      <div style={{ textAlign: "center", maxWidth: 520, padding: 20 }}>
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 999,
            border: "2px solid rgba(255,255,255,0.25)",
            borderTopColor: "rgba(255,255,255,0.9)",
            margin: "0 auto 12px",
            animation: "sl-spin 0.9s linear infinite",
          }}
        />
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{message}</div>
        <div style={{ fontSize: 13, opacity: 0.8 }}>This usually takes a few seconds.</div>
        <style>{"@keyframes sl-spin { to { transform: rotate(360deg); } }"}</style>
      </div>
    </div>
  );
}
