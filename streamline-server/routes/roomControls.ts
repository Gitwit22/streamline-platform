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
  permissionForRoleWithControls,
  toLiveKitParticipantPermission,
  LIVEKIT_TRACK_SOURCE_ENUM,
  type LiveKitParticipantPermissionInit,
} from "../lib/livekitPermissions";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { tryGetAuthUserAny } from "../middleware/requireAuth";
import {
  actorMay,
  canAssignRolePreset,
  isAnonymousIdentity,
  isFullHostActor,
  isProtectedRoomIdentity,
  isStaffActor,
  missingPermForControlsPatch,
} from "../lib/roomModerationPolicy";
import { normalizeRolePresetId, type RolePresetId } from "../lib/permissions/roleDefaults";
import {
  getRoomOwnerUid as getRoomOwnerUidShared,
  loadOwnerRolePreset,
  presetControlsPatch,
} from "../lib/permissions/rolePresetStore";
import { getInviteAcceptance } from "../lib/inviteAcceptance";

const router = Router();

// ---------------------------------------------------------------------------
// LiveKit helpers
// ---------------------------------------------------------------------------

type BaseRole = "viewer" | "guest" | "participant" | "cohost" | "host";

/** Defensive role normalizer: unknown roles return null (never throw). */
function normalizeBaseRole(raw: unknown): BaseRole | null {
  const r = String(raw || "").trim().toLowerCase();
  if (r === "viewer" || r === "guest" || r === "participant" || r === "cohost" || r === "host") return r;
  // Legacy "moderator" is treated as cohost everywhere (see roleDefaults).
  if (r === "speaker") return "participant";
  if (r === "moderator" || r === "co-host" || r === "co_host") return "cohost";
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
  return getRoomOwnerUidShared(roomId);
}

