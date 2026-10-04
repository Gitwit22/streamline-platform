import { Router } from "express";
import { TrackSource } from "livekit-server-sdk";
import admin from "firebase-admin";
import { requireAuth } from "../middleware/requireAuth";
import { requireRoomAccessToken, type RoomAccessClaims, getRoomAccess } from "../middleware/roomAccessToken";
import { getLiveKitSdk } from "../lib/livekit";
import { resolveRoomIdentity } from "../lib/roomIdentity";
import {
  roleToParticipantPermission,
  restrictPermissionByControls,
  toLiveKitParticipantPermission,
  LIVEKIT_TRACK_SOURCE_ENUM,
  type LiveKitParticipantPermissionInit,
} from "../lib/livekitPermissions";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = Router();

// ---------------------------------------------------------------------------
// LiveKit helpers
// ---------------------------------------------------------------------------

type BaseRole = "viewer" | "guest" | "participant" | "cohost" | "host";

/** Defensive role normalizer: unknown roles return null (never throw). */
function normalizeBaseRole(raw: unknown): BaseRole | null {
  const r = String(raw || "").trim().toLowerCase();
  if (r === "viewer" || r === "guest" || r === "participant" || r === "cohost" || r === "host") return r;
  if (r === "moderator" || r === "speaker") return "participant";
  if (r === "co-host" || r === "co_host") return "cohost";
  return null;
}

