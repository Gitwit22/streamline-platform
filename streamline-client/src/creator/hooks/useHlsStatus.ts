import { useEffect, useRef, useState } from "react";
import { getHlsStatus, type HlsStatusResponse } from "../../services/hls";

type UseHlsStatusArgs = {
  apiBase: string;
  roomId: string;
  roomAccessToken: string;
};

export function useHlsStatus({ apiBase, roomId, roomAccessToken }: UseHlsStatusArgs) {
  const [data, setData] = useState<HlsStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [pollError, setPollError] = useState<string | null>(null);

  const backoffMsRef = useRef<number>(2000); // starts small
  const stoppedRef = useRef<boolean>(false);

  useEffect(() => {
    stoppedRef.current = false;
    backoffMsRef.current = 2000;
    setLoading(true);
    setPollError(null);

    if (!apiBase || !roomId || !roomAccessToken) return;

    const fetchOnce = async () => {
      return await getHlsStatus(roomId, roomAccessToken);
    };

    const schedule = (ms: number) => {
      if (stoppedRef.current) return;
      window.setTimeout(loop, ms);
    };

    const loop = async () => {
      if (stoppedRef.current) return;

      try {
        const next = await fetchOnce();
        setData(next);
        setLoading(false);
        setPollError(null);

        const s = (next.status || "").toLowerCase();
        const hasPlaylist = !!(next.playlistUrl && String(next.playlistUrl).trim());

        // Polling strategy:
        // - starting => poll fast (2s)
        // - live but no playlist => exponential backoff up to 10s
        // - live with playlist => poll slower (8s) or you can stop polling later
        // - idle => poll slower (6s)
        if (s === "starting") {
          backoffMsRef.current = 2000;
          schedule(2000);
          return;
        }

        if ((s === "live" || s === "active") && !hasPlaylist) {
          // backoff up to 10s
          backoffMsRef.current = Math.min(backoffMsRef.current * 1.5, 10000);
          schedule(backoffMsRef.current);
          return;
        }

        if (s === "error") {
          // keep a gentle poll so user can recover if host restarts
          backoffMsRef.current = 5000;
          schedule(5000);
          return;
        }

        // stable states
        schedule((s === "live" || s === "active") ? 8000 : 6000);
      } catch (e: any) {
        setLoading(false);
        setPollError(e?.message || "status_poll_failed");

        // On errors, back off a bit so we don't hammer
        backoffMsRef.current = Math.min(backoffMsRef.current * 1.5, 12000);
        schedule(backoffMsRef.current);
      }
    };

    // start immediately
    loop();

    return () => {
      stoppedRef.current = true;
    };
  }, [apiBase, roomId, roomAccessToken]);

  return { data, loading, pollError };
}
