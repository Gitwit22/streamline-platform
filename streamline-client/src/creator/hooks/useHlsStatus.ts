import { useEffect, useState } from "react";
import { getHlsStatus, isHlsAuthError, type HlsStatusResponse } from "../../services/hls";

type UseHlsStatusArgs = {
  apiBase: string;
  roomId: string;
  roomAccessToken: string;
  /**
   * Only poll when the user can manage the stream (host / canStream). Guests
   * and viewers have no business calling the host HLS status endpoint.
   */
  enabled?: boolean;
};

export function useHlsStatus({ apiBase, roomId, roomAccessToken, enabled = true }: UseHlsStatusArgs) {
  const [data, setData] = useState<HlsStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    // Per-run state so a re-run never resurrects the previous loop.
    let stopped = false;
    let timer: number | null = null;
    let backoffMs = 2000; // starts small
    setLoading(true);
    setPollError(null);

    if (!enabled || !apiBase || !roomId || !roomAccessToken) {
      setLoading(false);
      return;
    }

    const schedule = (ms: number) => {
      if (stopped) return;
      timer = window.setTimeout(loop, ms);
    };

    const loop = async () => {
      if (stopped) return;

      try {
        const next = await getHlsStatus(roomId, roomAccessToken);
        if (stopped) return;
        setData(next);
        setLoading(false);
        setPollError(null);

        const s = (next.status || "").toLowerCase();
        const hasPlaylist = !!(next.playlistUrl && String(next.playlistUrl).trim());

        // Polling strategy:
        // - starting => poll fast (2s)
        // - live but no playlist => exponential backoff up to 10s
        // - live with playlist => poll slower (8s)
        // - idle => poll slower (6s)
        if (s === "starting") {
          backoffMs = 2000;
          schedule(2000);
          return;
        }

        if ((s === "live" || s === "active") && !hasPlaylist) {
          backoffMs = Math.min(backoffMs * 1.5, 10000);
          schedule(backoffMs);
          return;
        }

        if (s === "error") {
          // keep a gentle poll so user can recover if host restarts
          backoffMs = 5000;
          schedule(5000);
          return;
        }

        schedule(s === "live" || s === "active" ? 8000 : 6000);
      } catch (e: any) {
        if (stopped) return;
        setLoading(false);
        setPollError(e?.message || "status_poll_failed");

        // No access: stop instead of retrying forever.
        if (isHlsAuthError(e)) {
          stopped = true;
          return;
        }

        // On other errors, back off a bit so we don't hammer
        backoffMs = Math.min(backoffMs * 1.5, 12000);
        schedule(backoffMs);
      }
    };

    // start immediately
    void loop();

    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [apiBase, roomId, roomAccessToken, enabled]);

  return { data, loading, pollError };
}