async function getRoomServiceClient(): Promise<any | null> {
  const sdk = await getLiveKitSdk();
  const RoomServiceClient = (sdk as any)?.RoomServiceClient as any;
  if (!RoomServiceClient || !process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return null;
  }
  return new RoomServiceClient(process.env.LIVEKIT_URL, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

async function listLiveKitParticipants(roomService: any, livekitRoomName: string): Promise<any[]> {
  const listResp = await roomService.listParticipants(livekitRoomName);
  if (Array.isArray((listResp as any)?.participants)) return (listResp as any).participants;
  if (Array.isArray(listResp)) return listResp as any[];
  return [];
}

function mergeParticipantMetadata(existingRaw: unknown, patch: Record<string, unknown>): string {
  let existing: any = {};
  if (typeof existingRaw === "string" && existingRaw.trim()) {
    try {
      existing = JSON.parse(existingRaw) || {};
    } catch {
      existing = {};
    }
  }
  return JSON.stringify({ ...existing, ...patch });
}

function isLiveKitNotFound(err: unknown): boolean {
  const message = String((err as any)?.message || err || "");
  return message.includes("status 404") || message.toLowerCase().includes("not found") || (err as any)?.status === 404;
}

async function getRoomOwnerUid(roomId: string): Promise<string | null> {
  try {
    const snap = await admin.firestore().collection("rooms").doc(roomId).get();
    const data = (snap.data() || {}) as any;
    const owner = data.ownerId || data.ownerUid || data.hostUid || data.createdBy || null;
    return typeof owner === "string" && owner ? owner : null;
  } catch {
    return null;
  }
}

/** Identities that room controls must never restrict (the host/producers). */
function isProtectedIdentity(identity: string, ownerUid: string | null, extra: Array<string | null | undefined> = []): boolean {
  if (!identity) return true;
  if (ownerUid && identity === ownerUid) return true;
  if (identity.startsWith("producer:")) return true;
  return extra.some((x) => !!x && x === identity);
}

const ENFORCED_CONTROL_KEYS = [
  "canPublishAudio",
  "canPublishVideo",
  "canScreenShare",
  "forcedMute",
  "forcedVideoOff",
  "muteLocked",
  "tileVisible",
] as const;

function controlsHaveRestrictions(merged: any): boolean {
  return (
    merged?.canPublishAudio === false ||
    merged?.canPublishVideo === false ||
    merged?.canScreenShare === false ||
    merged?.forcedMute === true ||
    merged?.forcedVideoOff === true ||
    merged?.muteLocked === true ||
    merged?.tileVisible === false
  );
}

/**
 * Apply the merged room controls (default + identity override) to a
 * participant's LiveKit permission so host toggles are enforced
 * server-side. The base permission comes from, in order:
 *  1. the identity doc's `role` (set by host role changes / promote / demote)
 *  2. a snapshot of the participant's original LiveKit permission taken the
 *     first time we enforced on them (`lkBasePermission`)
 *  3. `fallbackRole` (e.g. the caller's roomAccessToken role on SSE open)
 *  4. the participant's current LiveKit permission (and we snapshot it)
 *
 * Best-effort: returns a reason string instead of throwing.
 */
export async function enforceRoomControlsForIdentity(opts: {
  roomId: string;
  livekitRoomName: string;
  identity: string;
  roomService?: any;
  lkParticipant?: any;
  fallbackRole?: unknown;
  muteExistingTracks?: boolean;
}): Promise<{ applied: boolean; reason?: string; permission?: LiveKitParticipantPermissionInit }> {
  const { roomId, livekitRoomName, identity } = opts;
  try {
    const roomService = opts.roomService || (await getRoomServiceClient());
    if (!roomService) return { applied: false, reason: "not_configured" };

    const identityDocId = normalizeControlsDocId(identity);
    const [dSnap, iSnap] = await Promise.all([
      controlsDocRef(roomId, "default").get(),
      controlsDocRef(roomId, identityDocId).get(),
    ]);
    const defaultDoc = dSnap.exists ? ((dSnap.data() as any) || {}) : {};
    const identityDoc = iSnap.exists ? ((iSnap.data() as any) || {}) : {};
    const merged = mergeControls(defaultDoc, identityDoc) as any;

    let lkParticipant = opts.lkParticipant;
    if (!lkParticipant) {
      try {
        lkParticipant = await roomService.getParticipant(livekitRoomName, identity);
      } catch (err) {
        if (isLiveKitNotFound(err)) return { applied: false, reason: "not_found" };
        throw err;
      }
    }

    let base: any = null;
    const docRole = normalizeBaseRole(identityDoc.role);
    if (docRole) {
      base = roleToParticipantPermission(docRole);
    } else if (identityDoc.lkBasePermission && typeof identityDoc.lkBasePermission === "object") {
      base = identityDoc.lkBasePermission;
    } else {
      const fallback = normalizeBaseRole(opts.fallbackRole);
      if (fallback) {
        base = roleToParticipantPermission(fallback);
      } else {
        base = toLiveKitParticipantPermission((lkParticipant as any)?.permission || {});
      }
      // Snapshot the pre-restriction permission so later un-restricting
      // restores exactly what the participant had.
      try {
        await controlsDocRef(roomId, identityDocId).set(
          { lkBasePermission: toLiveKitParticipantPermission(base) },
          { merge: true },
        );
      } catch {
        // ignore
      }
    }

    const baseRole = docRole || normalizeBaseRole(opts.fallbackRole);
    const permission = restrictPermissionByControls(base, {
      canPublishAudio: merged.canPublishAudio,
      canPublishVideo: merged.canPublishVideo,
      canScreenShare: merged.canScreenShare,
      forcedMute: merged.forcedMute,
      forcedVideoOff: merged.forcedVideoOff,
      muteLocked: merged.muteLocked === true && baseRole !== "host",
    });

    // Mirror tileVisible into participant metadata so every client can hide
    // this participant's tile (clients only receive their own controls).
    const tileHidden = merged.tileVisible === false;
    let metadataPatch: string | undefined;
    let existingMeta: any = {};
    try {
      existingMeta = JSON.parse(String((lkParticipant as any)?.metadata || "")) || {};
    } catch {
      existingMeta = {};
    }
    if (!!existingMeta.tileHidden !== tileHidden) {
      metadataPatch = mergeParticipantMetadata((lkParticipant as any)?.metadata, { tileHidden });
    }

    await roomService.updateParticipant(
      livekitRoomName,
      identity,
      metadataPatch !== undefined ? { permission, metadata: metadataPatch } : { permission },
    );

    if (opts.muteExistingTracks !== false) {
      const allowed = new Set(permission.canPublish === false ? [] : permission.canPublishSources);
      const allowAll = permission.canPublish !== false && permission.canPublishSources.length === 0;
      const tracks: any[] = Array.isArray((lkParticipant as any)?.tracks) ? (lkParticipant as any).tracks : [];
      for (const t of tracks) {
        const source = typeof t?.source === "number" ? t.source : null;
        const sid = t?.sid || t?.trackSid;
        if (!sid || source == null || allowAll || allowed.has(source) || t?.muted === true) continue;
        try {
          await roomService.mutePublishedTrack(livekitRoomName, identity, sid, true);
        } catch {
          // ignore
        }
      }
    }

    return { applied: true, permission };
  } catch (err) {
    if (isLiveKitNotFound(err)) return { applied: false, reason: "not_found" };
    console.warn("[roomControls] enforce controls failed", { roomId, identity, error: (err as any)?.message || String(err) });
    return { applied: false, reason: "livekit_push_failed" };
  }
}

/** Enforce controls on every (non-protected) participant in the room. */
export async function enforceRoomControlsForRoom(opts: {
  roomId: string;
  livekitRoomName: string;
  skipIdentities?: Array<string | null | undefined>;
}): Promise<{ applied: number; skipped: number }> {
  const roomService = await getRoomServiceClient();
  if (!roomService) return { applied: 0, skipped: 0 };
  let participants: any[] = [];
  try {
    participants = await listLiveKitParticipants(roomService, opts.livekitRoomName);
  } catch {
    return { applied: 0, skipped: 0 };
  }
  const ownerUid = await getRoomOwnerUid(opts.roomId);
  let applied = 0;
  let skipped = 0;
  for (const p of participants) {
    const identity = String(p?.identity || "");
    if (isProtectedIdentity(identity, ownerUid, opts.skipIdentities)) {
      skipped++;
      continue;
    }
    const r = await enforceRoomControlsForIdentity({
      roomId: opts.roomId,
      livekitRoomName: opts.livekitRoomName,
      identity,
      roomService,
      lkParticipant: p,
    });
    if (r.applied) applied++;
    else skipped++;
  }
  return { applied, skipped };
}

function patchTouchesEnforcedKeys(patch: Record<string, unknown>): boolean {
  return ENFORCED_CONTROL_KEYS.some((k) => k in patch);
}

type RoomControls = {
  canPublishAudio?: boolean;
  canPublishVideo?: boolean;
  canScreenShare?: boolean;
  tileVisible?: boolean;
  // Access scopes / capabilities (used for in-room UI gating; set via presets).
  canMuteGuests?: boolean;
  canRemoveGuests?: boolean;
  canInviteLinks?: boolean;
  canManageDestinations?: boolean;
  canStartStopStream?: boolean;
  canStartStopRecording?: boolean;
  // Optional future scopes.
  canViewAnalytics?: boolean;
  canChangeLayoutScene?: boolean;
  forcedMute?: boolean;
  forcedVideoOff?: boolean;
  role?: string;
  // Screen-share routing (persisted + broadcast via SSE).
  screenShareLayout?: string;
  // Output format for platform-aware layout (e.g. Instagram vertical).
  outputFormat?: string;
};

const DEFAULT_CONTROLS: Required<Pick<RoomControls, "canPublishAudio" | "tileVisible">> = {
  canPublishAudio: true,
  tileVisible: true,
};

function controlsDocRef(roomId: string, docId: string) {
  return admin.firestore().collection("rooms").doc(roomId).collection("controls").doc(docId);
}

function normalizeControlsDocId(raw: any): string {
  const id = String(raw || "").trim();
  if (!id) return "default";
  // Firestore doc IDs cannot contain '/' and we keep this intentionally strict.
  if (id.includes("/")) return "default";
  if (id.length > 128) return id.slice(0, 128);
  return id;
}

type RawPresetId = "moderator" | "cohost" | "participant";
type PresetId = "cohost" | "participant";

const SYSTEM_ROLE_PRESETS: Record<
  PresetId,
  Required<
    Pick<
      RoomControls,
      | "role"
      | "canPublishAudio"
      | "canPublishVideo"
      | "canScreenShare"
      | "tileVisible"
      | "canMuteGuests"
      | "canRemoveGuests"
      | "canInviteLinks"
      | "canManageDestinations"
      | "canStartStopStream"
      | "canStartStopRecording"
      | "canViewAnalytics"
      | "canChangeLayoutScene"
    >
  >
> = {
  participant: {
    role: "participant",
    canPublishAudio: true,
    canPublishVideo: true,
    canScreenShare: false,
    tileVisible: true,
    canMuteGuests: false,
    canRemoveGuests: false,
    canInviteLinks: false,
    canManageDestinations: false,
    canStartStopStream: false,
    canStartStopRecording: false,
    canViewAnalytics: false,
    canChangeLayoutScene: false,
  },
  cohost: {
    role: "cohost",
    canPublishAudio: true,
    canPublishVideo: true,
    canScreenShare: true,
    tileVisible: true,
    canMuteGuests: true,
    canRemoveGuests: true,
    canInviteLinks: true,
    canManageDestinations: false,
    canStartStopStream: false,
    canStartStopRecording: false,
    canViewAnalytics: false,
    canChangeLayoutScene: true,
  },
};

function presetDocRef(uid: string, presetId: PresetId) {
  // "Account" is currently modeled as the authenticated user document.
  return admin.firestore().collection("users").doc(uid).collection("rolePresets").doc(presetId);
}

function parsePresetId(raw: any): RawPresetId | null {
  const v = String(raw || "").toLowerCase();
  if (v === "moderator" || v === "cohost" || v === "participant") return v as RawPresetId;
  return null;
}

function coercePresetIdForApply(presetId: RawPresetId): PresetId {
  // Moderator is no longer a public-facing role. For any new apply
  // operations, treat incoming "moderator" as "participant" so legacy
  // data and stale clients cannot re-introduce a distinct moderator role
  // in LiveKit metadata or controls.
  if (presetId === "moderator") return "participant";
  return presetId;
}

async function loadPresetForUser(uid: string, presetId: PresetId): Promise<RoomControls> {
  try {
    const snap = await presetDocRef(uid, presetId).get();
    if (snap.exists) {
      const data = (snap.data() || {}) as any;
      const merged: RoomControls = {
        role: typeof data.role === "string" ? data.role : presetId,
        canPublishAudio: pickBoolean(data.canPublishAudio),
        canPublishVideo: pickBoolean(data.canPublishVideo),
        canScreenShare: pickBoolean(data.canScreenShare),
        tileVisible: pickBoolean(data.tileVisible),
        canMuteGuests: pickBoolean(data.canMuteGuests),
        canRemoveGuests: pickBoolean(data.canRemoveGuests),
        canInviteLinks: pickBoolean(data.canInviteLinks),
        canManageDestinations: pickBoolean(data.canManageDestinations),
        canStartStopStream: pickBoolean(data.canStartStopStream),
        canStartStopRecording: pickBoolean(data.canStartStopRecording),
        canViewAnalytics: pickBoolean(data.canViewAnalytics),
        canChangeLayoutScene: pickBoolean(data.canChangeLayoutScene),
      };

      return merged;
    }
  } catch {
    // ignore and fall back to system preset
  }

  return { ...SYSTEM_ROLE_PRESETS[presetId] };
}

function normalizePresetForApply(presetId: PresetId, preset: RoomControls): RoomControls {
  const system = SYSTEM_ROLE_PRESETS[presetId];

  const coerce = <K extends keyof typeof system>(key: K): boolean => {
    const v = (preset as any)?.[key];
    if (typeof v === "boolean") return v;
    return !!system[key];
  };

  const normalized: RoomControls = {
    role: presetId,
    canPublishAudio: coerce("canPublishAudio"),
    canPublishVideo: coerce("canPublishVideo"),
    canScreenShare: coerce("canScreenShare"),
    tileVisible: coerce("tileVisible"),
    canMuteGuests: coerce("canMuteGuests"),
    canRemoveGuests: coerce("canRemoveGuests"),
    canInviteLinks: coerce("canInviteLinks"),
    canManageDestinations: coerce("canManageDestinations"),
    canStartStopStream: coerce("canStartStopStream"),
    canStartStopRecording: coerce("canStartStopRecording"),
    canViewAnalytics: coerce("canViewAnalytics"),
    canChangeLayoutScene: coerce("canChangeLayoutScene"),
  };

  return normalized;
}

function mergeControls(defaultDoc: any, identityDoc: any) {
  return {
    ...DEFAULT_CONTROLS,
    ...(defaultDoc || {}),
    ...(identityDoc || {}),
  };
}

async function readControlsMerged(roomId: string, identityDocId: string) {
  const defaultRef = controlsDocRef(roomId, "default");
  const identityRef = controlsDocRef(roomId, identityDocId);
  const [dSnap, iSnap] = await Promise.all([defaultRef.get(), identityRef.get()]);
  const d = dSnap.exists ? (dSnap.data() as any) : {};
  const i = iSnap.exists ? (iSnap.data() as any) : {};
  return mergeControls(d, i);
}

function pickBoolean(v: any): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

const VALID_SCREEN_SHARE_LAYOUTS = new Set(["off", "main", "popout"]);

function pickScreenShareLayout(v: any): string | undefined {
  if (typeof v === "string" && VALID_SCREEN_SHARE_LAYOUTS.has(v)) return v;
  return undefined;
}

const VALID_OUTPUT_FORMATS = new Set(["landscape_16x9", "vertical_9x16", "square_1x1"]);

function pickOutputFormat(v: any): string | undefined {
  if (typeof v === "string" && VALID_OUTPUT_FORMATS.has(v)) return v;
  return undefined;
}

function isHostOrCohost(role?: string): boolean {
  const r = String(role || "").toLowerCase();
  // Updated policy: only hosts can modify room controls or presets.
  return r === "host";
}

function mapPresetToLivekitPermission(role: PresetId) {
  // Map our simple room role presets (participant/cohost) to LiveKit
  // ParticipantPermission objects so we can accurately control which
  // track sources (including screen share) are allowed. This is
  // important for demotion flows where we need to detect when
  // screen-share capability is lost and proactively mute any
  // existing screen-share tracks.
  return roleToParticipantPermission(role);
}

// Host/cohost updates controls for the whole room.
// PATCH /api/rooms/:roomId/controls
// Auth: Firebase session cookie + Authorization: Bearer <roomAccessToken>
router.patch("/:roomId/controls", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
  if (access.roomId !== roomId) return res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });

  if (!isHostOrCohost(access.role)) {
    return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
  }

  const uid = (req as any).user?.uid as string | undefined;
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  const body = (req.body || {}) as any;
  const patch: RoomControls = {
    canPublishAudio: pickBoolean(body.canPublishAudio),
    canPublishVideo: pickBoolean(body.canPublishVideo),
    canScreenShare: pickBoolean(body.canScreenShare),
    tileVisible: pickBoolean(body.tileVisible),
    canMuteGuests: pickBoolean(body.canMuteGuests),
    canRemoveGuests: pickBoolean(body.canRemoveGuests),
    canInviteLinks: pickBoolean(body.canInviteLinks),
    canManageDestinations: pickBoolean(body.canManageDestinations),
    canStartStopStream: pickBoolean(body.canStartStopStream),
    canStartStopRecording: pickBoolean(body.canStartStopRecording),
    forcedMute: pickBoolean(body.forcedMute),
    forcedVideoOff: pickBoolean(body.forcedVideoOff),
    screenShareLayout: pickScreenShareLayout(body.screenShareLayout),
    outputFormat: pickOutputFormat(body.outputFormat),
  };

  // Only accept known keys.
  const cleaned: RoomControls = {};
  const STRING_CONTROL_KEYS = new Set<keyof RoomControls>(["screenShareLayout", "outputFormat"]);
  (Object.keys(patch) as Array<keyof RoomControls>).forEach((k) => {
    const val = patch[k];
    if (typeof val === "boolean") (cleaned as any)[k] = val;
    else if (typeof val === "string" && STRING_CONTROL_KEYS.has(k)) (cleaned as any)[k] = val;
  });

  if (Object.keys(cleaned).length === 0) {
    return res.status(400).json({ error: "no_valid_fields" });
  }

  const ref = controlsDocRef(roomId, "default");
  await ref.set(
    {
      ...cleaned,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: uid,
    },
    { merge: true },
  );

  // Enforce publish restrictions in LiveKit too, so a modified client
  // cannot ignore host toggles. Best-effort; the SSE stream still
  // delivers the change to well-behaved clients.
  let enforcement: { applied: number; skipped: number } | null = null;
  if (patchTouchesEnforcedKeys(cleaned as any)) {
    try {
      const { livekitRoomName } = getRoomAccess(req as any);
      enforcement = await enforceRoomControlsForRoom({ roomId, livekitRoomName, skipIdentities: [access.identity] });
    } catch (err) {
      console.warn("[roomControls] room-wide enforcement failed", (err as any)?.message || err);
    }
  }

  const identityDocId = normalizeControlsDocId((req.query as any)?.identity);
  const merged = await readControlsMerged(roomId, identityDocId);
  return res.json({ ok: true, controls: merged, enforcement });
});

