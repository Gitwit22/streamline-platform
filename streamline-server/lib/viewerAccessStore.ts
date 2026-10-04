/**
 * Resolves the EFFECTIVE viewer access for a room's HLS output (Firestore).
 * Pure rules: lib/viewerAccess.ts.
 *
 * effective = strictest of
 *   rooms/{roomId}.viewerAccess                     (the room itself)
 *   rooms/{homeRoomId}.viewerAccess                 (its channel; home room of the saved embed)
 *   legacy: active paid event on roomId / homeRoomId → pay_per_view
 */
import { firestore as db } from "../firebaseAdmin";
import { listActivePaidEvents, getMonetizedEvent, isActivePaidEvent, type MonetizedEvent } from "./monetization";
import {
  hasExplicitViewerAccess,
  legacyViewerAccess,
  normalizeViewerAccess,
  strictestViewerAccess,
  type PpvEventSummary,
  type ViewerAccess,
} from "./viewerAccess";

export interface ResolvedRoomAccess {
  roomId: string;
  room: any;
  ownerUid: string;
  /** Channel home room (embed.roomId) when the room is bound to a channel. */
  homeRoomId: string | null;
  /** savedEmbeds/{id} the room is bound to, if any. */
  channelId: string | null;
  access: ViewerAccess;
  /** The event that sells access (pay_per_view only). */
  ppvEvent: MonetizedEvent | null;
}

const CACHE_MS = 5_000;
const cache = new Map<string, { at: number; value: ResolvedRoomAccess }>();

export function clearViewerAccessCache(roomId?: string): void {
  if (roomId) cache.delete(roomId);
  else cache.clear();
}

async function readRoom(roomId: string): Promise<any | null> {
  const snap = await db.collection("rooms").doc(roomId).get();
  return snap.exists ? snap.data() || {} : null;
}

/** Channel home room for a room bound to a saved embed. */
async function resolveHomeRoomId(roomId: string, room: any): Promise<{ homeRoomId: string | null; channelId: string | null }> {
  const channelId =
    (typeof room?.activeEmbedId === "string" && room.activeEmbedId.trim()) ||
    (typeof room?.savedEmbedId === "string" && room.savedEmbedId.trim()) ||
    null;
  const fromRoom = typeof room?.activeEmbedRoomId === "string" ? room.activeEmbedRoomId.trim() : "";
  if (fromRoom) return { homeRoomId: fromRoom, channelId };
  if (!channelId) return { homeRoomId: null, channelId: null };
  try {
    const embed = await db.collection("savedEmbeds").doc(channelId).get();
    const home = String((embed.data() as any)?.roomId || "").trim();
    return { homeRoomId: home || null, channelId };
  } catch {
    return { homeRoomId: null, channelId };
  }
}

export function toPpvEventSummary(e: MonetizedEvent | null): PpvEventSummary | null {
  if (!e) return null;
  return {
    id: e.id,
    name: e.name,
    monetizationMode: e.monetizationMode,
    currency: e.currency,
    fixedAmountCents: e.fixedAmountCents ?? null,
    pwywMinCents: e.pwywMinCents ?? null,
    status: e.status,
  };
}

/**
 * Throws only when the room does not exist (message "room_not_found").
 * Lookup failures of the paywall sources fail CLOSED (private).
 */
export async function resolveRoomViewerAccess(roomId: string, opts: { room?: any; noCache?: boolean } = {}): Promise<ResolvedRoomAccess> {
  const hit = cache.get(roomId);
  if (!opts.noCache && hit && Date.now() - hit.at < CACHE_MS) {
    return opts.room ? { ...hit.value, room: opts.room } : hit.value;
  }

  const room = opts.room ?? (await readRoom(roomId));
  if (!room) throw new Error("room_not_found");
  const ownerUid = String(room.ownerId || "").trim();

  let value: ResolvedRoomAccess;
  try {
    const { homeRoomId, channelId } = await resolveHomeRoomId(roomId, room);
    const homeRoom = homeRoomId && homeRoomId !== roomId ? await readRoom(homeRoomId) : null;

    const [ownEvents, homeEvents] = await Promise.all([
      listActivePaidEvents(roomId),
      homeRoomId && homeRoomId !== roomId ? listActivePaidEvents(homeRoomId) : Promise.resolve([] as MonetizedEvent[]),
    ]);
    const activeEvents = [...ownEvents, ...homeEvents];

    const own = hasExplicitViewerAccess(room.viewerAccess) ? normalizeViewerAccess(room.viewerAccess) : null;
    const home = homeRoom && hasExplicitViewerAccess(homeRoom.viewerAccess) ? normalizeViewerAccess(homeRoom.viewerAccess) : null;
    const legacy = legacyViewerAccess(room, activeEvents[0]?.id || null);

    const access = strictestViewerAccess(own, home, legacy);

    let ppvEvent: MonetizedEvent | null = null;
    if (access.mode === "pay_per_view") {
      if (access.ppvEventId) {
        const e = activeEvents.find((x) => x.id === access.ppvEventId) || (await getMonetizedEvent(access.ppvEventId));
        // The configured event must belong to this room or its channel.
        if (e && (e.roomId === roomId || (homeRoomId && e.roomId === homeRoomId))) ppvEvent = e;
      }
      if (!ppvEvent || !isActivePaidEvent(ppvEvent)) {
        ppvEvent = activeEvents[0] || ppvEvent || null;
      }
      if (ppvEvent) access.ppvEventId = ppvEvent.id;
    }

    value = { roomId, room, ownerUid, homeRoomId, channelId, access, ppvEvent };
  } catch (err: any) {
    console.warn("[viewerAccess] resolve failed; failing closed", { roomId, error: err?.message || err });
    value = { roomId, room, ownerUid, homeRoomId: null, channelId: null, access: { mode: "private", allowEmails: [] }, ppvEvent: null };
    // Do not cache failures.
    return value;
  }

  if (cache.size > 2000) cache.clear();
  cache.set(roomId, { at: Date.now(), value });
  return value;
}
