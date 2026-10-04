// Guest join-page presence (POST /api/telemetry/guest): lets the host see
// "guest is on the join page". Product telemetry is recorded server-side
// (streamline-server/lib/telemetry.ts).
import { API_BASE } from "./apiBase";

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
