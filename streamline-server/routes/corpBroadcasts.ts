import express from "express";
import jwt from "jsonwebtoken";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { getCorpOrgContext, assertCorpRole, asString, coerceMillis } from "../lib/corpOrg";
import { writeCorpAudit } from "../lib/corpAudit";
import { ensureRoomDoc, setHlsStarting, setHlsLive, setHlsIdle } from "../services/rooms";
import { startHlsEgress, stopEgress } from "../services/livekitEgress";
import { deletePrefix } from "../lib/storageClient";
import { getLiveKitSdk } from "../lib/livekit";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = express.Router();

function normalizeBroadcast(docId: string, data: any) {
  return {
    id: docId,
    title: asString(data?.title),
    description: asString(data?.description),
    team: asString(data?.team),
    scope: asString(data?.scope || "company-wide"),
    status: asString(data?.status || "scheduled"),
    required: !!data?.required,
    scheduledAt: coerceMillis(data?.scheduledAt),
    startedAt: coerceMillis(data?.startedAt),
    endedAt: coerceMillis(data?.endedAt),
    viewers: typeof data?.viewers === "number" ? data.viewers : 0,
    createdAt: coerceMillis(data?.createdAt),
    createdBy: asString(data?.createdBy),
  };
}

/**
 * GET /broadcasts — list org broadcasts
 * Query: ?status=live,scheduled,completed&limit=50
 */
