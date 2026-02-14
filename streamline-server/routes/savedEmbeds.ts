import { Router } from "express";
import admin from "firebase-admin";
import { requireAuth } from "../middleware/requireAuth";
import { firestore as db } from "../firebaseAdmin";
import { ensureRoomDoc, DEFAULT_ROOM_HLS_CONFIG, type RoomHlsConfig } from "../services/rooms";
import { sanitizeDisplayName } from "../lib/sanitizeDisplayName";
import { asOptionalBoolean, asOptionalEnum, asTrimmedString } from "../lib/inputValidation";
import { isAdmin } from "../middleware/adminAuth";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import { LIMIT_ERRORS } from "../lib/limitErrors";

const router = Router();

async function getPlatformHlsEnabled(): Promise<boolean> {
  try {
    const snap = await db.collection("featureFlags").doc("hlsSettingsTab").get();
    const data = snap.exists ? snap.data() || {} : {};
    const hlsEnabled = (data as any).hlsEnabled;
    const enabled = (data as any).enabled;
    if (typeof hlsEnabled === "boolean") return hlsEnabled;
    if (typeof enabled === "boolean") return enabled;
    return true;
  } catch {
    return true;
  }
}

async function assertHlsSetupAllowed(req: any, res: any, uid: string): Promise<boolean> {
  const platformEnabled = await getPlatformHlsEnabled();
  if (!platformEnabled) {
    res.status(403).json({ error: LIMIT_ERRORS.FEATURE_DISABLED });
    return false;
  }

  const entitlements = await getEffectiveEntitlements(req.account || uid);
  const features: any = entitlements?.features || {};
  const canCustomize =
    typeof features.hlsCustomizationEnabled === "boolean"
      ? features.hlsCustomizationEnabled
      : typeof features.canCustomizeHlsPage === "boolean"
        ? features.canCustomizeHlsPage
        : !!(features.hls ?? features.hlsEnabled ?? features.canHls);

  if (!canCustomize) {
    res.status(403).json({ error: "hls_not_in_plan" });
    return false;
  }

  return true;
}

type SavedEmbedDoc = {
  // Stable identifier for the viewer page / saved embed.
  // This always matches the Firestore document id.
  savedEmbedId?: string;

  // Explicitly stored embed id so collection group queries can
  // match on a regular field instead of documentId.
  embedId?: string;

  // New schema fields
  name: string;
  description?: string;
  ownerId: string;
  createdBy: string;
  createdAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;

  // Soft-delete semantics
  isDeleted: boolean;
  deletedAt?: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;

  // Currently active host room for this viewer page (if any)
  activeRoomId?: string;

  // Legacy fields kept for backward compatibility with existing clients.
  // "label" mirrors "name" and may be removed once all callers migrate.
  label?: string;
  // TODO: rename roomId -> homeRoomId (metadata/guard only; viewer follows activeRoomId).
  roomId: string;
  archived?: boolean;
};

function viewerPath(savedEmbedId: string): string {
  return `/live/${savedEmbedId}`;
}

function errorResponse(res: any, status: number, code: "invalid_input" | "not_found" | "server_error") {
  return res.status(status).json({ error: code });
}

function buildFriendlyLivekitRoomName(req: any, label: string, roomId: string): string {
  const rawDisplayName = (req as any).account?.rawUser?.displayName;
  const displayName = sanitizeDisplayName(rawDisplayName).trim();

  const combined = displayName ? `${displayName} – ${label}` : label;
  const sanitized = sanitizeDisplayName(combined).trim();
  return sanitized || roomId;
}

function parseHlsConfigOverrides(input: unknown):
  | { ok: true; value: Partial<RoomHlsConfig> }
  | { ok: false; error: "invalid_input" } {
  if (input === undefined || input === null) return { ok: true, value: {} };
  if (typeof input !== "object") return { ok: false, error: "invalid_input" };

  const obj = input as any;

  const enabledRes = asOptionalBoolean(obj.enabled);
  if (!enabledRes.ok) return { ok: false, error: "invalid_input" };

  const titleRes = asTrimmedString(obj.title, { required: false });
  if (!titleRes.ok) return { ok: false, error: "invalid_input" };

  const subtitleRes = asTrimmedString(obj.subtitle, { required: false });
  if (!subtitleRes.ok) return { ok: false, error: "invalid_input" };

  const logoUrlRes = asTrimmedString(obj.logoUrl, { required: false });
  if (!logoUrlRes.ok) return { ok: false, error: "invalid_input" };

  const offlineMessageRes = asTrimmedString(obj.offlineMessage, { required: false });
  if (!offlineMessageRes.ok) return { ok: false, error: "invalid_input" };

  const themeRes = asOptionalEnum(obj.theme, ["dark", "light"] as const);
  if (!themeRes.ok) return { ok: false, error: "invalid_input" };

  const overrides: Partial<RoomHlsConfig> = {};
  if (enabledRes.value !== undefined) overrides.enabled = enabledRes.value;
  if (titleRes.value !== undefined) overrides.title = titleRes.value;
  if (subtitleRes.value !== undefined) overrides.subtitle = subtitleRes.value;
  if (logoUrlRes.value !== undefined) overrides.logoUrl = logoUrlRes.value;
  if (offlineMessageRes.value !== undefined) overrides.offlineMessage = offlineMessageRes.value;
  if (themeRes.value !== undefined) overrides.theme = themeRes.value;

  return { ok: true, value: overrides };
}

