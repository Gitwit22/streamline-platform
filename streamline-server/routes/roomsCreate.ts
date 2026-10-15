import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { firestore as db } from "../firebaseAdmin";
import { ensureRoomDoc } from "../services/rooms";
import { sanitizeDisplayName } from "../lib/sanitizeDisplayName";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { normalizeRoomLayout, type RoomLayout } from "../lib/roomLayout";
import { isValidPresenceMode, normalizePresenceMode, type PresenceMode } from "../lib/presenceMode";
import { logDelegatedRoomAction, resolveOwnerActingContext } from "../lib/collaborators";
import {
  accessFromCreateBody,
  normalizeRoomAccessMode,
  resolveRoomAccessMode,
  type RoomAccessMode,
} from "../lib/roomAccessPolicy";
import { pickCreateBrandKit } from "../lib/brandKitsPure";
import { newRoomNaming } from "../lib/roomNamingPure";
import { channelBindingAllowed } from "../lib/channelBindingPure";
import { getBrandKitAccess, getDefaultBrandKitId, getOwnedBrandKit } from "../services/brandKits";
import { LIMIT_ERRORS } from "../lib/limitErrors";

const router = Router();

/**
 * POST /api/rooms/create
 * Creates a new Firestore room document and returns its id.
 * Body: { livekitRoomName?: string, roomType?: "rtc" | "hls", presenceMode?: PresenceMode,
 *         access?: "invite_only" | "link" | "public",   (default invite_only)
 *         brandKitId?: string | null }  (omitted = owner's default kit, null = none)
 *
 * roomId is generated from Firestore (roomsRef.doc().id).
 */