// Host/cohost updates controls for a specific participant identity (override doc).
// PATCH /api/rooms/:roomId/controls/:identity
// Auth: Firebase session cookie + Authorization: Bearer <roomAccessToken>
router.patch("/:roomId/controls/:identity", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
  if (access.roomId !== roomId) return res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });

  if (!isHostOrCohost(access.role)) {
    return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
  }

  const uid = (req as any).user?.uid as string | undefined;
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  const rawIdentity = String(req.params.identity || "").trim();
  if (!rawIdentity) return res.status(400).json({ error: "identity_required" });

  const identityDocId = normalizeControlsDocId(rawIdentity);
  const body = (req.body || {}) as any;

  // If a role is provided, treat this as a role change and
  // apply the corresponding preset defaults, resetting overrides.
  const parsedRolePresetId = parsePresetId(body.role);
  if (parsedRolePresetId) {
    const rolePresetId: PresetId = coercePresetIdForApply(parsedRolePresetId);
    const loadedPreset = await loadPresetForUser(uid, rolePresetId);
    const presetPatch = normalizePresetForApply(rolePresetId, loadedPreset);

    // Strip out any undefined booleans so Firestore never sees undefined fields.
    const cleanedFromPreset: RoomControls = {};
    (Object.keys(presetPatch) as Array<keyof RoomControls>).forEach((k) => {
      const val = presetPatch[k];
      if (k === "role") {
        (cleanedFromPreset as any)[k] = val;
      } else if (typeof val === "boolean") {
        (cleanedFromPreset as any)[k] = val;
      }
    });

    const ref = controlsDocRef(roomId, identityDocId);
    await ref.set(
      {
        ...cleanedFromPreset,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedByUid: uid,
        appliedPresetId: rolePresetId,
        lkBasePermission: admin.firestore.FieldValue.delete(),
        // Hint for the participant's controls SSE stream: re-fetch the
        // room token so roomAccessToken permissions match the new role.
        tokenRefreshRequestedAt: Date.now(),
      },
      { merge: true },
    );

    // Update LiveKit participant permissions to reflect the new role.
    try {
      const roomService = await getRoomServiceClient();

      if (roomService) {
        const mergedControls = (await readControlsMerged(roomId, identityDocId)) as any;
        const permission = restrictPermissionByControls(mapPresetToLivekitPermission(rolePresetId), mergedControls);
        const { livekitRoomName } = getRoomAccess(req as any);

        console.log("[roomControls] ROLE UPDATE", {
          roomId,
          livekitRoomName,
          targetIdentity: rawIdentity,
          newRoleId: rolePresetId,
        });

        // Merge rolePresetId into existing metadata so clients can
        // render a stable role label and dropdown value.
        let nextMetadata: string | undefined;
        try {
          const participants = await listLiveKitParticipants(roomService, livekitRoomName);
          const target = participants.find((p: any) => p && p.identity === rawIdentity);
          nextMetadata = mergeParticipantMetadata(target?.metadata, { rolePresetId });
        } catch {
          nextMetadata = JSON.stringify({ rolePresetId: rolePresetId });
        }

        await roomService.updateParticipant(livekitRoomName, rawIdentity, {
          permission,
          metadata: nextMetadata,
        });
      } else {
        console.warn("[roomControls] LiveKit RoomServiceClient not configured; skipping permission update");
      }
    } catch (err) {
      const message = (err as any)?.message || String(err);
      // If the room/participant no longer exists in LiveKit (404), treat as non-fatal.
      if (message.includes("status 404")) {
        console.warn("[roomControls] LiveKit role update 404 (room or participant missing)", {
          roomId,
          identity: rawIdentity,
          rolePresetId,
        });
      } else {
        console.error("[roomControls] livekit role update failed", err);
        return res.status(500).json({ error: "livekit_role_update_failed" });
      }
    }

    const merged = await readControlsMerged(roomId, identityDocId);
    return res.json({ ok: true, controls: merged });
  }

  // Otherwise, behave as a classic partial controls patch.
  const patch: RoomControls = {
    canPublishAudio: pickBoolean(body.canPublishAudio),
    canPublishVideo: pickBoolean(body.canPublishVideo),
    canScreenShare: pickBoolean(body.canScreenShare),
    tileVisible: pickBoolean(body.tileVisible),
    canMuteGuests: pickBoolean(body.canMuteGuests),
    canRemoveGuests: pickBoolean(body.canRemoveGuests),
    canInviteLinks: pickBoolean(body.canInviteLinks),
    canManageDestinations: pickBoolean(body.canManageDestinations),
    canStartStopStream: pickBoolean(body.canStartStopStream),
    canStartStopRecording: pickBoolean(body.canStartStopRecording),
    forcedMute: pickBoolean(body.forcedMute),
    forcedVideoOff: pickBoolean(body.forcedVideoOff),
    screenShareLayout: pickScreenShareLayout(body.screenShareLayout),
    outputFormat: pickOutputFormat(body.outputFormat),
  };

  const cleaned: RoomControls = {};
  const STRING_CTRL_KEYS = new Set<keyof RoomControls>(["screenShareLayout", "outputFormat"]);
  (Object.keys(patch) as Array<keyof RoomControls>).forEach((k) => {
    const val = patch[k];
    if (typeof val === "boolean") (cleaned as any)[k] = val;
    else if (typeof val === "string" && STRING_CTRL_KEYS.has(k)) (cleaned as any)[k] = val;
  });

  if (Object.keys(cleaned).length === 0) {
    return res.status(400).json({ error: "no_valid_fields" });
  }

  const ref = controlsDocRef(roomId, identityDocId);
  await ref.set(
    {
      ...cleaned,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: uid,
    },
    { merge: true },
  );

  // Enforce mic/camera/screen restrictions in LiveKit (not just via SSE),
  // so a modified client cannot ignore forcedMute / canPublishAudio etc.
  let enforcement: { applied: boolean; reason?: string } | null = null;
  if (patchTouchesEnforcedKeys(cleaned as any)) {
    try {
      const { livekitRoomName } = getRoomAccess(req as any);
      const ownerUid = await getRoomOwnerUid(roomId);
      if (isProtectedIdentity(rawIdentity, ownerUid, [access.identity])) {
        enforcement = { applied: false, reason: "protected_identity" };
      } else {
        const r = await enforceRoomControlsForIdentity({ roomId, livekitRoomName, identity: rawIdentity });
        enforcement = { applied: r.applied, reason: r.reason };
      }
    } catch (err) {
      enforcement = { applied: false, reason: "livekit_push_failed" };
    }
  }

  const merged = await readControlsMerged(roomId, identityDocId);
  return res.json({ ok: true, controls: merged, enforcement });
});

