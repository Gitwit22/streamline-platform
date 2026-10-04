// Telemetry service for tracking guest invite flow performance
import { API_BASE } from "./apiBase";

type TelemetryEvent = 
  | { event: "viewer_join_success"; roomId: string; guestSessionToken: string }
  | { event: "viewer_first_video_track_ms"; roomId: string; durationMs: number; guestSessionToken: string };

/**
 * Log telemetry event to backend for analysis
 */
export async function logTelemetry(data: TelemetryEvent): Promise<void> {
  try {
    // Fire and forget - don't block on telemetry
    fetch(`${API_BASE}/api/telemetry/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...data,
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
      }),
      // Don't wait for response
      keepalive: true,
    }).catch(() => {
      // Silently fail - telemetry shouldn't break user flow
    });

    // Also log locally for debugging
    console.log('[Telemetry]', data.event, data);
  } catch {
    // Ignore telemetry errors
  }
}

/**
 * Store timing mark for calculating durations
 */
const timingMarks = new Map<string, number>();

export function markTiming(key: string): void {
  timingMarks.set(key, Date.now());
}

export function measureTiming(key: string): number | null {
  const start = timingMarks.get(key);
  if (!start) return null;
  
  const duration = Date.now() - start;
  timingMarks.delete(key); // Clean up
  return duration;
}

export function clearTiming(key: string): void {
  timingMarks.delete(key);
}

export type GuestPresenceStage = "join_page" | "entered_room" | "left";

export type GuestPresencePayload = {
  roomId: string;
  stage: GuestPresenceStage;
  identity?: string | null;
  displayName?: string | null;
  guestSessionToken?: string | null;
};

/** Body for POST /api/telemetry/guest presence pings (empty fields dropped). */
export function buildGuestPresenceBody(p: GuestPresencePayload): Record<string, unknown> {
  const body: Record<string, unknown> = {
    roomId: p.roomId,
    stage: p.stage,
    // Older servers require `event`; newer ones key off `stage`.
    event: `guest_${p.stage}`,
    ts: Date.now(),
  };
  if (p.identity) body.identity = p.identity;
  if (p.displayName && p.displayName.trim()) body.displayName = p.displayName.trim();
  if (p.guestSessionToken) body.guestSessionToken = p.guestSessionToken;
  return body;
}

/**
 * Join-page presence ping so the host sees "Guest is viewing the join page".
 * `beacon: true` is for pagehide/unload, where a normal fetch may be dropped.
 */
export function postGuestPresence(p: GuestPresencePayload, opts?: { beacon?: boolean }): void {
  if (!p.roomId) return;
  const url = `${API_BASE}/api/telemetry/guest`;
  const json = JSON.stringify(buildGuestPresenceBody(p));
  try {
    if (opts?.beacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const ok = navigator.sendBeacon(url, new Blob([json], { type: "application/json" }));
      if (ok) return;
    }
  } catch {
    // fall back to keepalive fetch
  }
  try {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
      credentials: "include",
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}
