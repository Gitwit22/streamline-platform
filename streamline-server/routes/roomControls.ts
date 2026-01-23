import { Router } from "express";
import { TrackSource } from "livekit-server-sdk";
import admin from "firebase-admin";
import { requireAuth } from "../middleware/requireAuth";
import { requireRoomAccessToken, type RoomAccessClaims, getRoomAccess } from "../middleware/roomAccessToken";
import { getLiveKitSdk } from "../lib/livekit";
import { resolveRoomIdentity } from "../lib/roomIdentity";
import { roleToParticipantPermission } from "../lib/livekitPermissions";

const router = Router();

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
    canManageDestinations: true,
    canStartStopStream: true,
    canStartStopRecording: true,
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
  if (!access || !access.roomId) return res.status(401).json({ error: "room_token_required" });
  if (access.roomId !== roomId) return res.status(403).json({ error: "room_mismatch" });

  if (!isHostOrCohost(access.role)) {
    return res.status(403).json({ error: "insufficient_role" });
  }

  const uid = (req as any).user?.uid as string | undefined;
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

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
  };

  // Only accept known keys.
  const cleaned: RoomControls = {};
  (Object.keys(patch) as Array<keyof RoomControls>).forEach((k) => {
    const val = patch[k];
    if (typeof val === "boolean") (cleaned as any)[k] = val;
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

  const identityDocId = normalizeControlsDocId((req.query as any)?.identity);
  const merged = await readControlsMerged(roomId, identityDocId);
  return res.json({ ok: true, controls: merged });
});

