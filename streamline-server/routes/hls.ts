import { Router } from "express";
import admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { getRoom, setHlsError, setHlsIdle, setHlsLive, setHlsStarting, touchHlsHeartbeat, HLS_STALE_STARTING_MS } from "../services/rooms";
import { decideHlsStart, shouldRefreshHlsHeartbeat } from "../lib/mediaPure";
import { requireRoomAccessToken, type RoomAccessClaims, getRoomAccess } from "../middleware/roomAccessToken";
import { requireAuth } from "../middleware/requireAuth";
import { startHlsEgress, HlsPresetId, stopEgress } from "../services/livekitEgress";
import { getPresetPlanContext, resolveHlsPreset } from "../lib/mediaPresets";
import { firestore } from "../firebaseAdmin";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import { canAccessFeature } from "./featureAccess";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import { logDelegatedRoomAction } from "../lib/collaborators";
import {
  checkStreamingStartGate,
  closeOutputIntervals,
  openOutputInterval,
  streamingGateErrorBody,
  tickRoomMeter,
} from "../lib/streamingMeter";
import { LIMIT_ERRORS } from "../lib/limitErrors";
import { deletePrefix } from "../lib/storageClient";
import { roomHasActivePaidEvent } from "../lib/monetization";
import { getCurrentViewers, onHlsIdle, onHlsLive } from "../lib/viewerStats";

const router = Router();

/** How often /status polling refreshes hls.heartbeatAt while live (purge uses its age). */
const HLS_HEARTBEAT_INTERVAL_MS = 60_000;

function getHlsPublicBaseUrl(): string {
  const raw = process.env.HLS_PUBLIC_BASE_URL;
  if (raw && String(raw).trim()) return String(raw).trim().replace(/\/+$/, "");

  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  // In local/dev, default to the documented Wrangler dev URL to avoid hard-failing
  // when .env isn't configured yet.
  if (env !== "production" && env !== "staging") {
    return "http://localhost:8787/hls";
  }

  throw new Error("Missing env: HLS_PUBLIC_BASE_URL");
}

async function cleanupHlsArtifacts(params: { roomId: string; prefix?: string | null }) {
  const prefix = (params.prefix && String(params.prefix).trim()) || `hls/${params.roomId}/`;
  try {
    await deletePrefix(prefix);
  } catch (e: any) {
    // Best-effort: do not fail stop/status paths on storage cleanup issues.
    console.warn("[hls] failed to delete HLS prefix", { roomId: params.roomId, prefix, error: e?.message || e });
  }
}

router.get("/ping", (req, res) => res.send("hls ok"));

