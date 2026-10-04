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
import { findClaimedCodeForDevice, getPurchase } from "../lib/monetization";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import { checkFeature } from "../lib/entitlements";
import { issuePlayback } from "../lib/hlsPlayback";
import { SlidingWindowLimiter, clientIp, rateLimit } from "../lib/rateLimit";

const router = Router();

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
  if (access.mode === "pay_per_view" && !isHost) {
    const eventId = resolved.ppvEvent?.id || access.ppvEventId || null;
    if (eventId) {
      entitlementId = await findPpvEntitlement(resolved, eventId, { uid, rawDeviceId: getDeviceId(req, res) });
    }
    if (!entitlementId && resolved.ownerUid) {
      const ent = await getEffectiveEntitlements(resolved.ownerUid);
      ppvSalesOpen = checkFeature(ent, "monetization").allowed && checkFeature(ent, "payPerView").allowed;
    }
  }

  const decision = decideViewerAccess({
    access,
    viewer: { uid, email, isHost },
    hasEntitlement: !!entitlementId,
    ppvEvent: toPpvEventSummary(resolved.ppvEvent),
    ppvSalesOpen,
    subscriberProductAvailable: false,
  });

  const common = { mode: access.mode, status: streamStatus, roomId, ...extra };
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
