import { useEffect, useState } from "react";

type HlsReadiness = "offline" | "starting" | "ready";

export function useHlsReadiness(manifestUrl: string | null, resetKey?: unknown) {
  const [status, setStatus] = useState<HlsReadiness>("offline");

  useEffect(() => {
    if (!manifestUrl) {
      setStatus("offline");
      return;
    }

    let cancelled = false;
    let attempt = 0;

    async function tick() {
      if (cancelled) return;

      const url = `${manifestUrl}${manifestUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;

      try {
        setStatus((s) => (s === "ready" ? "ready" : "starting"));
        const res = await fetch(url, { method: "GET", cache: "no-store" });

        if (!cancelled && res.ok) {
          setStatus("ready");
          return;
        }
      } catch {
        // ignore; keep polling
      }

      attempt++;
      const delayMs = Math.min(1000 + attempt * 250, 3000);
      window.setTimeout(tick, delayMs);
    }

    tick();
    return () => {
      cancelled = true;
    };
  }, [manifestUrl, resetKey]);

  return status;
}
