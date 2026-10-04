import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { firestore as db } from "../firebaseAdmin";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import type { RoomHlsConfig } from "../services/rooms";
import { DEFAULT_ROOM_HLS_CONFIG } from "../services/rooms";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import { checkFeature, type EffectiveEntitlements, type FeatureKey } from "../lib/entitlements";
import { LIMIT_ERRORS } from "../lib/limitErrors";

const router = Router();

function normalizeRoomId(raw: string | undefined): string {
  return String(raw || "").trim();
}

const BRANDING_KEYS = ["title", "subtitle", "logoUrl", "offlineMessage", "theme"] as const;

/**
 * Which entitlement a PUT needs, given the stored room state. Only CHANGES
 * that turn something on / edit branding are gated; turning HLS, monetization
 * or PPV off (cleanup) is always allowed. Exported for tests.
 */
export function requiredHlsConfigFeatures(
  existing: { hlsConfig?: any; monetizationEnabled?: boolean; payPerViewEnabled?: boolean },
  body: any
): FeatureKey[] {
  const stored = (existing?.hlsConfig || {}) as Record<string, unknown>;
  const prev = { ...DEFAULT_ROOM_HLS_CONFIG, ...stored } as Record<string, unknown>;
  const out: FeatureKey[] = [];
  if (body?.enabled === true && stored.enabled !== true) out.push("hls");
  const norm = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  const brandingChanged = BRANDING_KEYS.some((k) => body?.[k] !== undefined && norm(body[k]) !== norm(prev[k]));
  if (brandingChanged) out.push("hlsCustomization");
  if (body?.monetizationEnabled === true && existing?.monetizationEnabled !== true) out.push("monetization");
  if (body?.payPerViewEnabled === true && existing?.payPerViewEnabled !== true) out.push("payPerView");
  return out;
}

function firstDenied(ent: EffectiveEntitlements, features: FeatureKey[]) {
  for (const f of features) {
    const check = checkFeature(ent, f);
    if (!check.allowed) return check;
  }
  return null;
}

const DENIED_ERROR_BY_FEATURE: Partial<Record<FeatureKey, string>> = {
  hls: "hls_not_in_plan",
  hlsCustomization: "hls_customization_not_in_plan",
  monetization: "monetization_not_enabled",
  payPerView: "ppv_not_entitled",
};

// GET /api/rooms/:roomId/hls-config
router.get("/:roomId/hls-config", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: "invalid_room_id" });
  }

  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");
    const raw = (ctx.room as any).hlsConfig as RoomHlsConfig | undefined;
    const hlsConfig: RoomHlsConfig = raw && typeof raw === "object" ? raw : DEFAULT_ROOM_HLS_CONFIG;

    return res.json({
      roomId: ctx.roomId,
      hlsConfig,
      monetizationEnabled: (ctx.room as any).monetizationEnabled === true,
      payPerViewEnabled: (ctx.room as any).payPerViewEnabled === true,
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    console.error("GET /api/rooms/:roomId/hls-config error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// PUT /api/rooms/:roomId/hls-config
router.put("/:roomId/hls-config", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: "invalid_room_id" });
  }

  const { enabled, title, subtitle, logoUrl, offlineMessage, theme, monetizationEnabled, payPerViewEnabled } = req.body || {};

  // Minimal validation and safe defaults
  if (typeof enabled !== "boolean") {
    return res.status(400).json({
      error: "invalid_input",
      details: "enabled (boolean) is required",
    });
  }
  if (title !== undefined && typeof title !== "string") {
    return res.status(400).json({ error: "invalid_input", details: "title must be a string" });
  }
  if (subtitle !== undefined && typeof subtitle !== "string") {
    return res.status(400).json({ error: "invalid_input", details: "subtitle must be a string" });
  }
  if (logoUrl !== undefined && typeof logoUrl !== "string") {
    return res.status(400).json({ error: "invalid_input", details: "logoUrl must be a string" });
  }
  if (offlineMessage !== undefined && typeof offlineMessage !== "string") {
    return res.status(400).json({ error: "invalid_input", details: "offlineMessage must be a string" });
  }
  if (theme !== undefined && theme !== "light" && theme !== "dark") {
    return res.status(400).json({
      error: "invalid_input",
      details: 'theme must be "light" or "dark" if provided',
    });
  }

  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");

    const existing = ((ctx.room as any).hlsConfig || {}) as RoomHlsConfig;

    // Entitlements of the ROOM OWNER (effective plan + platform kill switches).
    const needed = requiredHlsConfigFeatures(ctx.room as any, req.body || {});
    if (needed.length > 0) {
      const ownerUid = String((ctx.room as any).ownerId || req.user?.uid || "").trim();
      const ent = await getEffectiveEntitlements(ownerUid);
      const denied = firstDenied(ent, needed);
      if (denied) {
        return res.status(403).json({
          error:
            denied.code === LIMIT_ERRORS.FEATURE_DISABLED
              ? LIMIT_ERRORS.FEATURE_DISABLED
              : DENIED_ERROR_BY_FEATURE[denied.feature] || LIMIT_ERRORS.FEATURE_NOT_ENTITLED,
          feature: denied.feature,
          reason: denied.reason,
        });
      }
    }

    const nextConfig: RoomHlsConfig = {
      ...existing,
      enabled,
      updatedAt: new Date().toISOString(),
    };

    if (title !== undefined) nextConfig.title = title;
    if (subtitle !== undefined) nextConfig.subtitle = subtitle;
    if (logoUrl !== undefined) nextConfig.logoUrl = logoUrl;
    if (offlineMessage !== undefined) nextConfig.offlineMessage = offlineMessage;
    if (theme !== undefined) nextConfig.theme = theme;

    // Build the merge payload — always update hlsConfig, optionally update monetization toggles.
    const mergePayload: Record<string, any> = { hlsConfig: nextConfig };

    // Room-level monetization toggles (only persist when explicitly sent).
    if (typeof monetizationEnabled === "boolean") {
      // Monetization requires HLS to be enabled on this room.
      mergePayload.monetizationEnabled = nextConfig.enabled ? monetizationEnabled : false;
    }
    if (typeof payPerViewEnabled === "boolean") {
      // PPV requires both HLS AND monetization to be enabled.
      const effectiveMonetization = typeof monetizationEnabled === "boolean"
        ? monetizationEnabled
        : (ctx.room as any).monetizationEnabled === true;
      mergePayload.payPerViewEnabled = (nextConfig.enabled && effectiveMonetization) ? payPerViewEnabled : false;
    }

    // If HLS is being disabled, force-disable monetization + PPV.
    if (!nextConfig.enabled) {
      mergePayload.monetizationEnabled = false;
      mergePayload.payPerViewEnabled = false;
    }

    await db.collection("rooms").doc(ctx.roomId).set(mergePayload, { merge: true });

    return res.json({
      success: true,
      roomId: ctx.roomId,
      hlsConfig: nextConfig,
      monetizationEnabled: mergePayload.monetizationEnabled ?? (ctx.room as any).monetizationEnabled ?? false,
      payPerViewEnabled: mergePayload.payPerViewEnabled ?? (ctx.room as any).payPerViewEnabled ?? false,
    });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      // includes 403 forbidden, 404 room_not_found
      return res.status(err.status).json({ error: err.code });
    }
    console.error("PUT /api/rooms/:roomId/hls-config error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
