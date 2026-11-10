/**
 * Viewer playback authorization (public, optional auth).
 *
 *   POST /api/public/channels/:embedId/playback   – /live/<embedId> channel page
 *   POST /api/public/rooms/:roomId/playback       – room / PPV event page
 *
 * Flow: resolve effective access mode → viewer state (signed in? host?
 * entitlement?) → decision (lib/viewerAccess.ts):
 *   200 { ok, mode, status, playbackUrl|null, expiresAt|null, protected }
 *   401 { error: "login_required", loginRequired: true }              registered
 *   402 { error: "checkout_required", checkoutRequired: true, checkout } PPV
 *   403 { error: "private" | "subscriber_not_available" | "ppv_unavailable" }
 *   503 { error: "playback_unconfigured" }   HLS_PLAYBACK_SECRET missing in prod
 *
 * playbackUrl is an absolute public URL (public channels) or an API path
 * "/api/hls/play/…?token=…" (everything else) that the client prefixes with
 * its API base. Tokens expire (HLS_PLAYBACK_TOKEN_TTL_SEC); clients renew.
 */
import { Router, type Request, type Response } from "express";
import { firestore as db, auth as firebaseAuth } from "../firebaseAdmin";
import { tryGetAuthUserAny } from "../middleware/requireAuth";
import { checkRoomHostAccess } from "./invites";
import { resolveRoomViewerAccess, toPpvEventSummary, type ResolvedRoomAccess } from "../lib/viewerAccessStore";
import { decideViewerAccess } from "../lib/viewerAccess";
import { getDeviceId } from "../lib/viewerDevice";
import { deviceKeyFor } from "../lib/viewerEntitlementsPure";
import { findActivePpvEntitlement, grantPpvEntitlement } from "../lib/viewerEntitlements";
import { findClaimedCodeForDevice, getMonetizedEvent, getPurchase, type MonetizedEvent } from "../lib/monetization";
import { decidePpvPlayback, effectiveEventStatus } from "../lib/ppvLifecyclePure";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import { checkFeature } from "../lib/entitlements";
import { issuePlayback } from "../lib/hlsPlayback";
import { SlidingWindowLimiter, clientIp, rateLimit } from "../lib/rateLimit";

const router = Router();

const PPV_DENY_MESSAGES: Record<string, string> = {
  ppv_unavailable: "Tickets for this stream are not on sale right now.",
  ppv_event_ended: "This event has ended.",
  ppv_broadcast_unassigned: "This stream isn't available right now. The host has been notified.",
  event_not_found: "This event isn't on this channel.",
};

const playbackIpLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 240 });
const limit = rateLimit([{ limiter: playbackIpLimiter, key: (req) => `ip:${clientIp(req)}` }]);

