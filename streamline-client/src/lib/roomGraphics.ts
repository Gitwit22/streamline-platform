/**
 * Live room graphics: lower thirds (name + title) and banners (static or
 * scrolling), saved per room and shown/hidden live by producers (host, or a
 * co-host with layout permission). Server: streamline-server/routes/
 * roomsGraphics.ts (rules in lib/roomGraphicsPure.ts). The visible ones reach
 * every output through room metadata `programOverlay` (lib/programOverlay.ts).
 */
import { API_BASE } from "./apiBase";
import { apiFetchAuth } from "./api";

export const GRAPHICS_LIMITS = { items: 10, name: 60, title: 80, bannerText: 200 } as const;

export type LowerThirdItem = { id: string; name: string; title: string };
export type BannerItem = { id: string; text: string; scroll: boolean };

export type RoomGraphics = {
  lowerThirds: LowerThirdItem[];
  banners: BannerItem[];
  activeLowerThirdId: string | null;
  activeBannerId: string | null;
};

export const EMPTY_ROOM_GRAPHICS: RoomGraphics = {
  lowerThirds: [],
  banners: [],
  activeLowerThirdId: null,
  activeBannerId: null,
};

export type GraphicsSnapshot = { graphics: RoomGraphics; rev: number };

export class GraphicsError extends Error {
  code: string;
  /** Present on a conflict (409): the server's current state. */
  current?: GraphicsSnapshot;
  constructor(code: string, message: string, current?: GraphicsSnapshot) {
    super(message);
    this.code = code;
    this.current = current;
  }
}

function messageFor(code: string, details?: string): string {
  switch (code) {
    case "room_branding_not_in_plan":
      return "Lower thirds and banners are not included in the room owner's plan.";
    case "feature_disabled":
      return "Graphics are temporarily disabled.";
    case "graphics_conflict":
      return "Someone else changed the graphics. Showing the latest — try again.";
    case "insufficient_permissions":
      return "You don't have permission to change graphics in this room.";
    default:
      return details || code || "Request failed.";
  }
}

function toSnapshot(p: unknown): GraphicsSnapshot {
  const o = (p && typeof p === "object" ? p : {}) as { graphics?: Partial<RoomGraphics>; rev?: unknown };
  const g = o.graphics || {};
  return {
    graphics: {
      lowerThirds: Array.isArray(g.lowerThirds) ? g.lowerThirds : [],
      banners: Array.isArray(g.banners) ? g.banners : [],
      activeLowerThirdId: typeof g.activeLowerThirdId === "string" ? g.activeLowerThirdId : null,
      activeBannerId: typeof g.activeBannerId === "string" ? g.activeBannerId : null,
    },
    rev: typeof o.rev === "number" ? o.rev : 0,
  };
}

async function call(roomId: string, roomAccessToken: string, init: RequestInit): Promise<GraphicsSnapshot> {
  const res = await apiFetchAuth(
    `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/graphics`,
    { ...init, headers: { ...(init.headers || {}), "x-room-access-token": roomAccessToken } },
    { allowNonOk: true }
  );
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const code = String(payload?.error || `http_${res.status}`);
    throw new GraphicsError(code, messageFor(code, payload?.details), res.status === 409 ? toSnapshot(payload) : undefined);
  }
  return toSnapshot(payload);
}

export function getRoomGraphics(roomId: string, roomAccessToken: string): Promise<GraphicsSnapshot> {
  return call(roomId, roomAccessToken, { method: "GET", cache: "no-store" });
}

/** Saves the full state; `rev` is the revision it was based on (409 if stale). */
export function saveRoomGraphics(
  roomId: string,
  roomAccessToken: string,
  graphics: RoomGraphics,
  rev: number
): Promise<GraphicsSnapshot> {
  return call(roomId, roomAccessToken, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...graphics, rev }),
  });
}

/** Short random id for a new item (server accepts [A-Za-z0-9_-], ≤40 chars). */
export function newGraphicsId(prefix: "lt" | "bn"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
