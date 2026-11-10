/**
 * Resolves the EFFECTIVE viewer access for a room's HLS output (Firestore).
 * Pure rules: lib/viewerAccess.ts.
 *
 * effective = strictest of
 *   rooms/{roomId}.viewerAccess                     (the room itself)
 *   rooms/{homeRoomId}.viewerAccess                 (its channel; home room of the saved embed)
 *   event rule: the running broadcast is bound to a paid event (hls.ppvEventId,
 *               any status) → pay_per_view; else a STARTED paid event (or a
 *               legacy non-ended one) on roomId / homeRoomId → pay_per_view
 * Scheduled (v2 draft) events never change room access.
 */
import { firestore as db } from "../firebaseAdmin";
import { listActivePaidEvents, getMonetizedEvent, type MonetizedEvent } from "./monetization";
import { channelBindingAllowed } from "./channelBindingPure";
import { broadcastStateFromHls, isPaidMode, pickBroadcastEventId, type BroadcastState } from "./ppvLifecyclePure";
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
  /**
   * Event offered for sale / shown on channel pages (pay_per_view only): the
   * running broadcast's event, else the explicitly configured live event,
   * else the single live paid event. Never "newest of several".
   */
  ppvEvent: MonetizedEvent | null;
  /** Running HLS broadcast and the event it was bound to at start. */
  broadcast: BroadcastState;
  /** The broadcast's event (any status), when bound and still in this room. */
  broadcastEvent: MonetizedEvent | null;
  /** Live (paywalling) paid events on the room and its channel home room. */
  liveEventIds: string[];
  /** ppvEventId from an explicit room/channel setting, if any. */
  explicitPpvEventId: string | null;
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
    // Only the room owner's own channel counts (rooms could once be bound to any channel id).
    if (!channelBindingAllowed(embed.exists ? embed.data() : null, room?.ownerId)) {
      return { homeRoomId: null, channelId: null };
    }
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
    const belongs = (e: MonetizedEvent | null) => !!e && (e.roomId === roomId || (!!homeRoomId && e.roomId === homeRoomId));

    // A running broadcast bound to a paid event stays paid for its whole run,
    // even after that event ends (no silent fallback to public).
    const broadcast = broadcastStateFromHls(room.hls);
    let broadcastEvent: MonetizedEvent | null = null;
    if (broadcast.live && broadcast.eventId) {
      const e = activeEvents.find((x) => x.id === broadcast.eventId) || (await getMonetizedEvent(broadcast.eventId));
      broadcastEvent = belongs(e) ? e : null;
    }
    const eventRule: ViewerAccess =
      broadcastEvent && isPaidMode(broadcastEvent.monetizationMode)
        ? { mode: "pay_per_view", ppvEventId: broadcastEvent.id }
        : legacyViewerAccess(room, activeEvents[0]?.id || null);

    const access = strictestViewerAccess(own, home, eventRule);
    const liveEventIds = activeEvents.map((e) => e.id);
    const explicitPpvEventId =
      (own?.mode === "pay_per_view" && own.ppvEventId) || (home?.mode === "pay_per_view" && home.ppvEventId) || null;

    let ppvEvent: MonetizedEvent | null = null;
    if (access.mode === "pay_per_view") {
      if (broadcastEvent) {
        ppvEvent = broadcastEvent;
      } else {
        const pick = pickBroadcastEventId(liveEventIds, explicitPpvEventId);
        ppvEvent = pick ? activeEvents.find((x) => x.id === pick) || null : null;
      }
      access.ppvEventId = ppvEvent ? ppvEvent.id : access.ppvEventId ?? null;
    }

    value = { roomId, room, ownerUid, homeRoomId, channelId, access, ppvEvent, broadcast, broadcastEvent, liveEventIds, explicitPpvEventId };
  } catch (err: any) {
    console.warn("[viewerAccess] resolve failed; failing closed", { roomId, error: err?.message || err });
    value = {
      roomId,
      room,
      ownerUid,
      homeRoomId: null,
      channelId: null,
      access: { mode: "private", allowEmails: [] },
      ppvEvent: null,
      broadcast: broadcastStateFromHls(room.hls),
      broadcastEvent: null,
      liveEventIds: [],
      explicitPpvEventId: null,
    };
    // Do not cache failures.
    return value;
  }

  if (cache.size > 2000) cache.clear();
  cache.set(roomId, { at: Date.now(), value });
  return value;
}
