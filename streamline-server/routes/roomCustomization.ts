import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { firestore as db } from "../firebaseAdmin";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { isRoomCustomizationEnabled } from "../lib/platformFeatureFlags";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import type { RoomCustomizationConfig } from "../types/roomCustomization";

const router = Router();

/**
 * Public subset of RoomCustomizationConfig — safe to return to unauthenticated guests.
 * Contains only visual/presentation fields; no secrets, runtime controls, or
 * host-only configuration.
 */
type PublicRoomCustomization = {
  enabled?: boolean;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  backgroundMode?: "banner" | "full" | "none";
  tileScale?: number;
  verticalOffset?: number;
  logoAlignment?: "left" | "center" | "right";
  bannerAlignment?: "top" | "center" | "bottom";
  banner?: {
    enabled: boolean;
    url: string;
    position: "top" | "bottom";
    height: number;
    opacity: number;
  };
  roomBackground?: {
    enabled: boolean;
    type: "image" | "gradient" | "solid";
    url?: string;
    value?: string;
    overlayOpacity?: number;
  };
  placeholderMedia?: {
    enabled: boolean;
    imageUrl: string;
    title?: string;
    subtitle?: string;
  };
  greenroom?: {
    waitingRoomMessage?: string;
  };
  layoutStyle?: "default" | "speaker" | "grid" | "host-focus";
};

function normalizeRoomId(raw: string | undefined): string {
  return String(raw || "").trim();
}

const DEFAULT_TILE_SCALE = 0.8;
const DEFAULT_VERTICAL_OFFSET = 84;

function toTrimmedNullableString(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const next = input.trim();
  return next ? next : null;
}

function clampTileScale(input: unknown): number {
  const value = Number(input);
  if (!Number.isFinite(value)) return DEFAULT_TILE_SCALE;
  return Math.max(0.5, Math.min(1, value));
}

function clampVerticalOffset(input: unknown): number {
  const value = Number(input);
  if (!Number.isFinite(value)) return DEFAULT_VERTICAL_OFFSET;
  return Math.max(0, Math.min(320, Math.round(value)));
}

function normalizeCustomization(input: RoomCustomizationConfig | undefined | null): RoomCustomizationConfig {
  const src = input || {};

  const logoUrl = toTrimmedNullableString((src as any).logoUrl);
  const bannerUrl = toTrimmedNullableString((src as any).bannerUrl) ?? toTrimmedNullableString(src.banner?.url);
  const backgroundMode =
    src.backgroundMode === "banner" || src.backgroundMode === "full" || src.backgroundMode === "none"
      ? src.backgroundMode
      : src.roomBackground?.enabled
      ? "full"
      : bannerUrl
      ? "banner"
      : "none";

  const next: RoomCustomizationConfig = {
    ...src,
    enabled: src.enabled === true,
    logoUrl,
    bannerUrl,
    backgroundMode,
    tileScale: clampTileScale(src.tileScale),
    verticalOffset: clampVerticalOffset(src.verticalOffset),
    logoAlignment:
      src.logoAlignment === "center" || src.logoAlignment === "right" ? src.logoAlignment : "left",
    bannerAlignment:
      src.bannerAlignment === "top" || src.bannerAlignment === "bottom" ? src.bannerAlignment : "center",
  };

  return next;
}

async function assertCustomizationEntitlement(req: any, uid?: string): Promise<boolean> {
  if (!uid) return true;
  if (req?.account?.isAdmin || req?.account?.adminOverride || req?.account?.adminOverrideHls) {
    return true;
  }

  const entitlements = await getEffectiveEntitlements(req.account || uid);
  return entitlements?.features?.canCustomizeRooms === true;
}

/**
 * GET /api/rooms/:roomId/customization
 *
 * Returns the current room customization config stored at
 * rooms/{roomId}.settings.customization.
 *
 * Requires: authenticated host or co-host with canLayout permission.
 */