// POST /api/saved-embeds
router.post("/", requireAuth as any, async (req: any, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  if (!(await assertHlsSetupAllowed(req, res, uid))) return;

  // Accept either the new "name" field or legacy "label".
  const nameRes = asTrimmedString(req.body?.name, { required: false, maxLen: 60 });
  const labelRes = asTrimmedString(req.body?.label, { required: false, maxLen: 60 });
  const descriptionRes = asTrimmedString(req.body?.description, { required: false, maxLen: 200 });

  if (!nameRes.ok || !labelRes.ok || !descriptionRes.ok) {
    return errorResponse(res, 400, "invalid_input");
  }

  const resolvedName = (nameRes.value || labelRes.value || "").trim();
  if (!resolvedName) {
    return errorResponse(res, 400, "invalid_input");
  }

  const hlsOverridesRes = parseHlsConfigOverrides(req.body?.hlsConfig);
  if (!hlsOverridesRes.ok) {
    return errorResponse(res, 400, "invalid_input");
  }

  // Create a NEW Firestore roomId (canonical), and create a friendly LiveKit room name.
  const roomId = db.collection("rooms").doc().id;
  const livekitRoomName = buildFriendlyLivekitRoomName(req, resolvedName, roomId);

  // Pre-create the embed document reference so we know its id up front.
  const embedRef = db.collection("savedEmbeds").doc();
  const savedEmbedId = embedRef.id;

  try {
    await ensureRoomDoc({
      roomId,
      ownerId: uid,
      livekitRoomName,
      roomType: "rtc",
      initialStatus: "idle",
      savedEmbedId,
    });

    // Initialize rooms/{roomId}.hlsConfig via merge update.
    // Do NOT touch rooms/{roomId}.hls runtime state.
    const nextHlsConfig: RoomHlsConfig = {
      ...DEFAULT_ROOM_HLS_CONFIG,
      ...hlsOverridesRes.value,
      updatedAt: new Date().toISOString(),
    };

    await db.collection("rooms").doc(roomId).set({ hlsConfig: nextHlsConfig }, { merge: true });

    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

    const doc: SavedEmbedDoc = {
      savedEmbedId,
      embedId: savedEmbedId,
      name: resolvedName,
      ownerId: uid,
      createdBy: uid,
      createdAt: serverTimestamp,
      updatedAt: serverTimestamp,
      isDeleted: false,
      activeRoomId: null as any, // stored as null until a host room links this embed

      // Legacy fields
      label: resolvedName,
      roomId,
      archived: false,
    };

    // Only set description when provided to avoid any undefined
    // values in the initial Firestore document.
    if (descriptionRes.value !== undefined) {
      (doc as any).description = descriptionRes.value;
    }

    await embedRef.set(doc as any, { merge: false });

    return res.status(201).json({
      success: true,
      embed: {
        embedId: embedRef.id,
        label: resolvedName,
        roomId,
        viewerPath: viewerPath(savedEmbedId),
      },
    });
  } catch (err) {
    console.error("POST /api/saved-embeds error", err);
    return errorResponse(res, 500, "server_error");
  }
});

// GET /api/saved-embeds
router.get("/", requireAuth as any, async (req: any, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    // Query top-level collection by owner + archived flag, then sort in memory by updatedAt desc.
    // NOTE: This may require a composite index on (ownerId, archived).
    const snap = await db
      .collection("savedEmbeds")
      .where("ownerId", "==", uid)
      .where("archived", "==", false)
      .get();

    const embeds = snap.docs
      .map((d) => {
        const data = (d.data() || {}) as Partial<SavedEmbedDoc>;
        const roomId = String(data.roomId || "");
        const label = String((data.name || data.label || ""));
        const description = typeof data.description === "string" ? data.description : "";
        const activeRoomId = typeof data.activeRoomId === "string" ? data.activeRoomId : null;

        // Firestore admin timestamps expose toMillis; fall back to 0 if missing.
        const updatedAtRaw: any = data.updatedAt as any;
        let updatedAtMs = 0;
        try {
          if (updatedAtRaw?.toMillis) {
            updatedAtMs = updatedAtRaw.toMillis();
          } else if (typeof updatedAtRaw === "string") {
            const t = Date.parse(updatedAtRaw);
            if (!Number.isNaN(t)) updatedAtMs = t;
          }
        } catch {
          updatedAtMs = 0;
        }

        return {
          embedId: d.id,
          label,
          roomId,
          viewerPath: viewerPath(d.id),
          description,
          activeRoomId,
          _updatedAtMs: updatedAtMs,
        };
      })
      .sort((a, b) => b._updatedAtMs - a._updatedAtMs)
      .map(({ _updatedAtMs, ...rest }) => rest);

    return res.json({ embeds });
  } catch (err) {
    console.error("GET /api/saved-embeds error", err);
    return errorResponse(res, 500, "server_error");
  }
});

