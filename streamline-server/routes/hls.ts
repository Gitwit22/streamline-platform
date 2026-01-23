import { Router } from "express";
import admin from "firebase-admin";
import { getRoom, setHlsError, setHlsIdle, setHlsLive, setHlsStarting } from "../services/rooms";
import { requireRoomAccessToken, type RoomAccessClaims, getRoomAccess } from "../middleware/roomAccessToken";
import { requireAuth } from "../middleware/requireAuth";
import { startHlsEgress, HlsPresetId, stopEgress } from "../services/livekitEgress";
import { firestore } from "../firebaseAdmin";
import { getCurrentMonthKey } from "../lib/usageTracker";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import { canAccessFeature } from "./featureAccess";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";

const router = Router();

async function incrementHlsUsageMinutes(uid: string, minutes: number) {
  const safeMinutes = Math.max(0, Math.round(Number(minutes || 0)));
  if (!uid || !safeMinutes) return;

  const monthKey = getCurrentMonthKey();
  const usageDocId = `${uid}_${monthKey}`;
  const usageRef = firestore.collection("usageMonthly").doc(usageDocId);
  const usageSnap = await usageRef.get();
  const existing = usageSnap.exists ? (usageSnap.data() as any) : {};

  const prevUsage = existing.usage || {};
  const prevYtd = existing.ytd || {};

  const nextUsage = {
    ...prevUsage,
    hlsMinutes: Number(prevUsage.hlsMinutes || 0) + safeMinutes,
  };

  const nextYtd = {
    ...prevYtd,
    hlsMinutes: Number(prevYtd.hlsMinutes || 0) + safeMinutes,
  };

  await usageRef.set(
    {
      uid,
      monthKey,
      usage: nextUsage,
      ytd: nextYtd,
      createdAt: existing.createdAt || new Date(),
      updatedAt: new Date(),
    },
    { merge: true }
  );
}

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
    return res.json({
      status: hls.status || "idle",
      playlistUrl: hls.playlistUrl || null,
    });
  } catch (e: any) {
    if (e?.message === "room_not_found") {
      return res.status(404).json({ error: "room_not_found" });
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
    return res.status(400).json({ error: "room_mismatch" });
  }

  const roomId = canonicalRoomId;
  const presetId = (req.body?.presetId || "hls_720p") as HlsPresetId;

  try {
    const uid = (req as any).user?.uid;
    if (!uid) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const featureAccess = await canAccessFeature((req as any).account || uid, "hls");
    if (!featureAccess.allowed) {
      return res.status(403).json({
        error: "hls_not_in_plan",
        reason: featureAccess.reason || "HLS is not available on your plan",
      });
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

    if (room.roomType !== "rtc") return res.status(400).json({ error: "roomType must be rtc" });

    // IDEMPOTENT: if already starting/live, just return what we have
    const status = room.hls?.status || "idle";
    if (status === "starting" || status === "live") {
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
    // caps.hlsMaxMinutesPerSession: null/missing => unlimited
    let capMinutes: number | null = null;
    let stopAt: string | null = null;
    try {
      const entitlements = await getEffectiveEntitlements((req as any).account || uid);
      const rawCap = entitlements?.caps?.hlsMaxMinutesPerSession;
      const n = rawCap === null || rawCap === undefined ? null : Number(rawCap);
      if (n !== null && Number.isFinite(n) && n > 0) {
        capMinutes = Math.round(n);
        stopAt = new Date(Date.now() + capMinutes * 60 * 1000).toISOString();
      }
    } catch {
      // ignore cap lookup failures (treat as unlimited)
    }

    // 1) Mark starting first (crash-safe)
    await setHlsStarting(roomRef, { presetId, prefix, stopAt, capMinutes });

    try {
      // 2) Start egress
      const { egressId } = await startHlsEgress({
        roomName: livekitRoomName,
        layout: "speaker",
        prefix,
        playlistName,
        livePlaylistName,
        segmentDurationSec: 6,
        presetId,
      });

      // 3) Mark live + store URLs
      await setHlsLive(roomRef, { egressId, playlistUrl });

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

      return res.json({
        roomId,
        status: "live",
        egressId,
        playlistUrl,
      });
    } catch (e: any) {
      await setHlsError(roomRef, e?.message || "Failed to start HLS egress");
      return res.status(500).json({ error: "Failed to start HLS egress", details: e?.message });
    }
  } catch (e: any) {
    if (e?.message === "room_not_found") {
      return res.status(404).json({ error: "room_not_found" });
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
    return res.status(400).json({ error: "room_mismatch" });
  }

  const roomId = canonicalRoomId;
  try {
    const uid = (req as any).user?.uid;
    if (!uid) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const featureAccess = await canAccessFeature((req as any).account || uid, "hls");
    if (!featureAccess.allowed) {
      return res.status(403).json({
        error: "hls_not_in_plan",
        reason: featureAccess.reason || "HLS is not available on your plan",
      });
    }

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

        // Compute and track usage against the room owner when available.
        let durationMinutes = 0;
        const startedAt: any = hls.startedAt;
        try {
          const startedDate: Date | null = startedAt
            ? startedAt.toDate
              ? startedAt.toDate()
              : new Date(startedAt)
            : null;
          if (startedDate && !Number.isNaN(startedDate.getTime())) {
            const diffMs = Date.now() - startedDate.getTime();
            if (diffMs > 0) {
              durationMinutes = Math.max(1, Math.round(diffMs / (60 * 1000)));
            }
          }
        } catch (e) {
          console.error("[hls] failed to compute HLS duration (auto-stop)", e);
        }

        const usageUid = (room as any).ownerId || uid;
        if (durationMinutes > 0 && usageUid) {
          try {
            await incrementHlsUsageMinutes(usageUid, durationMinutes);
          } catch (e) {
            console.error("[hls] failed to increment HLS usage (auto-stop)", e);
          }
        }

        await setHlsIdle(roomRef);

        return res.json({
          status: "idle",
          playlistUrl: null,
          egressId: null,
          error: null,
        });
      }
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
    return res.status(400).json({ error: "room_mismatch" });
  }

  const roomId = canonicalRoomId;
  try {
    const uid = (req as any).user?.uid;
    if (!uid) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const featureAccess = await canAccessFeature((req as any).account || uid, "hls");
    if (!featureAccess.allowed) {
      return res.status(403).json({
        error: "hls_not_in_plan",
        reason: featureAccess.reason || "HLS is not available on your plan",
      });
    }

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

    let durationMinutes = 0;
    const startedAt: any = hls.startedAt;
    try {
      const startedDate: Date | null = startedAt
        ? startedAt.toDate
          ? startedAt.toDate()
          : new Date(startedAt)
        : null;
      if (startedDate && !Number.isNaN(startedDate.getTime())) {
        const diffMs = Date.now() - startedDate.getTime();
        if (diffMs > 0) {
          durationMinutes = Math.max(1, Math.round(diffMs / (60 * 1000)));
        }
      }
    } catch (e) {
      console.error("[hls] failed to compute HLS duration", e);
    }

    await setHlsIdle(roomRef);

    const usageUid = (room as any).ownerId || uid;
    if (durationMinutes > 0 && usageUid) {
      try {
        await incrementHlsUsageMinutes(usageUid, durationMinutes);
      } catch (e) {
        console.error("[hls] failed to increment HLS usage", e);
      }
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

    return res.json({ roomId, hls: updated });
  } catch (e: any) {
    if (e?.message === "room_not_found") {
      return res.status(404).json({ error: "room_not_found" });
    }
    console.error("HLS stop error", e);
    return res.status(500).json({ error: "Failed to stop HLS" });
  }
});

export default router;
