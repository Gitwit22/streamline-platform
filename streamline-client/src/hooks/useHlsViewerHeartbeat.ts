import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { API_BASE } from "../lib/apiBase";
import { getViewerId } from "../lib/viewerId";

/**
 * Counts this browser as a live HLS viewer.
 *
 * While `active` (the player is playing a live room) and the tab is visible,
 * POSTs /api/public/viewers/heartbeat immediately and every `intervalMs`
 * (server TTL is 45s). Leaving (unmount, `active` -> false, page hide) sends a
 * `leave` beacon so the viewer drops out of "current" right away.
 *
 * Returns the latest { currentViewers, totalViewers } from the server, or
 * null before the first successful heartbeat. Errors are silent.
 */
export const HLS_VIEWER_HEARTBEAT_PATH = "/api/public/viewers/heartbeat";
export const HLS_VIEWER_HEARTBEAT_MS = 20_000;
/** Visibility-triggered pings closer than this to the last one are skipped. */
const MIN_PING_GAP_MS = 5_000;

export type HlsViewerCounts = { currentViewers: number; totalViewers: number };

export function sendViewerLeave(roomId: string, viewerId: string) {
  const payload = JSON.stringify({ roomId, viewerId, kind: "hls", leave: true });
  try {
    const nav: any = typeof navigator !== "undefined" ? navigator : null;
    if (nav && typeof nav.sendBeacon === "function") {
      // text/plain keeps the beacon a CORS "simple" request (no preflight).
      const ok = nav.sendBeacon(`${API_BASE}${HLS_VIEWER_HEARTBEAT_PATH}`, new Blob([payload], { type: "text/plain" }));
      if (ok) return;
    }
  } catch {
    // fall through
  }
  void apiFetch(HLS_VIEWER_HEARTBEAT_PATH, { method: "POST", body: payload, keepalive: true }, { allowNonOk: true }).catch(
    () => {}
  );
}

export function useHlsViewerHeartbeat(
  roomId: string | null | undefined,
  active: boolean,
  opts: { intervalMs?: number } = {}
): HlsViewerCounts | null {
  const [counts, setCounts] = useState<HlsViewerCounts | null>(null);
  const intervalMs = opts.intervalMs ?? HLS_VIEWER_HEARTBEAT_MS;
  const id = String(roomId || "").trim();

  useEffect(() => {
    if (!id || !active) return;
    const viewerId = getViewerId();
    let stopped = false;
    let left = false;
    let lastPingAt = 0;

    const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

    const ping = async () => {
      if (stopped || isHidden()) return;
      lastPingAt = Date.now();
      left = false;
      try {
        const res = await apiFetch(
          HLS_VIEWER_HEARTBEAT_PATH,
          { method: "POST", body: JSON.stringify({ roomId: id, viewerId, kind: "hls" }) },
          { allowNonOk: true }
        );
        if (!res.ok || stopped) return;
        const data = (await res.json().catch(() => null)) as Partial<HlsViewerCounts> | null;
        if (stopped || !data) return;
        if (typeof data.currentViewers === "number" && typeof data.totalViewers === "number") {
          setCounts({ currentViewers: data.currentViewers, totalViewers: data.totalViewers });
        }
      } catch {
        // Counting is best-effort; never surface errors to viewers.
      }
    };

    const leave = () => {
      if (left) return;
      left = true;
      sendViewerLeave(id, viewerId);
    };

    const onVisibility = () => {
      if (isHidden()) return;
      if (Date.now() - lastPingAt >= MIN_PING_GAP_MS) void ping();
    };

    void ping();
    const timer = setInterval(() => void ping(), intervalMs);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", leave);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [id, active, intervalMs]);

  return counts;
}

/** Tracks whether a <video> element is currently playing. */
export function useVideoPlaying(video: HTMLVideoElement | null): boolean {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!video) {
      setPlaying(false);
      return;
    }
    const update = () => setPlaying(!video.paused && !video.ended);
    update();
    const events = ["playing", "play", "pause", "ended", "emptied"];
    events.forEach((e) => video.addEventListener(e, update));
    return () => events.forEach((e) => video.removeEventListener(e, update));
  }, [video]);
  return playing;
}