// Apply a role's permissions to a LiveKit participant immediately.
// POST /api/rooms/:roomId/participants/:identity/permissions
// Body: { roleId: "moderator" | "cohost" | "participant" }
// Auth: Firebase session cookie + Authorization: Bearer <roomAccessToken>
router.post("/:roomId/participants/:identity/permissions", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
  if (access.roomId !== roomId) return res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });

  // Host-only moderation: only a host can change participant roles/permissions.
  if (String(access.role || "").toLowerCase() !== "host") {
    return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
  }

  const uid = (req as any).user?.uid as string | undefined;
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  const rawIdentity = String(req.params.identity || "").trim();
  if (!rawIdentity) return res.status(400).json({ error: "identity_required" });

  const body = (req.body || {}) as any;
  const parsedPresetId = parsePresetId(body.roleId || body.role || body.presetId);
  if (!parsedPresetId) {
    return res.status(400).json({ error: "roleId_invalid" });
  }

  const presetId: PresetId = coercePresetIdForApply(parsedPresetId);

  const identityDocId = normalizeControlsDocId(rawIdentity);

  try {
    const loadedPreset = await loadPresetForUser(uid, presetId);
    const presetPatch = normalizePresetForApply(presetId, loadedPreset);

    const cleanedFromPreset: RoomControls = {};
    (Object.keys(presetPatch) as Array<keyof RoomControls>).forEach((k) => {
      const val = presetPatch[k];
      if (k === "role") {
        (cleanedFromPreset as any)[k] = val;
      } else if (typeof val === "boolean") {
        (cleanedFromPreset as any)[k] = val;
      }
    });

    const ref = controlsDocRef(roomId, identityDocId);
    await ref.set(
      {
        ...cleanedFromPreset,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedByUid: uid,
        appliedPresetId: presetId,
        lkBasePermission: admin.firestore.FieldValue.delete(),
        // Hint for the participant's controls SSE stream to re-fetch its token.
        tokenRefreshRequestedAt: Date.now(),
      },
      { merge: true },
    );

    // Push to LiveKit in real time so the participant's in-room
    // capabilities update immediately.
    let appliedPermission: any | null = null;
    let livekitApplied = false;
    let livekitReason: string | null = null;
    try {
      const roomService = await getRoomServiceClient();

      if (roomService) {
        const mergedControls = (await readControlsMerged(roomId, identityDocId)) as any;
        const permission = restrictPermissionByControls(mapPresetToLivekitPermission(presetId), mergedControls);
        const { livekitRoomName } = getRoomAccess(req as any);

        console.log("[roomControls] APPLY PERMISSIONS", {
          roomId,
          livekitRoomName,
          targetIdentity: rawIdentity,
          roleId: presetId,
        });

        // Merge rolePresetId into existing metadata so host UIs can
        // render a stable role label and dropdown value.
        let nextMetadata: string | undefined;
        try {
          const participants = await listLiveKitParticipants(roomService, livekitRoomName);
          const target = participants.find((p) => p && p.identity === rawIdentity);
          nextMetadata = mergeParticipantMetadata(target?.metadata, { rolePresetId: presetId });
        } catch {
          nextMetadata = JSON.stringify({ rolePresetId: presetId });
        }

        await roomService.updateParticipant(livekitRoomName, rawIdentity, {
          permission,
          metadata: nextMetadata,
        });
        appliedPermission = permission;
        livekitApplied = true;
        livekitReason = null;

        const sources: number[] = permission.canPublishSources;
        const hasScreenShare = sources.includes(LIVEKIT_TRACK_SOURCE_ENUM.screen_share);
        const lostScreenShare = (sources.length > 0 || permission.canPublish === false) && !hasScreenShare;

        if (lostScreenShare) {
          try {
            const participants = await listLiveKitParticipants(roomService, livekitRoomName);

            const target = participants.find((p) => p && p.identity === rawIdentity);
            if (!target) {
              console.warn("[roomControls] demote-cleanup: participant not found in listParticipants", {
                roomId,
                livekitRoomName,
                identity: rawIdentity,
              });
            } else {
              const tracks: any[] = Array.isArray((target as any).tracks) ? (target as any).tracks : [];
              for (const track of tracks) {
                try {
                  if (!track) continue;
                  const source = (track as any).source;
                  const sid = (track as any).sid || (track as any).trackSid;
                  if (source === TrackSource.SCREEN_SHARE && sid) {
                    console.log("[roomControls] demote-cleanup: muting screen_share track", {
                      roomId,
                      livekitRoomName,
                      identity: rawIdentity,
                      trackSid: sid,
                    });
                    await (roomService as any).mutePublishedTrack(livekitRoomName, rawIdentity, sid, true);
                  }
                } catch (muteErr) {
                  console.warn("[roomControls] demote-cleanup: mutePublishedTrack failed", {
                    roomId,
                    livekitRoomName,
                    identity: rawIdentity,
                    error: muteErr,
                  });
                }
              }
            }
          } catch (cleanupErr) {
            console.warn("[roomControls] demote-cleanup: listParticipants failed", {
              roomId,
              identity: rawIdentity,
              error: cleanupErr,
            });
          }
        }
      } else {
        console.warn("[roomControls] LiveKit RoomServiceClient not configured; skipping permission update");
        livekitApplied = false;
        livekitReason = "not_configured";
      }
    } catch (err) {
      const message = (err as any)?.message || String(err);
      if (message.includes("status 404")) {
        console.warn("[roomControls] LiveKit apply-permissions 404 (room or participant missing)", {
          roomId,
          identity: rawIdentity,
          roleId: presetId,
        });
        livekitApplied = false;
        livekitReason = "not_found";
      } else {
        // Firestore controls were already persisted — the participant will
        // receive the update via the SSE controls stream regardless.  Don't
        // return 500 for a LiveKit-only failure; instead surface a warning
        // in the response so the host UI can still show "Role updated."
        console.error("[roomControls] livekit apply-permissions failed (Firestore persisted, SSE will deliver)", err);
        livekitApplied = false;
        livekitReason = "livekit_push_failed";
      }
    }

    const merged = await readControlsMerged(roomId, identityDocId);
    return res.json({
      ok: true,
      appliedPermission,
      applied: appliedPermission,
      livekitApplied,
      livekitReason,
      controls: merged,
      roleId: presetId,
    });
  } catch (err: any) {
    console.error("[roomControls] apply-permissions error", err);
    return res.status(500).json({ error: "failed_to_apply_permissions" });
  }
});

