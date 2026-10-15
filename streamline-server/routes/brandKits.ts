import { Router } from "express";
import admin from "firebase-admin";
import { requireAuth } from "../middleware/requireAuth";
import { firestore as db } from "../firebaseAdmin";
import { type FeatureCheck } from "../lib/entitlements";
import { LIMIT_ERRORS } from "../lib/limitErrors";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import {
  BRAND_KIT_LIMITS,
  isValidKitId,
  parseBrandKitInput,
  requiredKitFeatures,
  serializeBrandKit,
} from "../lib/brandKitsPure";
import { DEFAULT_KIT_VIDEO, normalizeKitVideo } from "../lib/programOverlayPure";
import { brandKitsCol, getBrandKitAccess, getDefaultBrandKitId, getOwnedBrandKit } from "../services/brandKits";
import { syncBrandKitRooms, syncRoomProgramOverlay } from "../services/programOverlay";

/**
 * Brand kits: reusable branding owned by the signed-in account, mounted at
 * /api/brand-kits. A kit has viewer-page fields (gated like channel
 * branding: entitlements.features.hlsCustomization) and on-video settings
 * drawn by the program compositor (features.roomBranding). Creating,
 * renaming, defaults and assignment need either feature. Deleting a kit or
 * clearing a default/assignment is always allowed (cleanup).
 */
const router = Router();

const DENIED_ERROR = { hlsCustomization: "brand_kits_not_in_plan", roomBranding: "room_branding_not_in_plan" } as const;

function deny(res: any, check: FeatureCheck, feature: keyof typeof DENIED_ERROR) {
  res.status(403).json({
    error: check.code === LIMIT_ERRORS.FEATURE_DISABLED ? LIMIT_ERRORS.FEATURE_DISABLED : DENIED_ERROR[feature],
    feature,
  });
}

/**
 * Writes 403 and returns false unless the account may make this change:
 * every listed feature, or (when `any`) at least one kit feature.
 */
async function assertKitAllowed(
  uid: string,
  res: any,
  required: { features: Array<keyof typeof DENIED_ERROR>; any: boolean }
): Promise<boolean> {
  const access = await getBrandKitAccess(uid);
  if (required.any && !access.any) {
    deny(res, access.viewer, "hlsCustomization");
    return false;
  }
  for (const f of required.features) {
    const check = f === "hlsCustomization" ? access.viewer : access.video;
    if (!check.allowed) {
      deny(res, check, f);
      return false;
    }
  }
  return true;
}

const ANY_KIT_FEATURE = { features: [], any: true };