/** Identities that room controls must never restrict (the host/producers). */
const isProtectedIdentity = isProtectedRoomIdentity;

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
      // The identity's applied preset decides participant screen share.
      base = roleToParticipantPermission(docRole, { screenShare: identityDoc.canScreenShare === true });
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
    // Mute lock never applies to hosts or cohosts (protected like the owner
    // and producers). A cohost without a role on their controls doc is
    // recognised by their cohost acceptance.
    const muteLockExempt =
      baseRole === "host" ||
      baseRole === "cohost" ||
      (merged.muteLocked === true && !baseRole && (await getInviteAcceptance(roomId, identity))?.role === "cohost");
    const permission = restrictPermissionByControls(base, {
      canPublishAudio: merged.canPublishAudio,
      canPublishVideo: merged.canPublishVideo,
      canScreenShare: merged.canScreenShare,
      forcedMute: merged.forcedMute,
      forcedVideoOff: merged.forcedVideoOff,
      muteLocked: merged.muteLocked === true && !muteLockExempt,
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

/**
 * LiveKit identities that are cohosts in this room: a cohost invite
 * acceptance, or a host-applied cohost role on their controls doc.
 * Best-effort (empty on errors).
 */
export async function listRoomCohostIdentities(roomId: string): Promise<string[]> {
  const out = new Set<string>();
  try {
    const [acceptances, controls] = await Promise.all([
      admin.firestore().collection("roomInviteAcceptances").where("roomId", "==", roomId).where("role", "==", "cohost").get(),
      admin.firestore().collection("rooms").doc(roomId).collection("controls").where("role", "==", "cohost").get(),
    ]);
    for (const d of acceptances.docs) {
      const data = (d.data() as any) || {};
      if (!data.revokedAt && typeof data.uid === "string" && data.uid) out.add(data.uid);
    }
    for (const d of controls.docs) {
      if (d.id && d.id !== "default") out.add(d.id);
    }
  } catch (err) {
    console.warn("[roomControls] cohost lookup failed", (err as any)?.message || err);
  }
  return Array.from(out);
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

type PresetId = RolePresetId;

/** Role preset id from a request body; legacy "moderator" maps to cohost. */
function parsePresetId(raw: any): PresetId | null {
  return normalizeRolePresetId(raw);
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

/** Host, producer or cohost token (per-key checks still apply). */
function isHostOrCohost(access: RoomAccessClaims): boolean {
  return isStaffActor(access);
}

/** Owner/admin host token (delegated producers are limited by their permissions). */
function isHostRole(access: RoomAccessClaims): boolean {
  return isFullHostActor(access);
}

/**
 * Whose saved role presets apply: always the room OWNER (also for delegated
 * producers, admins and cohosts), so a role means the same thing no matter
 * who applies it.
 */
async function presetOwnerUidFor(roomId: string, uid: string | undefined): Promise<string | null> {
  return (await getRoomOwnerUid(roomId)) || uid || null;
}

/**
 * Apply a role preset (the room owner's participant/cohost template) to a
 * participant identity: persists rooms/{roomId}/controls/{identity}, pushes
 * the matching LiveKit permission and asks the participant's controls SSE
 * stream to refresh their token. Shared by POST /permissions, POST
 * apply-preset and PATCH controls/:identity with { role }.
 *
 * Callers have already checked the actor (canModerate, canAssignRolePreset,
 * protected identities).
 */
async function applyRolePresetToIdentity(
  req: any,
  res: any,
  params: { roomId: string; rawIdentity: string; presetId: PresetId; uid: string },
) {
  const { roomId, rawIdentity, presetId, uid } = params;
  const identityDocId = normalizeControlsDocId(rawIdentity);

  try {
    const preset = await loadOwnerRolePreset(await presetOwnerUidFor(roomId, uid), presetId);
    await controlsDocRef(roomId, identityDocId).set(presetControlsPatch(preset, uid), { merge: true });

    // Push to LiveKit in real time so the participant's in-room
    // capabilities update immediately.
    let appliedPermission: any | null = null;
    let livekitApplied = false;
    let livekitReason: string | null = null;
    try {
      const roomService = await getRoomServiceClient();

      if (roomService) {
        const mergedControls = (await readControlsMerged(roomId, identityDocId)) as any;
        const permission = permissionForRoleWithControls(
          presetId,
          {
            ...mergedControls,
            // Mute lock never applies to cohosts.
            muteLocked: presetId === "cohost" ? false : mergedControls.muteLocked,
          },
          preset.canScreenShare,
        );
        const { livekitRoomName } = getRoomAccess(req as any);

        console.log("[roomControls] APPLY ROLE PRESET", {
          roomId,
          livekitRoomName,
          targetIdentity: rawIdentity,
          roleId: presetId,
        });

        // Merge rolePresetId into existing metadata so host UIs can
        // render a stable role label and dropdown value.
        let nextMetadata: string | undefined;
        let target: any = null;
        try {
          const participants = await listLiveKitParticipants(roomService, livekitRoomName);
          target = participants.find((p) => p && p.identity === rawIdentity) || null;
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

        // Demotion cleanup: mute anything the new permission no longer allows
        // (e.g. a screen share after losing the Share Screen scope).
        if (target) {
          const allowed = new Set(permission.canPublish === false ? [] : permission.canPublishSources);
          const allowAll = permission.canPublish !== false && permission.canPublishSources.length === 0;
          const tracks: any[] = Array.isArray(target.tracks) ? target.tracks : [];
          for (const t of tracks) {
            const source = typeof t?.source === "number" ? t.source : null;
            const sid = t?.sid || t?.trackSid;
            if (!sid || source == null || allowAll || allowed.has(source) || t?.muted === true) continue;
            if (source !== LIVEKIT_TRACK_SOURCE_ENUM.screen_share && source !== LIVEKIT_TRACK_SOURCE_ENUM.screen_share_audio && source !== TrackSource.SCREEN_SHARE) {
              continue;
            }
            try {
              await roomService.mutePublishedTrack(livekitRoomName, rawIdentity, sid, true);
            } catch (muteErr) {
              console.warn("[roomControls] role preset cleanup: mutePublishedTrack failed", {
                roomId,
                identity: rawIdentity,
                error: (muteErr as any)?.message || String(muteErr),
              });
            }
          }
        }
      } else {
        console.warn("[roomControls] LiveKit RoomServiceClient not configured; skipping permission update");
        livekitReason = "not_configured";
      }
    } catch (err) {
      if (isLiveKitNotFound(err)) {
        livekitReason = "not_found";
      } else {
        // Firestore controls were already persisted — the participant will
        // receive the update via the SSE controls stream (and refresh their
        // token) regardless. Surface a warning instead of failing.
        console.error("[roomControls] livekit apply role preset failed (Firestore persisted, SSE will deliver)", err);
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
      tokenRefreshRequested: true,
    });
  } catch (err: any) {
    console.error("[roomControls] apply role preset error", err);
    return res.status(500).json({ error: "failed_to_apply_permissions" });
  }
}

/**
 * Shared actor checks for assigning `presetId` to `rawIdentity`. Returns an
 * error response tuple or null when allowed.
 */
async function checkRolePresetAssignment(
  access: RoomAccessClaims,
  roomId: string,
  rawIdentity: string,
  presetId: PresetId,
): Promise<{ status: number; error: string } | null> {
  // Hosts, producers/cohosts with canModerate. Cohosts may only assign
  // participant and never act on the owner/producers.
  if (!actorMay(access, access.permissions, "canModerate") || !canAssignRolePreset(access, presetId)) {
    return { status: 403, error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS };
  }
  if (!isHostRole(access) && isProtectedIdentity(rawIdentity, await getRoomOwnerUid(roomId))) {
    return { status: 403, error: "cannot_moderate_host" };
  }
  // Cohost needs a StreamLine account: anonymous guests can't be promoted.
  if (presetId === "cohost" && !(await identityHasAccount(rawIdentity))) {
    return { status: 403, error: "cohost_requires_account" };
  }
  return null;
}

/** True when the LiveKit identity is a signed-in account (Firebase uid). */
async function identityHasAccount(identity: string): Promise<boolean> {
  if (isAnonymousIdentity(identity)) return false;
  try {
    await admin.auth().getUser(identity);
    return true;
  } catch (err: any) {
    const code = String(err?.code || err?.errorInfo?.code || "");
    if (code.includes("user-not-found") || code.includes("invalid-uid")) return false;
    // Auth backend unavailable: fall back to the identity shape check above.
    return true;
  }
}

// Host/cohost updates controls for the whole room.
// PATCH /api/rooms/:roomId/controls
// Auth: host/cohost roomAccessToken (x-room-access-token). User auth
// (Authorization or session cookie) is optional: the roomAccessToken alone
// proves the host/cohost role, so cookie-only host sessions work too.
// Cohosts may only change keys their permissions cover (layout keys need
// canLayout, mute keys canMuteGuests, other restrictions canModerate;
// capability scopes are host-only).
router.patch("/:roomId/controls", requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
  if (access.roomId !== roomId) return res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });

  if (!isHostOrCohost(access)) {
    return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
  }

  const authedUser = (req as any).user || (await tryGetAuthUserAny(req).catch(() => null));
  const uid = (authedUser?.uid as string | undefined) || undefined;
  const updatedBy = uid || `identity:${String(access.identity || "").slice(0, 128)}`;

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

  const missingRoomPerm = missingPermForControlsPatch(access, access.permissions, Object.keys(cleaned));
  if (missingRoomPerm) {
    return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS, required: missingRoomPerm });
  }

  const ref = controlsDocRef(roomId, "default");
  await ref.set(
    {
      ...cleaned,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: updatedBy,
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

  if (!isHostOrCohost(access)) {
    return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
  }

  const uid = (req as any).user?.uid as string | undefined;
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  const rawIdentity = String(req.params.identity || "").trim();
  if (!rawIdentity) return res.status(400).json({ error: "identity_required" });

  // Cohosts/producers never act on the room owner / producers.
  const actorIsHost = isHostRole(access);
  if (!actorIsHost && isProtectedIdentity(rawIdentity, await getRoomOwnerUid(roomId))) {
    return res.status(403).json({ error: "cannot_moderate_host" });
  }

  const identityDocId = normalizeControlsDocId(rawIdentity);
  const body = (req.body || {}) as any;

  // If a role is provided, treat this as a role change and
  // apply the corresponding preset defaults, resetting overrides.
  const rolePresetId = parsePresetId(body.role);
  if (rolePresetId) {
    const denied = await checkRolePresetAssignment(access, roomId, rawIdentity, rolePresetId);
    if (denied) return res.status(denied.status).json({ error: denied.error });
    return applyRolePresetToIdentity(req, res, { roomId, rawIdentity, presetId: rolePresetId, uid });
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

  const missingPerm = missingPermForControlsPatch(access, access.permissions, Object.keys(cleaned));
  if (missingPerm) {
    return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS, required: missingPerm });
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
// Body: { roleId: "cohost" | "participant" }  (legacy "moderator" = cohost)
// Auth: Firebase session cookie + Authorization: Bearer <roomAccessToken>
router.post("/:roomId/participants/:identity/permissions", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
  if (access.roomId !== roomId) return res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });

  const uid = (req as any).user?.uid as string | undefined;
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  const rawIdentity = String(req.params.identity || "").trim();
  if (!rawIdentity) return res.status(400).json({ error: "identity_required" });

  const body = (req.body || {}) as any;
  const presetId = parsePresetId(body.roleId || body.role || body.presetId);
  if (!presetId) {
    return res.status(400).json({ error: "roleId_invalid" });
  }

  const denied = await checkRolePresetAssignment(access, roomId, rawIdentity, presetId);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  return applyRolePresetToIdentity(req, res, { roomId, rawIdentity, presetId, uid });
});

// Apply a saved preset to a participant identity (same as /permissions:
// LiveKit push + token refresh hint).
// POST /api/rooms/:roomId/controls/:identity/apply-preset  Body: { presetId }
// Auth: Firebase session cookie + Authorization: Bearer <roomAccessToken>
router.post("/:roomId/controls/:identity/apply-preset", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
  if (access.roomId !== roomId) return res.status(403).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });

  const uid = (req as any).user?.uid as string | undefined;
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  const rawIdentity = String(req.params.identity || "").trim();
  if (!rawIdentity) return res.status(400).json({ error: "identity_required" });

  const presetId = parsePresetId((req.body as any)?.presetId);
  if (!presetId) return res.status(400).json({ error: "presetId_required" });

  const denied = await checkRolePresetAssignment(access, roomId, rawIdentity, presetId);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  return applyRolePresetToIdentity(req, res, { roomId, rawIdentity, presetId, uid });
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

    // Hosts, or producers/cohosts with canModerate, can move people on/off stage.
    if (!actorMay(access, access.permissions, "canModerate")) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const uid = (req as any).user?.uid as string | undefined;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    if (direction === "demote") {
      const ownerUid = await getRoomOwnerUid(roomId);
      if (isProtectedIdentity(targetIdentity, ownerUid, [access.identity])) {
        return res.status(400).json({ error: "cannot_demote_host" });
      }
    } else if (!isHostRole(access)) {
      // Promoting the owner would rewrite their controls doc; cohosts can't.
      if (isProtectedIdentity(targetIdentity, await getRoomOwnerUid(roomId))) {
        return res.status(403).json({ error: "cannot_moderate_host" });
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

      // Participant "Share Screen" comes from the room owner's participant preset.
      const participantPreset =
        direction === "promote" ? await loadOwnerRolePreset(await getRoomOwnerUid(roomId), "participant") : null;

      // Persist first so the SSE stream/rejoin enforcement sees the new role.
      const ref = controlsDocRef(roomId, identityDocId);
      await ref.set(
        direction === "promote"
          ? {
              role: "participant",
              canPublishAudio: true,
              canPublishVideo: true,
              canScreenShare: !!participantPreset?.canScreenShare,
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
      const permission = permissionForRoleWithControls(newRole, mergedControls, !!participantPreset?.canScreenShare);

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
            ? {
                canPublish: true,
                canPublishData: true,
                canPublishSources: participantPreset?.canScreenShare
                  ? ["microphone", "camera", "screen_share", "screen_share_audio"]
                  : ["microphone", "camera"],
              }
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