// Apply a saved preset to a participant identity.
// POST /api/rooms/:roomId/controls/:identity/apply-preset
// Auth: Firebase session cookie + Authorization: Bearer <roomAccessToken>
router.post("/:roomId/controls/:identity/apply-preset", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
  if (access.roomId !== roomId) return res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });

  if (!isHostOrCohost(access.role)) {
    return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
  }

  const uid = (req as any).user?.uid as string | undefined;
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  const parsedPresetId = parsePresetId((req.body as any)?.presetId);
  if (!parsedPresetId) return res.status(400).json({ error: "presetId_required" });

  const presetId: PresetId = coercePresetIdForApply(parsedPresetId);

  const identityDocId = normalizeControlsDocId(req.params.identity);
  const loadedPreset = await loadPresetForUser(uid, presetId);
  const cleaned = normalizePresetForApply(presetId, loadedPreset);

  const ref = controlsDocRef(roomId, identityDocId);
  await ref.set(
    {
      ...cleaned,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: uid,
      appliedPresetId: presetId,
    },
    { merge: true },
  );

  const merged = await readControlsMerged(roomId, identityDocId);
  return res.json({ ok: true, controls: merged });
});

// SSE stream of current controls.
// GET /api/rooms/:roomId/controls/stream
// Auth: Authorization: Bearer <roomAccessToken>
router.get("/:roomId/controls/stream", requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
  if (access.roomId !== roomId) return res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  if (typeof (res as any).flushHeaders === "function") {
    (res as any).flushHeaders();
  }

  const write = (payload: any) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // ignore
    }
  };

  // Identity binding: only hosts/cohosts may watch another participant's
  // controls. Everyone else is pinned to their own roomAccessToken identity.
  const callerRole = String(access.role || "").toLowerCase();
  const canWatchOthers = callerRole === "host" || callerRole === "cohost";
  const requestedIdentity = String((req.query as any)?.identity || "").trim();
  const boundIdentity = canWatchOthers ? requestedIdentity || String(access.identity || "") : String(access.identity || "");
  const identityDocId = normalizeControlsDocId(boundIdentity);
  const isOwnStream = !!access.identity && identityDocId === normalizeControlsDocId(access.identity);
  const defaultRef = controlsDocRef(roomId, "default");
  const identityRef = controlsDocRef(roomId, identityDocId);

  let lastDefault: any = {};
  let lastIdentity: any = {};
  let lastRefreshNonce: unknown = undefined;
  const emit = () => write(mergeControls(lastDefault, lastIdentity));

  // A `refresh_token` hint is emitted when the host changes this
  // participant's role (the role endpoints bump `tokenRefreshRequestedAt`).
  let initialNonceKnown = false;

  // Send an initial payload.
  try {
    const [dSnap, iSnap] = await Promise.all([defaultRef.get(), identityRef.get()]);
    lastDefault = dSnap.exists ? (dSnap.data() as any) : {};
    lastIdentity = iSnap.exists ? (iSnap.data() as any) : {};
    lastRefreshNonce = lastIdentity?.tokenRefreshRequestedAt;
    initialNonceKnown = true;
    emit();
  } catch {
    write({ ...DEFAULT_CONTROLS });
  }

  const unsubDefault = defaultRef.onSnapshot(
    (snap) => {
      lastDefault = snap.exists ? (snap.data() as any) : {};
      emit();
    },
    () => {
      lastDefault = {};
      emit();
    },
  );

  const unsubIdentity = identityRef.onSnapshot(
    (snap) => {
      lastIdentity = snap.exists ? (snap.data() as any) : {};
      emit();
      const nonce = lastIdentity?.tokenRefreshRequestedAt;
      if (nonce !== undefined && nonce !== lastRefreshNonce) {
        lastRefreshNonce = nonce;
        if (initialNonceKnown && isOwnStream) {
          write({ type: "refresh_token", identity: access.identity, at: nonce });
        }
      }
      initialNonceKnown = true;
    },
    () => {
      lastIdentity = {};
      emit();
    },
  );

  // Server-side enforcement on (re)join: a participant's fresh LiveKit token
  // is minted from their invite/role, not from room controls, so re-apply any
  // standing restrictions (mute lock, forced mute, role changes) once they are
  // connected. LiveKit may not know the participant yet when SSE opens, so
  // retry a few times.
  const enforceTimers: Array<ReturnType<typeof setTimeout>> = [];
  if (isOwnStream && callerRole !== "host") {
    const livekitRoomName = String(access.livekitRoomName || "").trim();
    const shouldEnforce = () =>
      controlsHaveRestrictions(mergeControls(lastDefault, lastIdentity)) || !!normalizeBaseRole(lastIdentity?.role);
    if (livekitRoomName) {
      let done = false;
      for (const delay of [3_000, 10_000, 25_000]) {
        enforceTimers.push(
          setTimeout(async () => {
            if (done || !shouldEnforce()) return;
            const ownerUid = await getRoomOwnerUid(roomId);
            if (isProtectedIdentity(access.identity, ownerUid)) {
              done = true;
              return;
            }
            const r = await enforceRoomControlsForIdentity({
              roomId,
              livekitRoomName,
              identity: access.identity,
              fallbackRole: access.role,
            });
            if (r.applied) done = true;
          }, delay),
        );
      }
    }
  }

  const heartbeat = setInterval(() => {
    res.write(`: keep-alive ${Date.now()}\n\n`);
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    enforceTimers.forEach((t) => clearTimeout(t));
    try {
      unsubDefault();
      unsubIdentity();
    } catch {
      // ignore
    }
  });
});

