/**
 * Channel / room viewer access settings (creator).
 *
 *   GET /api/rooms/:roomId/viewer-access
 *     -> { roomId, viewerAccess (stored, default public), effective (resolved),
 *          activePaidEvents[], options{ mode: { available, reason } }, live }
 *   PUT /api/rooms/:roomId/viewer-access { mode, ppvEventId?, allowEmails? }
 *
 * For a channel, roomId is the channel's home room (savedEmbeds.roomId) — the
 * same doc that holds the channel branding. Only the room owner (or a
 * platform admin) may change who can watch.
 *
 * Replaces the per-room toggles rooms.monetizationEnabled / payPerViewEnabled,
 * which were never enforced. Access changes apply immediately to new playback
 * requests; a stream that started PUBLIC keeps its predictable public path
 * until the next go-live (see routes/hls.ts protected run prefix).
 */
import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { firestore as db } from "../firebaseAdmin";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import { checkFeature } from "../lib/entitlements";
import { listActivePaidEvents } from "../lib/monetization";
import { clearViewerAccessCache, resolveRoomViewerAccess } from "../lib/viewerAccessStore";
import { normalizeViewerAccess, validateViewerAccessRequest, VIEWER_ACCESS_MODES } from "../lib/viewerAccess";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = Router();

function normalizeRoomId(raw: unknown): string {
  return String(raw || "").trim();
}

async function gateFor(ownerUid: string) {
  const ent = await getEffectiveEntitlements(ownerUid);
  return {
    hls: checkFeature(ent, "hls").allowed,
    monetization: checkFeature(ent, "monetization").allowed,
    payPerView: checkFeature(ent, "payPerView").allowed,
  };
}

function optionsFor(gate: { hls: boolean; monetization: boolean; payPerView: boolean }, activePaidEvents: number) {
  const base = (available: boolean, reason: string | null) => ({ available, reason });
  return {
    public: base(true, null),
    registered: base(gate.hls, gate.hls ? null : "Requires HLS on your plan."),
    subscriber: base(false, "Coming soon — channel subscriptions are not available yet."),
    pay_per_view: !gate.monetization
      ? base(false, "Monetization is not included in your plan.")
      : !gate.payPerView
        ? base(false, "Pay-per-view is not included in your plan.")
        : activePaidEvents === 0
          ? base(false, "Create a paid event for this channel first (Monetization page).")
          : base(true, null),
    private: base(gate.hls, gate.hls ? null : "Requires HLS on your plan."),
  };
}

router.get("/:roomId/viewer-access", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });
  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");
    const room = ctx.room as any;
    const ownerUid = String(room.ownerId || req.user?.uid || "").trim();
    const [gate, events, resolved] = await Promise.all([
      gateFor(ownerUid),
      listActivePaidEvents(ctx.roomId),
      resolveRoomViewerAccess(ctx.roomId, { room, noCache: true }),
    ]);
    return res.json({
      roomId: ctx.roomId,
      modes: VIEWER_ACCESS_MODES,
      viewerAccess: normalizeViewerAccess(room.viewerAccess),
      effective: resolved.access,
      live: room?.hls?.status === "live",
      liveProtected: typeof room?.hls?.prefix === "string" && room.hls.prefix.includes("/p-"),
      activePaidEvents: events.map((e) => ({
        id: e.id,
        name: e.name,
        monetizationMode: e.monetizationMode,
        currency: e.currency,
        fixedAmountCents: e.fixedAmountCents,
        pwywMinCents: e.pwywMinCents,
        status: e.status,
      })),
      options: optionsFor(gate, events.length),
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) return res.status(err.status).json({ error: err.code });
    console.error("GET /api/rooms/:roomId/viewer-access error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

router.put("/:roomId/viewer-access", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });
  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");
    const room = ctx.room as any;
    const uid = String(req.user?.uid || "");
    const ownerUid = String(room.ownerId || "").trim();
    const isOwner = ownerUid && ownerUid === uid;
    if (!isOwner && ctx.role !== "admin") {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS, reason: "Only the channel owner can change viewer access." });
    }

    const [gate, events] = await Promise.all([gateFor(ownerUid || uid), listActivePaidEvents(ctx.roomId)]);
    const result = validateViewerAccessRequest(req.body || {}, gate, { activePaidEventIds: events.map((e) => e.id) });
    if ("error" in result) return res.status(result.status).json({ error: result.error, reason: result.reason });

    const viewerAccess = {
      ...result.value,
      updatedAt: new Date().toISOString(),
      updatedBy: uid,
    };
    await db.collection("rooms").doc(ctx.roomId).set({ viewerAccess }, { merge: true });
    clearViewerAccessCache();

    const resolved = await resolveRoomViewerAccess(ctx.roomId, { noCache: true });
    return res.json({
      success: true,
      roomId: ctx.roomId,
      viewerAccess: normalizeViewerAccess(viewerAccess),
      effective: resolved.access,
      live: room?.hls?.status === "live",
      liveProtected: typeof room?.hls?.prefix === "string" && room.hls.prefix.includes("/p-"),
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) return res.status(err.status).json({ error: err.code });
    console.error("PUT /api/rooms/:roomId/viewer-access error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
