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