router.get("/broadcasts", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    const statusFilter = asString(req.query.status as string).split(",").map(s => s.trim()).filter(Boolean);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 200);

    let query = db.collection("corpBroadcasts")
      .where("orgId", "==", ctx.orgId)
      .orderBy("scheduledAt", "desc")
      .limit(limit);

    const snap = await query.get();
    let broadcasts = snap.docs.map(d => normalizeBroadcast(d.id, d.data()));

    if (statusFilter.length > 0) {
      broadcasts = broadcasts.filter(b => statusFilter.includes(b.status));
    }

    return res.json({ broadcasts });
  } catch (err: any) {
    console.error("[corp/broadcasts] list error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * POST /broadcasts — create a broadcast
 */
router.post("/broadcasts", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });
    if (!assertCorpRole(ctx.orgRole, ["admin", "manager"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const title = asString(req.body.title).trim();
    if (!title) return res.status(400).json({ error: "title_required" });

    const now = Date.now();
    const broadcastId = `${ctx.orgId}_bc_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const doc = {
      orgId: ctx.orgId,
      title,
      description: asString(req.body.description).trim(),
      team: asString(req.body.team).trim(),
      scope: asString(req.body.scope || "company-wide").trim(),
      status: "scheduled",
      required: !!req.body.required,
      scheduledAt: coerceMillis(req.body.scheduledAt) || now,
      startedAt: null,
      endedAt: null,
      viewers: 0,
      createdAt: now,
      createdBy: uid,
    };

    await db.collection("corpBroadcasts").doc(broadcastId).set(doc, { merge: true });

    await writeCorpAudit({
      orgId: ctx.orgId,
      action: "broadcast.create",
      actorUid: uid,
      actorName: asString((req as any).account?.displayName || ""),
      targetId: broadcastId,
      meta: { title },
    });

    return res.json({ broadcast: normalizeBroadcast(broadcastId, doc) });
  } catch (err: any) {
    console.error("[corp/broadcasts] create error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * PATCH /broadcasts/:id — update a broadcast
 */
router.patch("/broadcasts/:id", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });
    if (!assertCorpRole(ctx.orgRole, ["admin", "manager"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const broadcastId = req.params.id;
    const snap = await db.collection("corpBroadcasts").doc(broadcastId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    const updates: any = {};
    if (req.body.title !== undefined) updates.title = asString(req.body.title).trim();
    if (req.body.description !== undefined) updates.description = asString(req.body.description).trim();
    if (req.body.status !== undefined) updates.status = asString(req.body.status).trim();
    if (req.body.scheduledAt !== undefined) updates.scheduledAt = coerceMillis(req.body.scheduledAt);
    if (req.body.required !== undefined) updates.required = !!req.body.required;
    if (req.body.viewers !== undefined && typeof req.body.viewers === "number") updates.viewers = req.body.viewers;
    if (updates.status === "live" && !existing.startedAt) updates.startedAt = Date.now();
    if (updates.status === "completed" && !existing.endedAt) updates.endedAt = Date.now();

    updates.updatedAt = Date.now();

    await db.collection("corpBroadcasts").doc(broadcastId).set(updates, { merge: true });

    await writeCorpAudit({
      orgId: ctx.orgId,
      action: "broadcast.update",
      actorUid: uid,
      actorName: asString((req as any).account?.displayName || ""),
      targetId: broadcastId,
      meta: updates,
    });

    const updated = { ...existing, ...updates };
    return res.json({ broadcast: normalizeBroadcast(broadcastId, updated) });
  } catch (err: any) {
    console.error("[corp/broadcasts] update error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/**
 * DELETE /broadcasts/:id — delete a broadcast
 */
router.delete("/broadcasts/:id", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });
    if (!assertCorpRole(ctx.orgRole, ["admin"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const broadcastId = req.params.id;
    const snap = await db.collection("corpBroadcasts").doc(broadcastId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    await db.collection("corpBroadcasts").doc(broadcastId).delete();

    await writeCorpAudit({
      orgId: ctx.orgId,
      action: "broadcast.delete",
      actorUid: uid,
      actorName: asString((req as any).account?.displayName || ""),
      targetId: broadcastId,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[corp/broadcasts] delete error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ─── Helper: LiveKit + HLS env ──────────────────────────────────────── */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getHlsPublicBaseUrl(): string {
  const raw = process.env.HLS_PUBLIC_BASE_URL;
  if (raw && String(raw).trim()) return String(raw).trim().replace(/\/+$/, "");
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  if (env !== "production" && env !== "staging") return "http://localhost:8787/hls";
  throw new Error("Missing env: HLS_PUBLIC_BASE_URL");
}

function getLiveKitServerUrlForClient(): string | null {
  const raw = String(process.env.LIVEKIT_URL || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
  return raw;
}

function getRoomAccessSecret(): string {
  return String(process.env.ROOM_ACCESS_TOKEN_SECRET || process.env.JWT_SECRET || "dev-secret").trim();
}

async function getParticipantCount(livekitRoomName: string | undefined | null): Promise<number | null> {
  const roomName = String(livekitRoomName || "").trim();
  if (!roomName) return null;
  const serviceUrl = String(process.env.LIVEKIT_URL || "").trim().replace(/^wss?:\/\//i, (m) => (m.toLowerCase() === "ws://" ? "http://" : "https://"));
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!serviceUrl || !apiKey || !apiSecret) return null;
  try {
    const { RoomServiceClient } = await getLiveKitSdk();
    const client = new RoomServiceClient(serviceUrl, apiKey, apiSecret);
    const participants = await client.listParticipants(roomName);
    return participants?.length ?? 0;
  } catch { return null; }
}

/* ─── POST /broadcasts/:id/go-live ───────────────────────────────────── */
/**
 * Creates a LiveKit room, starts HLS egress, mints a host token,
 * and transitions the broadcast to "live".
 * Returns { broadcast, lkToken, roomAccessToken, livekitUrl, playlistUrl }
 */
router.post("/broadcasts/:id/go-live", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });
    if (!assertCorpRole(ctx.orgRole, ["admin", "manager"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const broadcastId = req.params.id;
    const snap = await db.collection("corpBroadcasts").doc(broadcastId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    // Idempotent: if already live, return existing tokens
    if (existing.status === "live" && existing.roomId) {
      // Re-mint host token
      const apiKey = requireEnv("LIVEKIT_API_KEY");
      const apiSecret = requireEnv("LIVEKIT_API_SECRET");
      const { AccessToken } = await getLiveKitSdk();
      const at = new AccessToken(apiKey, apiSecret, { identity: `corp-host-${uid}`, name: asString((req as any).account?.displayName || uid) });
      at.addGrant({ room: existing.livekitRoomName || existing.roomId, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
      const lkToken = await at.toJwt();
      const roomAccessToken = jwt.sign({ roomId: existing.roomId, livekitRoomName: existing.livekitRoomName || existing.roomId, role: "host", identity: `corp-host-${uid}` }, getRoomAccessSecret(), { expiresIn: "12h" });

      return res.json({
        broadcast: normalizeBroadcast(broadcastId, existing),
        lkToken,
        roomAccessToken,
        livekitUrl: getLiveKitServerUrlForClient(),
        playlistUrl: existing.playlistUrl || null,
      });
    }

    // 1) Create a dedicated room for this broadcast
    const roomId = `corp-bc-${broadcastId}`;
    const livekitRoomName = roomId;

    const { ref: roomRef } = await ensureRoomDoc({
      roomId,
      ownerId: uid,
      livekitRoomName,
      roomType: "rtc",
      initialStatus: "live",
      visibility: "unlisted",
      requiresAuth: false, // HLS viewers don't need auth
    });

    // 2) Mint a host LiveKit token
    const apiKey = requireEnv("LIVEKIT_API_KEY");
    const apiSecret = requireEnv("LIVEKIT_API_SECRET");
    const { AccessToken } = await getLiveKitSdk();
    const displayName = asString((req as any).account?.displayName || uid);
    const at = new AccessToken(apiKey, apiSecret, { identity: `corp-host-${uid}`, name: displayName });
    at.addGrant({ room: livekitRoomName, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    const lkToken = await at.toJwt();

    // 3) Start HLS egress
    const prefix = `hls/${roomId}/`;
    const playlistName = "room.m3u8";
    const livePlaylistName = "live.m3u8";
    const publicBase = getHlsPublicBaseUrl();
    const playlistUrl = `${publicBase}/${roomId}/${livePlaylistName}`;

    await setHlsStarting(roomRef, { presetId: "hls_720p", prefix });

    let egressId: string | null = null;
    try {
      const result = await startHlsEgress({
        roomName: livekitRoomName,
        layout: "speaker",
        prefix,
        playlistName,
        livePlaylistName,
        segmentDurationSec: 6,
        presetId: "hls_720p",
      });
      egressId = result.egressId;
      await setHlsLive(roomRef, { egressId: result.egressId, playlistUrl });
    } catch (egressErr: any) {
      console.error("[corp/broadcasts] egress start error:", egressErr?.message || egressErr);
      // Still proceed — host can be in room, HLS may come later
    }

    // 4) Update broadcast doc to "live"
    const now = Date.now();
    const updates: any = {
      status: "live",
      startedAt: now,
      roomId,
      livekitRoomName,
      egressId: egressId || null,
      playlistUrl,
      updatedAt: now,
    };
    await db.collection("corpBroadcasts").doc(broadcastId).set(updates, { merge: true });

    // 5) Mint room access token for client
    const roomAccessToken = jwt.sign(
      { roomId, livekitRoomName, role: "host", identity: `corp-host-${uid}`, permissions: { canStream: true, canRecord: true, canDestinations: true, canModerate: true, canLayout: true, canScreenShare: true, canInvite: true } },
      getRoomAccessSecret(),
      { expiresIn: "12h" }
    );

    await writeCorpAudit({
      orgId: ctx.orgId,
      action: "broadcast.go_live",
      actorUid: uid,
      actorName: displayName,
      targetId: broadcastId,
      meta: { roomId, title: existing.title },
    });

    return res.json({
      broadcast: normalizeBroadcast(broadcastId, { ...existing, ...updates }),
      lkToken,
      roomAccessToken,
      livekitUrl: getLiveKitServerUrlForClient(),
      playlistUrl,
    });
  } catch (err: any) {
    console.error("[corp/broadcasts] go-live error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ─── POST /broadcasts/:id/stop ──────────────────────────────────────── */
/**
 * Stops the HLS egress and marks the broadcast as "completed".
 */
router.post("/broadcasts/:id/stop", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });
    if (!assertCorpRole(ctx.orgRole, ["admin", "manager"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const broadcastId = req.params.id;
    const snap = await db.collection("corpBroadcasts").doc(broadcastId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    // Stop HLS egress if running
    if (existing.egressId) {
      try { await stopEgress(existing.egressId); } catch (e: any) {
        console.warn("[corp/broadcasts] egress stop warn:", e?.message || e);
      }
    }

    // Clean up HLS artifacts from R2
    const roomId = existing.roomId;
    if (roomId) {
      try { await deletePrefix(`hls/${roomId}/`); } catch {}
      // Reset room HLS state
      const roomRef = db.collection("rooms").doc(roomId);
      const roomSnap = await roomRef.get();
      if (roomSnap.exists) {
        await setHlsIdle(roomRef);
      }
    }

    // Update broadcast to completed
    const now = Date.now();
    await db.collection("corpBroadcasts").doc(broadcastId).set({
      status: "completed",
      endedAt: now,
      updatedAt: now,
      egressId: null,
      playlistUrl: null,
    }, { merge: true });

    await writeCorpAudit({
      orgId: ctx.orgId,
      action: "broadcast.stop",
      actorUid: uid,
      actorName: asString((req as any).account?.displayName || ""),
      targetId: broadcastId,
    });

    return res.json({ broadcast: normalizeBroadcast(broadcastId, { ...existing, status: "completed", endedAt: now }) });
  } catch (err: any) {
    console.error("[corp/broadcasts] stop error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ─── GET /broadcasts/:id/watch ──────────────────────────────────────── */
/**
 * Public-ish watch endpoint for corporate viewers.
 * Returns { status, playlistUrl, viewerCount, title, team }.
 * Requires corp member auth so only org members can watch.
 */
router.get("/broadcasts/:id/watch", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await getCorpOrgContext(uid);
    if (!ctx) return res.status(403).json({ error: "not_corporate_member" });

    const broadcastId = req.params.id;
    const snap = await db.collection("corpBroadcasts").doc(broadcastId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const data = snap.data() as any;
    if (data.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    const isLive = data.status === "live" && !!data.playlistUrl;
    let viewerCount: number | null = null;
    if (isLive && data.livekitRoomName) {
      viewerCount = await getParticipantCount(data.livekitRoomName);
    }

    // Increment viewer count on broadcast doc (best-effort)
    if (isLive) {
      db.collection("corpBroadcasts").doc(broadcastId).set({
        viewers: (data.viewers || 0) + 1,
        updatedAt: Date.now(),
      }, { merge: true }).catch(() => {});
    }

    return res.json({
      id: broadcastId,
      title: asString(data.title),
      team: asString(data.team),
      status: isLive ? "live" : data.status || "idle",
      playlistUrl: isLive ? data.playlistUrl : null,
      viewerCount: viewerCount ?? data.viewers ?? 0,
      startedAt: coerceMillis(data.startedAt),
    });
  } catch (err: any) {
    console.error("[corp/broadcasts] watch error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