// Public resolver for viewer pages using /live/:savedEmbedId.
// Does not require auth and looks up the embed across all users via a collection group query.
router.get("/public/:savedEmbedId", async (req: any, res) => {
  const savedEmbedId = String(req.params.savedEmbedId || "").trim();
  if (!savedEmbedId) {
    return res.status(400).json({ error: "invalid_input" });
  }

  try {
    const docSnap = await db.collection("savedEmbeds").doc(savedEmbedId).get();
    if (!docSnap.exists) {
      return res.status(404).json({ error: "not_found" });
    }

    const data = (docSnap.data() || {}) as Partial<SavedEmbedDoc>;

    // Treat soft-deleted/archived embeds as not found for public viewers
    // so the /live/:id page can show a clear "link removed" state.
    if (data.isDeleted || data.archived) {
      return res.status(404).json({ error: "embed_removed" });
    }

    const name = String((data.name || data.label || "")).trim();
    const description = (data.description || "") as string | undefined;
    const activeRoomId = typeof data.activeRoomId === "string" ? data.activeRoomId : null;

    return res.json({
      savedEmbedId,
      name,
      description,
      activeRoomId,
      viewerPath: viewerPath(savedEmbedId),
    });
  } catch (err) {
    console.error("GET /api/saved-embeds/public/:savedEmbedId error", err);
    return errorResponse(res, 500, "server_error");
  }
});

// PUT /api/saved-embeds/:embedId
router.put("/:embedId", requireAuth as any, async (req: any, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  if (!(await assertHlsSetupAllowed(req, res, uid))) return;

  const embedId = String(req.params.embedId || "").trim();
  if (!embedId) return errorResponse(res, 400, "invalid_input");

  const nameRes = asTrimmedString(req.body?.name, { required: false, maxLen: 60 });
  const labelRes = asTrimmedString(req.body?.label, { required: false, maxLen: 60 });
  const descriptionRes = asTrimmedString(req.body?.description, { required: false, maxLen: 200 });
  if (!nameRes.ok || !labelRes.ok || !descriptionRes.ok) return errorResponse(res, 400, "invalid_input");

  const archivedRes = asOptionalBoolean(req.body?.archived ?? req.body?.isDeleted);
  if (!archivedRes.ok) return errorResponse(res, 400, "invalid_input");

  // Require at least one field.
  if (nameRes.value === undefined && labelRes.value === undefined && descriptionRes.value === undefined && archivedRes.value === undefined) {
    return errorResponse(res, 400, "invalid_input");
  }

  // If label is provided, it must not be empty after trimming.
  if (nameRes.value !== undefined && !nameRes.value) {
    return errorResponse(res, 400, "invalid_input");
  }
  if (labelRes.value !== undefined && !labelRes.value) {
    return errorResponse(res, 400, "invalid_input");
  }
  try {
    const ref = db.collection("savedEmbeds").doc(embedId);
    const snap = await ref.get();
    if (!snap.exists) {
      return errorResponse(res, 404, "not_found");
    }

    const existing = (snap.data() || {}) as Partial<SavedEmbedDoc>;
    const ownerId = String((existing.ownerId || (existing as any).createdBy || "").trim());
    if (ownerId && ownerId !== uid) {
      const adminOk = await isAdmin(uid);
      if (!adminOk) {
        return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
      }
    }

    const patch: any = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const resolvedNameUpdate = (nameRes.value || labelRes.value) ?? undefined;
    if (resolvedNameUpdate !== undefined) {
      patch.name = resolvedNameUpdate;
      patch.label = resolvedNameUpdate; // keep legacy field in sync
    }
    if (descriptionRes.value !== undefined) {
      patch.description = descriptionRes.value;
    }
    if (archivedRes.value !== undefined) {
      patch.archived = archivedRes.value;
      patch.isDeleted = archivedRes.value;
      patch.deletedAt = archivedRes.value ? admin.firestore.FieldValue.serverTimestamp() : null;
    }

    await ref.set(patch, { merge: true });

    const updated = await ref.get();
    const data = (updated.data() || {}) as Partial<SavedEmbedDoc>;

    const roomId = String(data.roomId || "");
    const label = String(data.label || "");

    return res.json({
      success: true,
      embed: {
        embedId,
        label,
        roomId,
        viewerPath: viewerPath(embedId),
      },
    });
  } catch (err) {
    console.error("PUT /api/saved-embeds/:embedId error", err);
    return errorResponse(res, 500, "server_error");
  }
});

export default router;