function looksLikeId(v: string): boolean {
  return !!v && v.length <= 128 && !/[ –#/]/.test(v);
}

async function verifiedEmailFor(uid: string): Promise<string | null> {
  try {
    const u = await firebaseAuth.getUser(uid);
    return u.email && u.emailVerified ? u.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Entitlement for the PPV event, including pre-Stage-7 access codes already
 * claimed on this device (migrated lazily into a device entitlement).
 */
async function findPpvEntitlement(
  resolved: ResolvedRoomAccess,
  eventId: string,
  viewer: { uid: string | null; rawDeviceId: string }
): Promise<string | null> {
  const deviceKey = deviceKeyFor(viewer.rawDeviceId);
  const ent = await findActivePpvEntitlement(eventId, { deviceKey, uid: viewer.uid });
  if (ent) return ent.id;

  const legacy = await findClaimedCodeForDevice(eventId, viewer.rawDeviceId).catch(() => null);
  if (!legacy) return null;
  const purchase = await getPurchase(eventId, legacy.purchaseId).catch(() => null);
  if (purchase && purchase.status !== "paid") return null;
  const ids = await grantPpvEntitlement({
    eventId,
    roomId: resolved.ppvEvent?.roomId ?? resolved.roomId,
    channelId: resolved.channelId,
    purchaseId: legacy.purchaseId,
    deviceKey,
    source: "legacy_code",
  });
  return ids[0] || null;
}

async function authorizeRoomPlayback(req: Request, res: Response, roomId: string, extra: Record<string, unknown> = {}) {
  let resolved: ResolvedRoomAccess;
  try {
    resolved = await resolveRoomViewerAccess(roomId);
  } catch (e: any) {
    if (e?.message === "room_not_found") return res.status(404).json({ error: "room_not_found" });
    throw e;
  }
  const { room, access } = resolved;
  const hls = room?.hls || {};
  const live = hls.status === "live" && !!String(hls.playlistUrl || "").trim();
  const streamStatus = live ? "live" : hls.status === "starting" ? "starting" : "idle";

  const user = access.mode === "public" ? null : await tryGetAuthUserAny(req).catch(() => null);
  const uid = user?.uid || null;
  const isHost = access.mode === "public" ? false : (await checkRoomHostAccess(req, roomId, room).catch(() => 403)) === null;
  const email = access.mode === "private" && uid && !isHost ? await verifiedEmailFor(uid) : null;

  let entitlementId: string | null = null;
  let ppvSalesOpen = false;
  const common = { mode: access.mode, status: streamStatus, roomId, ...extra };

  // ── Pay-per-view: scoped to ONE event ─────────────────────────────
  // Playback needs: the requested event belongs to this room/channel, it has
  // not ended, the running protected broadcast is bound to it, and the viewer
  // holds a ticket for it. A ticket for an earlier show never reaches a later
  // show on the same room. No "newest event" fallback.
  if (access.mode === "pay_per_view" && !isHost) {
    const requestedEventId = typeof req.body?.eventId === "string" ? req.body.eventId.trim() : "";
    let event: MonetizedEvent | null = null;
    let eventInRoom = false;
    if (requestedEventId) {
      if (!looksLikeId(requestedEventId)) return res.status(400).json({ error: "invalid_event_id" });
      event = await getMonetizedEvent(requestedEventId);
      eventInRoom = !!event && (event.roomId === resolved.roomId || (!!resolved.homeRoomId && event.roomId === resolved.homeRoomId));
    } else {
      // Channel/room page without an event: the running broadcast's event,
      // else the one event on sale (see resolver).
      event = resolved.broadcastEvent || resolved.ppvEvent;
      eventInRoom = !!event;
    }

    if (event && eventInRoom) {
      entitlementId = await findPpvEntitlement(resolved, event.id, { uid, rawDeviceId: getDeviceId(req, res) });
      if (!entitlementId && resolved.ownerUid) {
        const ent = await getEffectiveEntitlements(resolved.ownerUid);
        ppvSalesOpen = checkFeature(ent, "monetization").allowed && checkFeature(ent, "payPerView").allowed;
      }
    }

    const ppv = decidePpvPlayback({
      isHost: false,
      event: event as any,
      eventInRoom,
      broadcast: resolved.broadcast,
      hasTicket: !!entitlementId,
      salesOpen: ppvSalesOpen,
    });
    const eventCommon = { ...common, eventId: event?.id ?? null, eventStatus: event ? effectiveEventStatus(event as any) : null };

    if (ppv.kind === "checkout") {
      return res.status(402).json({
        ok: false,
        error: "checkout_required",
        message: "Buy a ticket to watch this stream.",
        checkoutRequired: true,
        checkout: {
          eventId: event!.id,
          eventName: event!.name,
          monetizationMode: event!.monetizationMode,
          currency: event!.currency,
          fixedAmountCents: event!.fixedAmountCents ?? null,
          pwywMinCents: event!.pwywMinCents ?? null,
        },
        ...eventCommon,
      });
    }
    if (ppv.kind === "deny") {
      return res.status(ppv.status).json({ ok: false, error: ppv.error, message: PPV_DENY_MESSAGES[ppv.error], ...eventCommon });
    }
    if (ppv.kind === "wait" || !live) {
      return res.json({
        ok: true,
        via: "entitlement",
        playbackUrl: null,
        expiresAt: null,
        protected: true,
        waiting: ppv.kind === "wait" ? ppv.reason : "offline",
        ...eventCommon,
      });
    }
    const issued = issuePlayback({ roomId, hls, mode: access.mode, entitlementId });
    if ("error" in issued) {
      console.error("[playback] HLS_PLAYBACK_SECRET missing; refusing protected playback", { roomId });
      return res.status(503).json({ error: issued.error, ...eventCommon });
    }
    return res.json({
      ok: true,
      via: "entitlement",
      playbackUrl: issued.playbackUrl,
      expiresAt: issued.expiresAt,
      protected: issued.protected,
      ...eventCommon,
    });
  }

  const decision = decideViewerAccess({
    access,
    viewer: { uid, email, isHost },
    hasEntitlement: !!entitlementId,
    ppvEvent: toPpvEventSummary(resolved.ppvEvent),
    ppvSalesOpen,
    subscriberProductAvailable: false,
  });

  if ("error" in decision) {
    return res.status(decision.status).json({
      ok: false,
      error: decision.error,
      message: decision.message,
      loginRequired: decision.error === "login_required" || undefined,
      checkoutRequired: decision.error === "checkout_required" || undefined,
      checkout: decision.checkout,
      ...common,
    });
  }

  if (!live) {
    return res.json({ ok: true, via: decision.via, playbackUrl: null, expiresAt: null, protected: access.mode !== "public", ...common });
  }

  const issued = issuePlayback({ roomId, hls, mode: access.mode, entitlementId });
  if ("error" in issued) {
    console.error("[playback] HLS_PLAYBACK_SECRET missing; refusing protected playback", { roomId });
    return res.status(503).json({ error: issued.error, ...common });
  }
  return res.json({
    ok: true,
    via: decision.via,
    playbackUrl: issued.playbackUrl,
    expiresAt: issued.expiresAt,
    protected: issued.protected,
    ...common,
  });
}

router.post("/rooms/:roomId/playback", limit, async (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!looksLikeId(roomId)) return res.status(400).json({ error: "invalid_room_id" });
  try {
    return await authorizeRoomPlayback(req, res, roomId);
  } catch (err: any) {
    console.error("[playback] room playback error", { roomId, error: err?.message || err });
    return res.status(500).json({ error: "server_error" });
  }
});

router.post("/channels/:embedId/playback", limit, async (req, res) => {
  const embedId = String(req.params.embedId || "").trim();
  if (!looksLikeId(embedId)) return res.status(400).json({ error: "invalid_input" });
  try {
    const snap = await db.collection("savedEmbeds").doc(embedId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });
    const embed = (snap.data() || {}) as any;
    if (embed.isDeleted || embed.archived) return res.status(404).json({ error: "embed_removed" });
    const roomId = String(embed.activeRoomId || embed.roomId || "").trim();
    if (!looksLikeId(roomId)) return res.status(404).json({ error: "not_found" });
    return await authorizeRoomPlayback(req, res, roomId, { channelId: embedId });
  } catch (err: any) {
    console.error("[playback] channel playback error", { embedId, error: err?.message || err });
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