router.get("/:roomId/customization", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: "invalid_room_id" });
  }

  try {
    const platformEnabled = await isRoomCustomizationEnabled();
    if (!platformEnabled) {
      return res.status(409).json({
        error: "feature_disabled",
        feature: "roomCustomizationEnabled",
      });
    }

    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");
    const entitled = await assertCustomizationEntitlement(req, ctx.uid);
    if (!entitled) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const settings = (ctx.room as any).settings || {};
    const customization: RoomCustomizationConfig = normalizeCustomization(settings.customization || {});

    return res.json({
      ok: true,
      roomId: ctx.roomId,
      customization,
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    console.error("GET /api/rooms/:roomId/customization error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * PUT /api/rooms/:roomId/customization
 *
 * Saves the room customization config to rooms/{roomId}.settings.customization.
 * Only updates the fields present in the request body (shallow merge).
 *
 * Requires: authenticated host or co-host with canLayout permission.
 *
 * Security: these are presentation-only fields.
 * Access control / greenroom policy is handled separately via roomsPolicy routes.
 */
router.put("/:roomId/customization", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: "invalid_room_id" });
  }

  const body = req.body || {};

  // Validate top-level shape — we accept only known keys.
  const allowedKeys: Array<keyof RoomCustomizationConfig> = [
    "enabled",
    "logoUrl",
    "bannerUrl",
    "backgroundMode",
    "tileScale",
    "verticalOffset",
    "logoAlignment",
    "bannerAlignment",
    "banner",
    "roomBackground",
    "placeholderMedia",
    "layoutStyle",
    "introClip",
    "roomSfx",
    "greenroom",
  ];

  const unknownKeys = Object.keys(body).filter((k) => !allowedKeys.includes(k as any));
  if (unknownKeys.length > 0) {
    return res.status(400).json({
      error: "invalid_input",
      details: `Unknown customization keys: ${unknownKeys.join(", ")}`,
    });
  }

  // Validate layoutStyle when provided.
  if (body.layoutStyle !== undefined) {
    const validLayouts = ["default", "speaker", "grid", "host-focus"];
    if (!validLayouts.includes(body.layoutStyle)) {
      return res.status(400).json({
        error: "invalid_input",
        details: `layoutStyle must be one of: ${validLayouts.join(", ")}`,
      });
    }
  }

  // Validate roomSfx.allowedEffects when provided.
  if (body.roomSfx?.allowedEffects !== undefined) {
    const validEffects = ["applause", "boo", "crickets", "airhorn"];
    const effects: string[] = Array.isArray(body.roomSfx.allowedEffects) ? body.roomSfx.allowedEffects : [];
    const invalidEffects = effects.filter((e: string) => !validEffects.includes(e));
    if (invalidEffects.length > 0) {
      return res.status(400).json({
        error: "invalid_input",
        details: `Invalid sound effects: ${invalidEffects.join(", ")}. Allowed: ${validEffects.join(", ")}`,
      });
    }
  }

  try {
    const platformEnabled = await isRoomCustomizationEnabled();
    if (!platformEnabled) {
      return res.status(409).json({
        error: "feature_disabled",
        feature: "roomCustomizationEnabled",
      });
    }

    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");
    const entitled = await assertCustomizationEntitlement(req, ctx.uid);
    if (!entitled) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    // Merge the incoming fields onto the existing customization object.
    const existing: RoomCustomizationConfig = normalizeCustomization(((ctx.room as any).settings?.customization) || {});
    const next: RoomCustomizationConfig = { ...existing };

    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        if (body[key] === null || body[key] === undefined) {
          // Explicit null/undefined removes the sub-key.
          delete (next as any)[key];
        } else {
          (next as any)[key] = body[key];
        }
      }
    }

    const normalizedNext = normalizeCustomization(next);

    await db.collection("rooms").doc(ctx.roomId).set(
      { settings: { customization: normalizedNext } },
      { merge: true }
    );

    return res.json({
      ok: true,
      roomId: ctx.roomId,
      customization: normalizedNext,
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    console.error("PUT /api/rooms/:roomId/customization error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * GET /api/rooms/:roomId/customization/public
 *
 * Auth: NONE — fully public, read-only.
 *
 * Returns a safe subset of the room customization config for use in
 * guest-facing pages (Greenroom waiting room, invite pages, etc.).
 *
 * Security: Only presentation-layer fields are returned.
 * No secrets, IDs, or access-control data are exposed.
 */
router.get("/:roomId/customization/public", async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: "invalid_room_id" });
  }

  try {
    const platformEnabled = await isRoomCustomizationEnabled();
    if (!platformEnabled) {
      return res.status(404).json({ error: "feature_not_available" });
    }

    const snap = await db.collection("rooms").doc(roomId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    }

    const room = (snap.data() as any) || {};
    const raw: RoomCustomizationConfig = normalizeCustomization(room.settings?.customization || {});

    // Extract only safe, public presentation fields.
    // Intentionally omit introClip (runtime control), roomSfx (host-only),
    // and any field that could reveal operational state.
    const pub: PublicRoomCustomization = {};

    pub.enabled = raw.enabled === true;
    pub.logoUrl = toTrimmedNullableString((raw as any).logoUrl);
    pub.bannerUrl = toTrimmedNullableString((raw as any).bannerUrl);
    pub.backgroundMode =
      raw.backgroundMode === "banner" || raw.backgroundMode === "full" || raw.backgroundMode === "none"
        ? raw.backgroundMode
        : "none";
    pub.tileScale = clampTileScale(raw.tileScale);
    pub.verticalOffset = clampVerticalOffset(raw.verticalOffset);
    pub.logoAlignment =
      raw.logoAlignment === "center" || raw.logoAlignment === "right" ? raw.logoAlignment : "left";
    pub.bannerAlignment =
      raw.bannerAlignment === "top" || raw.bannerAlignment === "bottom" ? raw.bannerAlignment : "center";

    if (raw.banner?.enabled) {
      pub.banner = {
        enabled: true,
        url: String(raw.banner.url || ""),
        position: raw.banner.position === "top" ? "top" : "bottom",
        height: Number(raw.banner.height) || 80,
        opacity: typeof raw.banner.opacity === "number" ? raw.banner.opacity : 1,
      };
    }

    if (raw.roomBackground?.enabled) {
      const bg = raw.roomBackground;
      pub.roomBackground = {
        enabled: true,
        type: bg.type === "image" || bg.type === "gradient" ? bg.type : "solid",
        url: typeof bg.url === "string" ? bg.url : undefined,
        value: typeof bg.value === "string" ? bg.value : undefined,
        overlayOpacity: typeof bg.overlayOpacity === "number" ? bg.overlayOpacity : undefined,
      };
    }

    if (raw.placeholderMedia?.enabled) {
      pub.placeholderMedia = {
        enabled: true,
        imageUrl: String(raw.placeholderMedia.imageUrl || ""),
        title: typeof raw.placeholderMedia.title === "string" ? raw.placeholderMedia.title : undefined,
        subtitle: typeof raw.placeholderMedia.subtitle === "string" ? raw.placeholderMedia.subtitle : undefined,
      };
    }

    if (raw.greenroom) {
      pub.greenroom = {
        waitingRoomMessage: typeof raw.greenroom.waitingRoomMessage === "string"
          ? raw.greenroom.waitingRoomMessage
          : undefined,
      };
    }

    if (raw.layoutStyle) {
      pub.layoutStyle = raw.layoutStyle;
    }

    return res.json({
      ok: true,
      roomId,
      customization: pub,
    });
  } catch (err) {
    console.error("GET /api/rooms/:roomId/customization/public error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