// GET /api/brand-kits -> { kits, defaultKitId, canEdit, blockedReason }
router.get("/", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "");
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  try {
    const [snap, defaultKitId, access] = await Promise.all([
      brandKitsCol().where("ownerId", "==", uid).get(),
      getDefaultBrandKitId(uid),
      getBrandKitAccess(uid),
    ]);
    const kits = snap.docs
      .map((d) => serializeBrandKit(d.id, d.data()))
      .sort((a, b) => a.name.localeCompare(b.name));
    const reason = (c: FeatureCheck) => (c.allowed ? null : c.code === LIMIT_ERRORS.FEATURE_DISABLED ? "platform" : "plan");
    return res.json({
      kits,
      // A default pointing at a deleted kit reads as "no default".
      defaultKitId: defaultKitId && kits.some((k) => k.id === defaultKitId) ? defaultKitId : null,
      canEdit: access.any,
      canEditViewer: access.viewer.allowed,
      canEditVideo: access.video.allowed,
      // Why editing is blocked entirely: the plan, or the platform-wide HLS switch.
      blockedReason: access.any ? null : reason(access.viewer),
      videoBlockedReason: reason(access.video),
    });
  } catch (err) {
    console.error("GET /api/brand-kits error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// POST /api/brand-kits { name, title?, subtitle?, logoUrl?, offlineMessage?, theme?, video?, makeDefault? }
router.post("/", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "");
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  const parsed = parseBrandKitInput(req.body, { partial: false });
  if (!parsed.ok) return res.status(400).json({ error: "invalid_input", field: parsed.field, details: parsed.details });
  const video = { ...DEFAULT_KIT_VIDEO, ...parsed.video };
  try {
    if (!(await assertKitAllowed(uid, res, requiredKitFeatures(null, parsed.value, video)))) return;
    const existing = await brandKitsCol().where("ownerId", "==", uid).get();
    if (existing.size >= BRAND_KIT_LIMITS.maxKitsPerOwner) {
      return res.status(409).json({ error: "brand_kit_limit_reached", limit: BRAND_KIT_LIMITS.maxKitsPerOwner });
    }
    const ref = brandKitsCol().doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.set({ ...parsed.value, video, ownerId: uid, createdAt: now, updatedAt: now });
    if (req.body?.makeDefault === true) {
      await db.collection("users").doc(uid).set({ brandKitDefaultId: ref.id }, { merge: true });
    }
    const saved = await ref.get();
    return res.status(201).json({
      kit: serializeBrandKit(ref.id, saved.data()),
      defaultKitId: req.body?.makeDefault === true ? ref.id : await getDefaultBrandKitId(uid),
    });
  } catch (err) {
    console.error("POST /api/brand-kits error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// PUT /api/brand-kits/default { kitId: string | null }
// Declared before /:kitId so "default" is never read as a kit id.
router.put("/default", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "");
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  const kitId = req.body?.kitId;
  try {
    if (kitId === null || kitId === "") {
      await db.collection("users").doc(uid).set({ brandKitDefaultId: null }, { merge: true });
      return res.json({ defaultKitId: null });
    }
    if (!isValidKitId(kitId)) return res.status(400).json({ error: "invalid_input", field: "kitId" });
    if (!(await getOwnedBrandKit(kitId, uid))) return res.status(404).json({ error: "brand_kit_not_found" });
    if (!(await assertKitAllowed(uid, res, ANY_KIT_FEATURE))) return;
    await db.collection("users").doc(uid).set({ brandKitDefaultId: kitId }, { merge: true });
    return res.json({ defaultKitId: kitId });
  } catch (err) {
    console.error("PUT /api/brand-kits/default error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// PUT /api/brand-kits/:kitId { name?, title?, subtitle?, logoUrl?, offlineMessage?, theme?, video? (partial) }
router.put("/:kitId", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "");
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  const kitId = String(req.params.kitId || "").trim();
  if (!isValidKitId(kitId)) return res.status(400).json({ error: "invalid_input", field: "kitId" });
  const parsed = parseBrandKitInput(req.body, { partial: true });
  if (!parsed.ok) return res.status(400).json({ error: "invalid_input", field: parsed.field, details: parsed.details });
  try {
    // Not-found and not-yours look the same, so kit ids can't be probed.
    const existing = await getOwnedBrandKit(kitId, uid);
    if (!existing) return res.status(404).json({ error: "brand_kit_not_found" });
    const video = { ...normalizeKitVideo(existing.video), ...parsed.video };
    if (!(await assertKitAllowed(uid, res, requiredKitFeatures(existing, parsed.value, video)))) return;
    const ref = brandKitsCol().doc(kitId);
    await ref.set({ ...parsed.value, video, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    const saved = await ref.get();
    // Rooms live with this kit pick up the change now.
    await syncBrandKitRooms(kitId, uid);
    return res.json({ kit: serializeBrandKit(kitId, saved.data()) });
  } catch (err) {
    console.error("PUT /api/brand-kits/:kitId error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// DELETE /api/brand-kits/:kitId
// Rooms that still point at the kit fall back to their own hlsConfig branding
// (the public resolvers ignore missing kits), so no room rewrite is needed.
router.delete("/:kitId", requireAuth as any, async (req: any, res) => {
  const uid = String(req.user?.uid || "");
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  const kitId = String(req.params.kitId || "").trim();
  if (!isValidKitId(kitId)) return res.status(400).json({ error: "invalid_input", field: "kitId" });
  try {
    if (!(await getOwnedBrandKit(kitId, uid))) return res.status(404).json({ error: "brand_kit_not_found" });
    await brandKitsCol().doc(kitId).delete();
    if ((await getDefaultBrandKitId(uid)) === kitId) {
      await db.collection("users").doc(uid).set({ brandKitDefaultId: null }, { merge: true });
    }
    // Live rooms that used it stop drawing its branding.
    await syncBrandKitRooms(kitId, uid);
    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/brand-kits/:kitId error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * Room assignment, mounted at /api/rooms:
 * PUT /api/rooms/:roomId/brand-kit { brandKitId: string | null }
 * Owner (or platform admin) only: co-hosts can't change the owner's branding.
 */
export const roomBrandKitRouter = Router();

roomBrandKitRouter.put("/:roomId/brand-kit", requireAuth as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });
  const raw = req.body?.brandKitId;
  if (raw !== null && raw !== "" && !isValidKitId(raw)) {
    return res.status(400).json({ error: "invalid_input", field: "brandKitId" });
  }
  const kitId = typeof raw === "string" && raw ? raw.trim() : null;
  try {
    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      return res.status(403).json({ error: "branding_owner_only" });
    }
    const ownerUid = String((ctx.room as any).ownerId || "").trim();
    if (kitId) {
      if (!ownerUid || !(await getOwnedBrandKit(kitId, ownerUid))) {
        return res.status(404).json({ error: "brand_kit_not_found" });
      }
      if (!(await assertKitAllowed(ownerUid, res, ANY_KIT_FEATURE))) return;
    }
    await db.collection("rooms").doc(ctx.roomId).set({ brandKitId: kitId }, { merge: true });
    // A running room picks up (or drops) the kit's on-video branding now.
    await syncRoomProgramOverlay(ctx.roomId, { ...(ctx.room as any), brandKitId: kitId }, { clearWhenNoKit: true });
    return res.json({ roomId: ctx.roomId, brandKitId: kitId });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) return res.status(err.status).json({ error: err.code });
    console.error("PUT /api/rooms/:roomId/brand-kit error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
