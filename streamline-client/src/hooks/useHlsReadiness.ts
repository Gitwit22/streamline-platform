import { useEffect, useRef, useState } from "react";

type HlsReadiness = "offline" | "starting" | "ready";

export function useHlsReadiness(
  manifestUrl: string | null,
  resetKey?: unknown,
  opts?: {
    /** Applied to the URL at each probe (e.g. swap in a renewed playback token) without re-triggering. */
    transformUrl?: (url: string) => string;
  }
) {
  const [status, setStatus] = useState<HlsReadiness>("offline");
  const transformRef = useRef(opts?.transformUrl);
  transformRef.current = opts?.transformUrl;

  useEffect(() => {
    if (!manifestUrl) {
      setStatus("offline");
      return;
    }

    // A new URL (or reset) must be re-probed; don't inherit "ready".
    setStatus("starting");

    let cancelled = false;
    let attempt = 0;
    let timer: number | undefined;

    async function tick() {
      if (cancelled) return;

      const base = transformRef.current ? transformRef.current(manifestUrl!) : manifestUrl!;
      const url = `${base}${base.includes("?") ? "&" : "?"}t=${Date.now()}`;

      let ready = false;
      try {
        // CORS fetch first so a 404/403 (manifest not uploaded yet) is visible.
        // hls.js needs CORS on the origin anyway, so this normally succeeds.
        const res = await fetch(url, { method: "GET", cache: "no-store" });
        ready = res.ok;
      } catch {
        // CORS-blocked or network error. Native HLS (Safari) can still play a
        // non-CORS origin, so fall back to an opaque probe: it can't see the
        // status code, but proves the origin responded.
        try {
          const res = await fetch(url, { method: "GET", cache: "no-store", mode: "no-cors" });
          ready = res.type === "opaque";
        } catch {
          // Genuine network error (DNS failure, offline, etc.); keep polling.
        }
      }

      if (cancelled) return;
      if (ready) {
        setStatus("ready");
        return;
      }

      attempt++;
      const delayMs = Math.min(1000 + attempt * 250, 3000);
      timer = window.setTimeout(tick, delayMs);
    }

    tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [manifestUrl, resetKey]);

  return status;
}