// Public viewer-safe endpoint: returns only minimal, non-sensitive info.
// GET /api/hls/public/:roomId -> { status, playlistUrl }
router.get("/public/:roomId", async (req: any, res) => {
  const roomId = req.params.roomId;
  if (/[ \u2013#]/.test(roomId)) {
    return res.status(400).json({ error: "invalid_room_id" });
  }
  try {
    const { data: room } = await getRoom(roomId);
    const hls = room.hls || {};
    // Paywalled rooms only expose the playlist via /api/monetization/enter.
    let paywalled = false;
    if (hls.playlistUrl) {
      try {
        paywalled = await roomHasActivePaidEvent(roomId);
      } catch {
        paywalled = true;
      }
    }
    let viewerCount: number | undefined;
    if (hls.status === "live") {
      try {
        viewerCount = (await getCurrentViewers(roomId, { room })).total;
      } catch {
        viewerCount = undefined;
      }
    }
    return res.json({
      status: hls.status || "idle",
      playlistUrl: paywalled ? null : hls.playlistUrl || null,
      paywalled: paywalled || undefined,
      viewerCount,
    });
  } catch (e: any) {
    if (e?.message === PERMISSION_ERRORS.ROOM_NOT_FOUND) {
      return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    }
    console.error("HLS public status error", e);
    return res.status(500).json({ error: "Failed to fetch HLS status" });
  }
});

router.post("/start/:roomId", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  const { roomId: canonicalRoomId, livekitRoomName } = getRoomAccess(req);
  if (!canonicalRoomId || /[ \u2013#]/.test(canonicalRoomId)) {
    return res.status(400).json({ error: "invalid_room_id" });
  }

  const requestedRoomId = String(req.params.roomId || "").trim();
  if (requestedRoomId && requestedRoomId !== canonicalRoomId) {
    return res.status(400).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
  }

  const roomId = canonicalRoomId;
  // Resolved below once the room owner is known (owner default + plan clamp).
  let presetId: HlsPresetId = "hls_720p";

  try {
    const uid = (req as any).user?.uid;
    if (!uid) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    try {
      await assertRoomPerm(req as any, roomId, "canStream");
    } catch (err: any) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ error: err.code });
      }
      throw err;
    }

    const { ref: roomRef, data: room } = await getRoom(roomId);
    const ownerUid = String((room as any).ownerId || uid).trim() || uid;

    const featureAccess = await canAccessFeature(ownerUid, "hls");
    if (!featureAccess.allowed) {
      if (featureAccess.code === LIMIT_ERRORS.FEATURE_DISABLED) {
        return res.status(403).json({
          error: featureAccess.code,
          reason: featureAccess.reason || "HLS is temporarily disabled",
        });
      }
      return res.status(403).json({
        error: "hls_not_in_plan",
        reason: featureAccess.reason || "HLS is not available on your plan",
      });
    }

    // Monthly streaming-minutes gate (HLS output counts as streaming time;
    // overlapping outputs count once). Fails open on infrastructure errors.
    const gate = await checkStreamingStartGate({ ownerUid, roomId, actorUid: uid, route: "hls:start" });
    if (gate.allowed === false) {
      return res.status(403).json(streamingGateErrorBody(gate.decision));
    }

    if (room.roomType !== "rtc") return res.status(400).json({ error: "roomType must be rtc" });

    // HLS quality: explicit setup-modal choice (or the owner's own request),
    // else the ROOM OWNER's default; clamped to the owner's plan and 1080p.
    let hlsPresetClamped = false;
    try {
      const presetCtx = await getPresetPlanContext(ownerUid);
      const explicit = req.body?.presetExplicit === true || ownerUid === uid;
      const resolved = resolveHlsPreset({
        bodyPresetId: explicit ? req.body?.presetId : undefined,
        ownerDefaultPresetId: presetCtx.defaultPresetId,
        planMaxPresetId: presetCtx.maxPresetId,
      });
      presetId = resolved.hlsPresetId;
      hlsPresetClamped = resolved.clamped;
    } catch (e: any) {
      console.warn("[hls] preset resolution failed; using 720p", e?.message || e);
    }

    // IDEMPOTENT: if already starting/live, just return what we have
    // (fast path; the transactional claim below is authoritative).
    const status = room.hls?.status || "idle";
    if (decideHlsStart(room.hls, Date.now(), HLS_STALE_STARTING_MS).action === "existing") {
      return res.json({
        roomId,
        status,
        egressId: room.hls?.egressId || null,
        playlistUrl: room.hls?.playlistUrl || null,
      });
    }

    // Build stable paths
    const prefix = `hls/${roomId}/`;
    const playlistName = `room.m3u8`;
    const livePlaylistName = `live.m3u8`;
    const publicBase = getHlsPublicBaseUrl();
    // For best viewer UX, point clients at the live sliding playlist.
    const playlistUrl = `${publicBase}/${roomId}/${livePlaylistName}`;

    // Cap enforcement (per-session): compute stopAt at start and persist in room.hls
    // limits.hlsMaxMinutesPerSession: null = unlimited, 0 = no HLS time.
    let capMinutes: number | null = null;
    let stopAt: string | null = null;
    let hlsCap: number | null = null;
    try {
      const entitlements = await getEffectiveEntitlements(ownerUid);
      hlsCap = entitlements.limits.hlsMaxMinutesPerSession;
    } catch {
      // ignore cap lookup failures (treat as unlimited)
    }
    if (hlsCap === 0) {
      return res.status(403).json({
        error: LIMIT_ERRORS.LIMIT_EXCEEDED,
        reason: "Your plan does not include HLS session time",
      });
    }
    if (hlsCap !== null && Number.isFinite(hlsCap) && hlsCap > 0) {
      capMinutes = Math.round(hlsCap);
      stopAt = new Date(Date.now() + capMinutes * 60 * 1000).toISOString();
    }

    // 1) Atomically claim idle → starting (crash-safe). Concurrent starts:
    // only one wins; the others get the existing state back.
    const claim = await setHlsStarting(roomRef, { presetId, prefix, stopAt, capMinutes });
    if (!claim.started) {
      return res.json({
        roomId,
        status: claim.hls?.status || "starting",
        egressId: claim.hls?.egressId || null,
        playlistUrl: claim.hls?.playlistUrl || null,
      });
    }

    let egressId: string | null = null;
    try {
      // 2) Start egress
      ({ egressId } = await startHlsEgress({
        roomName: livekitRoomName,
        layout: "speaker",
        prefix,
        playlistName,
        livePlaylistName,
        segmentDurationSec: 6,
        presetId,
      }));

      // 3) Mark live + store URLs (throws if the run was stopped/superseded meanwhile)
      await setHlsLive(roomRef, { egressId, playlistUrl, runId: claim.runId });
      // Viewer counting: HLS going live starts (or joins) the live session.
      void onHlsLive(roomId);

      // Streaming meter: HLS output time starts now (closed + billed on stop,
      // auto-stop, egress_ended webhook, stale purge or the meter sweep).
      try {
        await openOutputInterval({
          egressId,
          kind: "hls",
          roomId,
          roomName: livekitRoomName,
          ownerUid,
          startedByUid: uid,
          startedAt: new Date(),
          destinations: ["streamline_hls"],
          hlsRunId: claim.runId,
          hlsPrefix: prefix,
        });
      } catch (meterErr: any) {
        console.error("[hls] failed to open streaming meter interval", {
          roomId,
          ownerUid,
          egressId,
          error: meterErr?.message || meterErr,
        });
      }

      // 4) If this room is bound to a Saved Embed, keep the
      // embed's activeRoomId in sync so /live/:savedEmbedId
      // always resolves to the room that is actually streaming.
      const savedEmbedId = (room as any).savedEmbedId as string | undefined;
      if (!savedEmbedId) {
        console.warn("[hls] start: room has no savedEmbedId; activeRoomId will not be synced", { roomId });
      } else {
        try {
          const embedRef = firestore.collection("savedEmbeds").doc(savedEmbedId);
          await embedRef.set(
            {
              activeRoomId: roomId,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        } catch (err) {
          // Do not fail HLS start if this bookkeeping write fails.
          console.error("[hls] failed to sync activeRoomId on Saved Embed", err);
        }
      }

      if (ownerUid !== uid) {
        await logDelegatedRoomAction({
          actedByUid: uid,
          ownerUid,
          roomId,
          action: "hls_start",
          metadata: { presetId },
        }).catch(() => {});
      }

      return res.json({
        roomId,
        status: "live",
        egressId,
        playlistUrl,
        presetId,
        presetClamped: hlsPresetClamped,
      });
    } catch (e: any) {
      // Never leak an egress we started but could not record as live.
      if (egressId) {
        try {
          await stopEgress(egressId);
        } catch (stopErr: any) {
          console.error("[hls] CRITICAL: failed to stop egress after start failure", { roomId, egressId, error: stopErr?.message || stopErr });
        }
        await cleanupHlsArtifacts({ roomId, prefix });
      }
      if (e?.message === "hls_run_superseded") {
        return res.status(409).json({ error: "hls_start_superseded" });
      }
      await setHlsError(roomRef, e?.message || "Failed to start HLS egress", claim.runId).catch(() => {});
      return res.status(500).json({ error: "Failed to start HLS egress", details: e?.message });
    }
  } catch (e: any) {
    if (e?.message === PERMISSION_ERRORS.ROOM_NOT_FOUND) {
      return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    }
    if (typeof e?.message === "string" && e.message.startsWith("Missing env:")) {
      return res.status(500).json({ error: "missing_env", details: e.message });
    }
    console.error("HLS start error", e);
    return res.status(500).json({ error: "Failed to start HLS" });
  }
});

