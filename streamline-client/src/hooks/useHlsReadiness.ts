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
        // Use no-cors so CORS-restricted origins (e.g. R2 without a CORS policy)
        // resolve as opaque responses rather than throwing a TypeError.
        // An opaque response (type === "opaque") means the server responded —
        // treat it as ready and let hls.js handle any segment-level retries.
        const res = await fetch(url, { method: "GET", cache: "no-store", mode: "no-cors" });

        if (!cancelled && (res.ok || res.type === "opaque")) {
          setStatus("ready");
          return;
        }
      } catch {
        // Genuine network error (DNS failure, offline, etc.); keep polling.
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