router.post("/create", requireAuth as any, async (req: any, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  const actingContext = await resolveOwnerActingContext(req);
  if (!actingContext) {
    return res.status(403).json({ error: "invalid_owner_context" });
  }
  if (actingContext.isDelegated && !actingContext.permissions?.createRooms) {
    return res.status(403).json({ error: "delegation_create_rooms_denied" });
  }
  const ownerUid = actingContext.ownerUid || uid;

  const roomType = (req.body?.roomType || "rtc") as "rtc" | "hls";

  // Presence mode for the room creator (normal/invisible; "silent" → "invisible")
  const rawPresenceMode = req.body?.presenceMode;
  const presenceMode: PresenceMode = isValidPresenceMode(rawPresenceMode)
    ? normalizePresenceMode(rawPresenceMode)
    : "normal";

  // Room access for the production room: invite_only (default) | link | public.
  // An explicit but unknown value is rejected rather than silently widened.
  if (req.body?.access !== undefined && req.body?.access !== null && !normalizeRoomAccessMode(req.body.access)) {
    return res.status(400).json({ error: "invalid_access" });
  }
  const access: RoomAccessMode = accessFromCreateBody(req.body);
  const requiresPayment = typeof req.body?.requiresPayment === "boolean" ? req.body.requiresPayment : undefined;
  const rawNameInput = String(req.body?.livekitRoomName || req.body?.roomName || "");
  const rawName = sanitizeDisplayName(rawNameInput).trim();

  // Optional: bind this room to an existing Saved Embed so HLS can
  // automatically keep viewer pages in sync. This is set from the Join
  // page when a host chooses "Join Saved Room".
  const savedEmbedIdRaw = req.body?.savedEmbedId;
  const savedEmbedId = typeof savedEmbedIdRaw === "string" ? savedEmbedIdRaw.trim() : "";
  // Only the owner's own channel can be bound (otherwise HLS start would take
  // over someone else's /live page).
  if (savedEmbedId) {
    if (savedEmbedId.includes("/")) return res.status(400).json({ error: "invalid_saved_embed" });
    try {
      const embedSnap = await db.collection("savedEmbeds").doc(savedEmbedId).get();
      if (!channelBindingAllowed(embedSnap.exists ? embedSnap.data() : null, ownerUid)) {
        return res.status(403).json({ error: "saved_embed_not_owned" });
      }
    } catch (err) {
      console.error("/api/rooms/create saved embed lookup failed", err);
      return res.status(500).json({ error: "server_error" });
    }
  }

  // Brand kit: an explicit choice must be the owner's kit and within the
  // owner's plan (errors are reported); the owner's default kit is applied
  // best-effort (any problem just creates the room without a kit).
  const defaultKitId =
    req.body?.brandKitId === undefined ? await getDefaultBrandKitId(ownerUid).catch(() => null) : null;
  const kitPick = pickCreateBrandKit(req.body?.brandKitId, defaultKitId);
  if (kitPick.source === "invalid") {
    return res.status(400).json({ error: "invalid_brand_kit" });
  }
  let brandKitId: string | undefined = undefined;
  if (kitPick.source === "explicit" || kitPick.source === "default") {
    const explicit = kitPick.source === "explicit";
    try {
      const kit = await getOwnedBrandKit(kitPick.kitId, ownerUid);
      // Either kit feature (viewer page or on-video branding) lets a room use a kit.
      const access = kit ? await getBrandKitAccess(ownerUid) : null;
      if (!kit) {
        if (explicit) return res.status(400).json({ error: "invalid_brand_kit" });
      } else if (!access!.any) {
        if (explicit) {
          return res.status(403).json({
            error: access!.viewer.code === LIMIT_ERRORS.FEATURE_DISABLED ? LIMIT_ERRORS.FEATURE_DISABLED : "brand_kits_not_in_plan",
          });
        }
      } else {
        brandKitId = kitPick.kitId;
      }
    } catch (err) {
      if (explicit) {
        console.error("/api/rooms/create brand kit lookup failed", err);
        return res.status(500).json({ error: "server_error" });
      }
      console.warn("/api/rooms/create default brand kit skipped", err);
    }
  }

  // Generate a new Firestore document id for the room.
  const roomId = db.collection("rooms").doc().id;

  // The LiveKit room name is always the roomId; the typed name is display-only.
  const { livekitRoomName, displayName } = newRoomNaming(roomId, rawName);

  // Seed roomLayout from account defaults (users/{uid}.mediaPrefs.defaultRoomLayout)
  // so new rooms inherit the user's preferred layout without requiring per-room setup.
  let initialRoomLayout: RoomLayout | undefined = undefined;
  try {
    const userSnap = await db.collection("users").doc(ownerUid).get();
    const userData = userSnap.exists ? (userSnap.data() as any) || {} : {};
    const mediaPrefs = (userData as any)?.mediaPrefs || {};
    initialRoomLayout =
      normalizeRoomLayout(mediaPrefs.defaultRoomLayout) ||
      normalizeRoomLayout({ mode: mediaPrefs.defaultLayout }) ||
      undefined;
  } catch (err) {
    console.warn("/api/rooms/create failed to read mediaPrefs for initialRoomLayout", err);
  }

  try {
    const { data } = await ensureRoomDoc({
      roomId,
      ownerId: ownerUid,
      livekitRoomName,
      roomType,
      initialStatus: "idle",
      initialRoomLayout,
      savedEmbedId: savedEmbedId || undefined,
      access,
      requiresPayment,
      brandKitId,
      displayName,
    });

    return res.status(201).json({
      roomId,
      livekitRoomName: data.livekitRoomName || livekitRoomName,
      // What to show for the room (the typed name); livekitRoomName is the roomId.
      displayName: displayName || null,
      roomType: data.roomType || roomType,
      access: resolveRoomAccessMode(data as any),
      brandKitId: brandKitId || null,
      presenceMode,
      actingContext: {
        ownerUid,
        actedByUid: uid,
        isDelegated: actingContext.isDelegated,
        ownerDisplayName: actingContext.ownerDisplayName,
        ownerEmail: actingContext.ownerEmail,
      },
    });
  } catch (err) {
    console.error("/api/rooms/create ensureRoomDoc failed", err);
    return res.status(500).json({ error: "room_init_failed" });
  } finally {
    if (actingContext.isDelegated) {
      await logDelegatedRoomAction({
        actedByUid: uid,
        ownerUid,
        roomId,
        action: "room_create",
        metadata: {
          livekitRoomName,
          roomType,
        },
      }).catch(() => {});
    }
  }
});

export default router;