// GET /api/hls/status/:roomId
// Returns current HLS state for the room so the client can poll
router.get("/status/:roomId", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  const { roomId: canonicalRoomId } = getRoomAccess(req);
  if (!canonicalRoomId || /[ \u2013#]/.test(canonicalRoomId)) {
    return res.status(400).json({ error: "invalid_room_id" });
  }

  const requestedRoomId = String(req.params.roomId || "").trim();
  if (requestedRoomId && requestedRoomId !== canonicalRoomId) {
    return res.status(400).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
  }

  const roomId = canonicalRoomId;
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    let room;
    try {
      const ctx = await assertRoomPerm(req as any, roomId, "canStream");
      room = ctx.room;
    } catch (err: any) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ error: err.code });
      }
      throw err;
    }

    const hls = room.hls || {};

    // Entitlement only matters when nothing is running. An in-flight egress
    // must stay observable (and cap auto-stop below must keep working) even if
    // HLS was kill-switched or the plan was downgraded mid-stream.
    const hlsActive = (hls as any).status === "live" || (hls as any).status === "starting";
    if (!hlsActive) {
      const ownerUid = String((room as any).ownerId || uid).trim() || uid;
      const featureAccess = await canAccessFeature(ownerUid, "hls");
      if (!featureAccess.allowed) {
        if (featureAccess.code === LIMIT_ERRORS.FEATURE_DISABLED) {
          return res.status(403).json({
            error: featureAccess.code,
            reason: featureAccess.reason || "HLS is temporarily disabled",
          });
        }
        return res.status(403).json({
          error: "hls_not_in_plan",
          reason: featureAccess.reason || "HLS is not available on your plan",
        });
      }
    }

    // Option B (MVP): enforce cap on status polling.
    // If stopAt has passed and status is live, stop egress and mark idle.
    const stopAtIso = typeof (hls as any).stopAt === "string" ? String((hls as any).stopAt).trim() : "";
    if ((hls.status || "idle") === "live" && stopAtIso) {
      const stopAtMs = Date.parse(stopAtIso);
      if (Number.isFinite(stopAtMs) && Date.now() >= stopAtMs) {
        const roomRef = firestore.collection("rooms").doc(roomId);

        if (hls.egressId) {
          try {
            await stopEgress(hls.egressId);
          } catch (e: any) {
            console.error("[hls] auto-stop failed to stop egress", e);
          }
        }

        // Best-effort: delete playlist + segments immediately.
        await cleanupHlsArtifacts({ roomId, prefix: (hls as any).prefix });

        // Bill exactly once via the meter interval (idempotent close).
        if (hls.egressId) {
          await closeOutputIntervals([hls.egressId], { endedAt: new Date(), reason: "hls_session_cap" });
        }

        await setHlsIdle(roomRef);
        void onHlsIdle(roomId, room);

        return res.json({
          status: "idle",
          playlistUrl: null,
          egressId: null,
          error: null,
        });
      }
    }

    // Streaming meter tick (throttled per room): bills running outputs and
    // stops them when the owner is past the monthly limit without overage
    // opt-in, or past plan maxSessionMinutes.
    if ((hls.status || "idle") === "live" && hls.egressId) {
      const stopped = await tickRoomMeter(roomId);
      if (stopped.includes(hls.egressId)) {
        return res.json({
          status: "idle",
          playlistUrl: null,
          egressId: null,
          error: "usage_limit_reached",
        });
      }
    }

    // Heartbeat: host polling proves the session is attended. The stale-HLS
    // purge decides by heartbeat age, so long streams are never killed while
    // someone is polling. Throttled to one write per interval.
    if (shouldRefreshHlsHeartbeat(hls, Date.now(), HLS_HEARTBEAT_INTERVAL_MS)) {
      void touchHlsHeartbeat(firestore.collection("rooms").doc(roomId)).catch(() => {});
    }

    // Phase 3 spec: return flat shape so clients can
    // poll for playlistUrl without re-starting HLS
    return res.json({
      status: hls.status || "idle",
      playlistUrl: hls.playlistUrl || null,
      egressId: hls.egressId || null,
      error: hls.error || null,
    });
  } catch (e: any) {
    console.error("HLS status error", e);
    return res.status(500).json({ error: "Failed to fetch HLS status" });
  }
});