// Host/cohost updates controls for a specific participant identity (override doc).
// PATCH /api/rooms/:roomId/controls/:identity
// Auth: Firebase session cookie + Authorization: Bearer <roomAccessToken>
router.patch("/:roomId/controls/:identity", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: "room_token_required" });
  if (access.roomId !== roomId) return res.status(403).json({ error: "room_mismatch" });

  if (!isHostOrCohost(access.role)) {
    return res.status(403).json({ error: "insufficient_role" });
  }

  const uid = (req as any).user?.uid as string | undefined;
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

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
      },
      { merge: true },
    );

    // Update LiveKit participant permissions to reflect the new role.
    try {
      const sdk = await getLiveKitSdk();
      const RoomServiceClient = (sdk as any).RoomServiceClient as any;

      if (RoomServiceClient && process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
        const roomService = new RoomServiceClient(
          process.env.LIVEKIT_URL,
          process.env.LIVEKIT_API_KEY,
          process.env.LIVEKIT_API_SECRET,
        );

        const permission = mapPresetToLivekitPermission(rolePresetId);
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
          const listResp = await (roomService as any).listParticipants(livekitRoomName);
          const participants: any[] = Array.isArray((listResp as any)?.participants)
            ? (listResp as any).participants
            : Array.isArray(listResp)
            ? (listResp as any)
            : [];
          const target = participants.find((p: any) => p && p.identity === rawIdentity);
          const existingMetaRaw = target?.metadata as string | undefined;
          let existingMeta: any = {};
          if (existingMetaRaw && typeof existingMetaRaw === "string") {
            try {
              existingMeta = JSON.parse(existingMetaRaw) || {};
            } catch {
              existingMeta = {};
            }
          }
          const mergedMeta = { ...existingMeta, rolePresetId: rolePresetId };
          nextMetadata = JSON.stringify(mergedMeta);
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
  };

  const cleaned: RoomControls = {};
  (Object.keys(patch) as Array<keyof RoomControls>).forEach((k) => {
    const val = patch[k];
    if (typeof val === "boolean") (cleaned as any)[k] = val;
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

  const merged = await readControlsMerged(roomId, identityDocId);
  return res.json({ ok: true, controls: merged });
});

// Apply a role's permissions to a LiveKit participant immediately.
// POST /api/rooms/:roomId/participants/:identity/permissions
// Body: { roleId: "moderator" | "cohost" | "participant" }
// Auth: Firebase session cookie + Authorization: Bearer <roomAccessToken>
router.post("/:roomId/participants/:identity/permissions", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!roomId) return res.status(400).json({ error: "roomId_required" });

  const access = (req as any).roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) return res.status(401).json({ error: "room_token_required" });
  if (access.roomId !== roomId) return res.status(403).json({ error: "room_mismatch" });

  // Host-only moderation: only a host can change participant roles/permissions.
  if (String(access.role || "").toLowerCase() !== "host") {
    return res.status(403).json({ error: "insufficient_role" });
  }

  const uid = (req as any).user?.uid as string | undefined;
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

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
      },
      { merge: true },
    );

    // Push to LiveKit in real time so the participant's in-room
    // capabilities update immediately.
    let appliedPermission: any | null = null;
    let livekitApplied = false;
    let livekitReason: string | null = null;
    try {
      const sdk = await getLiveKitSdk();
      const RoomServiceClient = (sdk as any).RoomServiceClient as any;

      if (RoomServiceClient && process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
        const roomService = new RoomServiceClient(
          process.env.LIVEKIT_URL,
          process.env.LIVEKIT_API_KEY,
          process.env.LIVEKIT_API_SECRET,
        );

        const permission = mapPresetToLivekitPermission(presetId);
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
          const listResp = await (roomService as any).listParticipants(livekitRoomName);
          const participants: any[] = Array.isArray((listResp as any)?.participants)
            ? (listResp as any).participants
            : Array.isArray(listResp)
            ? (listResp as any)
            : [];
          const target = participants.find((p) => p && p.identity === rawIdentity);
          const existingMetaRaw = target?.metadata as string | undefined;
          let existingMeta: any = {};
          if (existingMetaRaw && typeof existingMetaRaw === "string") {
            try {
              existingMeta = JSON.parse(existingMetaRaw) || {};
            } catch {
              existingMeta = {};
            }
          }
          const mergedMeta = { ...existingMeta, rolePresetId: presetId };
          nextMetadata = JSON.stringify(mergedMeta);
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

        const lostScreenShare =
          Array.isArray((permission as any).canPublishSources) &&
          !(permission as any).canPublishSources.includes(TrackSource.SCREEN_SHARE);

        if (lostScreenShare) {
          try {
            const listResp = await (roomService as any).listParticipants(livekitRoomName);
            const participants: any[] = Array.isArray((listResp as any)?.participants)
              ? (listResp as any).participants
              : Array.isArray(listResp)
              ? (listResp as any)
              : [];

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
        console.error("[roomControls] livekit apply-permissions failed", err);
        return res.status(500).json({ error: "livekit_role_update_failed" });
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
  if (!access || !access.roomId) return res.status(401).json({ error: "room_token_required" });
  if (access.roomId !== roomId) return res.status(403).json({ error: "room_mismatch" });

  if (!isHostOrCohost(access.role)) {
    return res.status(403).json({ error: "insufficient_role" });
  }

  const uid = (req as any).user?.uid as string | undefined;
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

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
  if (!access || !access.roomId) return res.status(401).json({ error: "room_token_required" });
  if (access.roomId !== roomId) return res.status(403).json({ error: "room_mismatch" });

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

  const identityDocId = normalizeControlsDocId((req.query as any)?.identity);
  const defaultRef = controlsDocRef(roomId, "default");
  const identityRef = controlsDocRef(roomId, identityDocId);

  let lastDefault: any = {};
  let lastIdentity: any = {};
  const emit = () => write(mergeControls(lastDefault, lastIdentity));

  // Send an initial payload.
  try {
    const merged = await readControlsMerged(roomId, identityDocId);
    write(merged);
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
    },
    () => {
      lastIdentity = {};
      emit();
    },
  );

  const heartbeat = setInterval(() => {
    res.write(`: keep-alive ${Date.now()}\n\n`);
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    try {
      unsubDefault();
      unsubIdentity();
    } catch {
      // ignore
    }
  });
});

export default router;
