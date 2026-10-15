/**
 * Keeps LiveKit room metadata `programOverlay` (on-video branding) in sync
 * with the room's brand kit. Rules live in lib/programOverlayPure.ts.
 *
 * Room metadata is otherwise only written when the layout changes, so the
 * overlay is pushed (1) right before any compositor output starts, (2) when
 * the owner assigns a kit to a room, and (3) when a kit is edited, for its
 * rooms that are live. Every function here is best-effort: branding must
 * never stop a stream, recording or save from happening.
 */
import { firestore as db } from "../firebaseAdmin";
import { getLiveKitSdk } from "../lib/livekit";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import { checkFeature } from "../lib/entitlements";
import { kitBrandingForRoom, roomBrandKitId } from "../lib/brandKitsPure";
import { buildProgramOverlay, mergeOverlayIntoMetadata, type ProgramOverlay } from "../lib/programOverlayPure";
import { getBrandKit } from "./brandKits";

/** LiveKit room name for a room doc (same rule as token issuance). */
export function livekitRoomNameFor(roomId: string, room: any): string {
  return String(room?.livekitRoomName || roomId).trim();
}

/** The overlay the room's kit draws, or null (no kit, other owner's kit, plan without roomBranding). */
export async function getRoomProgramOverlay(room: any): Promise<ProgramOverlay | null> {
  const kitId = roomBrandKitId(room);
  if (!kitId) return null;
  const kit = await getBrandKit(kitId);
  if (!kit || !kitBrandingForRoom(kit, room)) return null;
  const ent = await getEffectiveEntitlements(String(room.ownerId));
  if (!checkFeature(ent, "roomBranding").allowed) return null;
  return buildProgramOverlay(kit);
}

async function roomService(): Promise<any | null> {
  const sdk = await getLiveKitSdk();
  const RoomServiceClient = (sdk as any).RoomServiceClient;
  if (!RoomServiceClient || !process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return null;
  }
  return new RoomServiceClient(process.env.LIVEKIT_URL, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

/** Writes the overlay into one active LiveKit room's metadata. Returns false when the room isn't active. */
async function writeOverlay(svc: any, lkRoom: any, overlay: ProgramOverlay | null): Promise<boolean> {
  const current: string = lkRoom?.metadata || "";
  if (!current && !overlay) return true; // nothing to add or remove
  const next = mergeOverlayIntoMetadata(current, overlay);
  if (next === null) {
    console.warn("[programOverlay] room metadata is not a JSON object; overlay not written", { room: lkRoom?.name });
    return false;
  }
  if (next === current) return true;
  await svc.updateRoomMetadata(lkRoom.name, next);
  return true;
}

/**
 * Pushes the room's current overlay into its LiveKit room (no-op when the
 * LiveKit room isn't running). Never throws.
 *
 * Rooms without a kit skip all LiveKit calls (nothing to draw), unless
 * `clearWhenNoKit` is set: the owner just removed the kit, so a running
 * room's overlay must be cleared.
 */
export async function syncRoomProgramOverlay(
  roomId: string,
  roomData?: any,
  opts: { clearWhenNoKit?: boolean } = {}
): Promise<void> {
  try {
    const room = roomData ?? (await db.collection("rooms").doc(roomId).get()).data();
    if (!room) return;
    if (!roomBrandKitId(room) && !opts.clearWhenNoKit) return;
    const svc = await roomService();
    if (!svc) return;
    const name = livekitRoomNameFor(roomId, room);
    const rooms = await svc.listRooms([name]);
    if (!rooms || rooms.length === 0) return;
    await writeOverlay(svc, rooms[0], await getRoomProgramOverlay(room));
  } catch (err: any) {
    console.warn("[programOverlay] sync failed", { roomId, error: err?.message || String(err) });
  }
}

const KIT_ROOMS_SYNC_LIMIT = 100;

/** After a kit edit: re-sync the kit's rooms that are currently running. Never throws. */
export async function syncBrandKitRooms(kitId: string, ownerUid: string): Promise<void> {
  try {
    const snap = await db.collection("rooms").where("brandKitId", "==", kitId).limit(KIT_ROOMS_SYNC_LIMIT).get();
    const rooms = snap.docs
      .map((d) => ({ id: d.id, data: d.data() as any }))
      .filter((r) => String(r.data?.ownerId || "") === ownerUid);
    if (rooms.length === 0) return;
    const svc = await roomService();
    if (!svc) return;
    const byName = new Map(rooms.map((r) => [livekitRoomNameFor(r.id, r.data), r]));
    const active = (await svc.listRooms([...byName.keys()])) || [];
    for (const lkRoom of active) {
      const r = byName.get(lkRoom.name);
      if (!r) continue;
      try {
        await writeOverlay(svc, lkRoom, await getRoomProgramOverlay(r.data));
      } catch (err: any) {
        console.warn("[programOverlay] kit room sync failed", { roomId: r.id, error: err?.message || String(err) });
      }
    }
  } catch (err: any) {
    console.warn("[programOverlay] kit sync failed", { kitId, error: err?.message || String(err) });
  }
}