// POST /api/hls/stop/:roomId
// Stops the LiveKit egress for this room and marks HLS idle
router.post("/stop/:roomId", requireAuth as any, requireRoomAccessToken as any, async (req: any, res) => {
  const { roomId: canonicalRoomId } = getRoomAccess(req);
  if (!canonicalRoomId || /[ \u2013#]/.test(canonicalRoomId)) {
    return res.status(400).json({ error: "invalid_room_id" });
  }

  const requestedRoomId = String(req.params.roomId || "").trim();
  if (requestedRoomId && requestedRoomId !== canonicalRoomId) {
    return res.status(400).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
  }

  const roomId = canonicalRoomId;
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    let roomRef;
    let room;
    try {
      const ctx = await assertRoomPerm(req as any, roomId, "canStream");
      room = ctx.room;
      roomRef = firestore.collection("rooms").doc(roomId);
    } catch (err: any) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ error: err.code });
      }
      throw err;
    }

    const ownerUid = String((room as any).ownerId || uid).trim() || uid;
    // No entitlement check here: stopping must always work, including when
    // HLS is kill-switched or the plan changed while live.
    const hls = room.hls || {};
    const egressId = hls.egressId;

    if (egressId) {
      try {
        await stopEgress(egressId);
      } catch (e: any) {
        // Treat stop as best-effort; log but still move room to idle
        console.error("Failed to stop HLS egress", e);
      }
    }

    // Best-effort: remove playlist + segments from storage.
    await cleanupHlsArtifacts({ roomId, prefix: (hls as any).prefix });

    await setHlsIdle(roomRef);
    void onHlsIdle(roomId, room);

    // Bill exactly once via the meter interval (idempotent close).
    if (egressId) {
      await closeOutputIntervals([egressId], { endedAt: new Date(), reason: "hls_stop" });
    }

    const updated = {
      status: "idle" as const,
      playlistUrl: null,
      egressId: null,
      error: null,
      runId: null,
      startedAt: null,
      stopAt: null,
      capMinutes: null,
      updatedAt: new Date().toISOString(),
    };

    if (ownerUid !== uid) {
      await logDelegatedRoomAction({
        actedByUid: uid,
        ownerUid,
        roomId,
        action: "hls_stop",
      }).catch(() => {});
    }

    return res.json({ roomId, hls: updated });
  } catch (e: any) {
    if (e?.message === PERMISSION_ERRORS.ROOM_NOT_FOUND) {
      return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });
    }
    console.error("HLS stop error", e);
    return res.status(500).json({ error: "Failed to stop HLS" });
  }
});

export default router;