/**
 * Shared implementation for "Bring on stage" (promote) and
 * "Move to audience" (demote).
 *
 * - promote: viewer/guest -> speaker ("participant": mic + cam)
 * - demote:  speaker -> audience ("viewer": subscribe-only)
 *
 * Updates the LiveKit ParticipantPermission in real time (with enum-encoded
 * track sources), merges metadata, persists the role in the identity
 * controls doc (so it survives a rejoin and is re-enforced on SSE open) and
 * asks the participant's controls stream to refresh its token.
 *
 * Auth: host role + valid roomAccessToken (+ account session).
 */
function stageChangeHandler(direction: "promote" | "demote") {
  return async (req: any, res: any) => {
    const roomId = String(req.params.roomId || "").trim();
    const targetIdentity = String(req.params.identity || "").trim();

    if (!roomId) return res.status(400).json({ error: "roomId_required" });
    if (!targetIdentity) return res.status(400).json({ error: "identity_required" });

    const access = (req as any).roomAccess as RoomAccessClaims | undefined;
    if (!access || !access.roomId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }
    if (access.roomId !== roomId) {
      return res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
    }

    // Only hosts can move people on/off stage.
    if (!isHostOrCohost(access.role)) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const uid = (req as any).user?.uid as string | undefined;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    if (direction === "demote") {
      const ownerUid = await getRoomOwnerUid(roomId);
      if (isProtectedIdentity(targetIdentity, ownerUid, [access.identity])) {
        return res.status(400).json({ error: "cannot_demote_host" });
      }
    }

    const newRole: BaseRole = direction === "promote" ? "participant" : "viewer";
    const identityDocId = normalizeControlsDocId(targetIdentity);

    try {
      const roomService = await getRoomServiceClient();
      if (!roomService) {
        return res.status(500).json({ error: "livekit_not_configured" });
      }

      const { livekitRoomName } = getRoomAccess(req as any);

      // Persist first so the SSE stream/rejoin enforcement sees the new role.
      const ref = controlsDocRef(roomId, identityDocId);
      await ref.set(
        direction === "promote"
          ? {
              role: "participant",
              canPublishAudio: true,
              canPublishVideo: true,
              canScreenShare: false, // Participants can't screen share by default
              forcedMute: false,
              forcedVideoOff: false,
              promotedToSpeaker: true,
              promotedAt: admin.firestore.FieldValue.serverTimestamp(),
              promotedBy: uid,
              lkBasePermission: admin.firestore.FieldValue.delete(),
              tokenRefreshRequestedAt: Date.now(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedByUid: uid,
            }
          : {
              role: "viewer",
              promotedToSpeaker: false,
              demotedAt: admin.firestore.FieldValue.serverTimestamp(),
              demotedBy: uid,
              lkBasePermission: admin.firestore.FieldValue.delete(),
              tokenRefreshRequestedAt: Date.now(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedByUid: uid,
            },
        { merge: true },
      );

      const mergedControls = (await readControlsMerged(roomId, identityDocId)) as any;
      const permission = restrictPermissionByControls(roleToParticipantPermission(newRole), mergedControls);

      console.log(`[${direction}] stage change`, {
        roomId,
        livekitRoomName,
        targetIdentity,
        byUid: uid,
        newRole,
        permission,
      });

      let target: any = null;
      let nextMetadata: string;
      const metaPatch =
        direction === "promote"
          ? { rolePresetId: "participant", promotedToSpeaker: true, promotedAt: Date.now(), promotedBy: uid }
          : { rolePresetId: "viewer", promotedToSpeaker: false, demotedAt: Date.now(), demotedBy: uid };
      try {
        const participants = await listLiveKitParticipants(roomService, livekitRoomName);
        target = participants.find((p: any) => p && p.identity === targetIdentity) || null;
        nextMetadata = mergeParticipantMetadata(target?.metadata, metaPatch);
      } catch {
        nextMetadata = JSON.stringify(metaPatch);
      }

      await roomService.updateParticipant(livekitRoomName, targetIdentity, {
        permission,
        metadata: nextMetadata,
      });

      // Demotion: make sure nothing they were publishing stays live.
      if (direction === "demote" && target) {
        const tracks: any[] = Array.isArray(target.tracks) ? target.tracks : [];
        for (const t of tracks) {
          const sid = t?.sid || t?.trackSid;
          if (!sid || t?.muted === true) continue;
          try {
            await roomService.mutePublishedTrack(livekitRoomName, targetIdentity, sid, true);
          } catch {
            // ignore
          }
        }
      }

      return res.json({
        ok: true,
        identity: targetIdentity,
        role: newRole,
        permissions:
          direction === "promote"
            ? { canPublish: true, canPublishData: true, canPublishSources: ["microphone", "camera"] }
            : { canPublish: false, canPublishData: !!permission.canPublishData, canPublishSources: [] },
        appliedPermission: permission,
      });
    } catch (err) {
      const message = (err as any)?.message || String(err);
      console.error(`[${direction}] Failed to change stage`, {
        roomId,
        targetIdentity,
        error: message,
      });

      if (isLiveKitNotFound(err)) {
        return res.status(404).json({ error: "participant_not_found" });
      }

      return res.status(500).json({ error: direction === "promote" ? "promotion_failed" : "demotion_failed", message });
    }
  };
}

// POST /api/rooms/:roomId/participants/:identity/promote  ("Bring on stage")
router.post(
  "/:roomId/participants/:identity/promote",
  requireAuth as any,
  requireRoomAccessToken as any,
  stageChangeHandler("promote"),
);

// POST /api/rooms/:roomId/participants/:identity/demote  ("Move to audience")
router.post(
  "/:roomId/participants/:identity/demote",
  requireAuth as any,
  requireRoomAccessToken as any,
  stageChangeHandler("demote"),
);

export default router;
