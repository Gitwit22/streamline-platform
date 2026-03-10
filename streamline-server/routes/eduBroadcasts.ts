import express from "express";
import jwt from "jsonwebtoken";
import admin from "firebase-admin";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { loadEduOrgSettingsForUid, type EduOrgRole } from "../lib/eduOrgContext";
import { ensureRoomDoc, getRoom, setHlsStarting, setHlsLive, setHlsIdle, setHlsError } from "../services/rooms";
import { startHlsEgress, stopEgress } from "../services/livekitEgress";
import { deletePrefix } from "../lib/storageClient";
import { getLiveKitSdk } from "../lib/livekit";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { tenantCol } from "../lib/dbPaths";
import { storagePrefix } from "../lib/storagePaths";

const router = express.Router();

/* ─── Helpers ────────────────────────────────────────────────────────── */

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function coerceMillis(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return null;
}

function assertEduRole(role: EduOrgRole | null, allowed: EduOrgRole[]): boolean {
  if (!role) return false;
  return allowed.includes(role);
}

function normalizeBroadcast(docId: string, data: any) {
  return {
    id: docId,
    title: asString(data?.title),
    description: asString(data?.description),
    templateId: asString(data?.templateId),
    layout: asString(data?.layout || "speaker"),
    status: asString(data?.status || "scheduled"),
    publishHls: !!data?.publishHls,
    recordMp4: !!data?.recordMp4,
    alsoYoutube: !!data?.alsoYoutube,
    scheduledAt: coerceMillis(data?.scheduledAt),
    startedAt: coerceMillis(data?.startedAt),
    endedAt: coerceMillis(data?.endedAt),
    viewers: typeof data?.viewers === "number" ? data.viewers : 0,
    createdAt: coerceMillis(data?.createdAt),
    createdBy: asString(data?.createdBy),
    eventId: asString(data?.eventId) || null,
    roomId: asString(data?.roomId) || null,
    livekitRoomName: asString(data?.livekitRoomName) || null,
    playlistUrl: data?.playlistUrl || null,
    egressId: data?.egressId || null,
  };
}

/* ─── LiveKit + HLS env helpers ──────────────────────────────────────── */

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

/** Write to shared audit collection. */
async function writeEduAudit(params: {
  orgId: string;
  action: string;
  actorUid: string;
  actorName: string;
  targetId?: string | null;
  meta?: Record<string, any>;
}) {
  const now = Date.now();
  const id = `${params.orgId}_${now}_${Math.random().toString(36).slice(2, 8)}`;
  await tenantCol("eduAudit").doc(id).set({
    orgId: params.orgId,
    action: params.action,
    actorUid: params.actorUid,
    actorName: params.actorName || "",
    targetId: params.targetId ?? null,
    createdAt: now,
    ...(params.meta ? { meta: params.meta } : {}),
  }, { merge: true });
}

/* ─── POST /broadcasts/go-live ───────────────────────────────────────── */
/**
 * Creates a LiveKit room, optionally starts HLS egress + recording,
 * mints a host token, and returns everything the client needs.
 *
 * Body: { title, templateId, layout, publishHls, recordMp4, eventId? }
 * Returns: { broadcast, lkToken, roomAccessToken, livekitUrl, playlistUrl }
 */
router.post("/broadcasts/go-live", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await loadEduOrgSettingsForUid(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });
    // Only faculty_admin, faculty_teacher and student_producer(_assigned) can go live
    if (!assertEduRole(ctx.orgRole, ["faculty_admin", "faculty_teacher", "student_producer", "student_producer_assigned"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    // Check org-level policies for student producers
    if (ctx.orgRole === "student_producer" || ctx.orgRole === "student_producer_assigned") {
      if (!ctx.org?.defaults?.studentProducersCanStart) {
        return res.status(403).json({ error: "student_producers_cannot_start" });
      }
      if (ctx.org?.defaults?.requireAssignmentToStart && ctx.orgRole !== "student_producer_assigned") {
        return res.status(403).json({ error: "not_assigned_producer" });
      }
    }

    const title = asString(req.body.title).trim() || "EDU Broadcast";
    const templateId = asString(req.body.templateId).trim() || "announcements";
    const layout = asString(req.body.layout).trim() || "speaker";
    const publishHls = req.body.publishHls !== false;
    const recordMp4 = !!req.body.recordMp4;
    const eventId = asString(req.body.eventId).trim() || null;
    const assignedRoomId = asString(req.body.assignedRoomId).trim() || null;

    // If the client is already connected to a LiveKit room (via the
    // /rooms/:id/connect endpoint), reuse that room for HLS egress
    // instead of creating a brand-new one.
    const existingRoomId = asString(req.body.existingRoomId).trim() || null;
    const existingLivekitRoomName = asString(req.body.existingLivekitRoomName).trim() || null;

    // Resolve savedEmbedId so the embed viewer can show this broadcast.
    // Priority: 1) explicit body param  2) event doc  3) assigned room doc
    let savedEmbedId: string | undefined =
      asString(req.body.savedEmbedId).trim() || undefined;

    // If not provided explicitly, try the event doc
    if (!savedEmbedId && eventId) {
      try {
        const evSnap = await tenantCol("events").doc(eventId).get();
        if (evSnap.exists) {
          const evData = evSnap.data() as any;
          if (typeof evData?.savedEmbedId === "string" && evData.savedEmbedId.trim()) {
            savedEmbedId = evData.savedEmbedId.trim();
          }
        }
      } catch {
        // Non-fatal
      }
    }

    // Fallback: look up savedEmbedId from the assigned / existing room doc
    if (!savedEmbedId) {
      const lookupRoomId = assignedRoomId || existingRoomId;
      if (lookupRoomId) {
        try {
          const { data: srcRoom } = await getRoom(lookupRoomId);
          if ((srcRoom as any).savedEmbedId) {
            savedEmbedId = (srcRoom as any).savedEmbedId;
          }
        } catch {
          // Non-fatal — assigned room may not exist yet.
        }
      }
    }

    const now = Date.now();
    const broadcastId = `edu_bc_${ctx.orgId}_${now}_${Math.random().toString(36).slice(2, 8)}`;

    // 1) Create broadcast doc
    const doc: any = {
      orgId: ctx.orgId,
      title,
      templateId,
      layout,
      publishHls,
      recordMp4,
      alsoYoutube: false,
      status: "live",
      startedAt: now,
      endedAt: null,
      viewers: 0,
      createdAt: now,
      createdBy: uid,
      eventId,
    };

    // 2) Create or reuse a room for this broadcast
    const roomId = existingRoomId || `edu-bc-${broadcastId}`;
    const livekitRoomName = existingLivekitRoomName || roomId;

    const { ref: roomRef } = await ensureRoomDoc({
      roomId,
      ownerId: uid,
      livekitRoomName,
      roomType: "rtc",
      initialStatus: "live",
      visibility: "unlisted",
      requiresAuth: false, // HLS viewers don't need auth
      ...(savedEmbedId ? { savedEmbedId } : {}),
    });

    doc.roomId = roomId;
    doc.livekitRoomName = livekitRoomName;

    // 3) Mint host LiveKit token
    const apiKey = requireEnv("LIVEKIT_API_KEY");
    const apiSecret = requireEnv("LIVEKIT_API_SECRET");
    const { AccessToken } = await getLiveKitSdk();
    const displayName = ctx.userName || uid;
    const at = new AccessToken(apiKey, apiSecret, { identity: `edu-host-${uid}`, name: displayName });
    at.addGrant({ room: livekitRoomName, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    const lkToken = await at.toJwt();

    // 4) Start HLS egress if publishHls enabled
    let playlistUrl: string | null = null;
    let egressId: string | null = null;

    if (publishHls) {
      const prefix = storagePrefix("hls", roomId);
      const playlistName = "room.m3u8";
      const livePlaylistName = "live.m3u8";
      const publicBase = getHlsPublicBaseUrl();
      playlistUrl = `${publicBase}/${roomId}/${livePlaylistName}`;

      await setHlsStarting(roomRef, { presetId: "hls_720p", prefix });

      try {
        const result = await startHlsEgress({
          roomName: livekitRoomName,
          layout: layout === "grid" ? "grid" : "speaker",
          prefix,
          playlistName,
          livePlaylistName,
          segmentDurationSec: 6,
          presetId: "hls_720p",
        });
        egressId = result.egressId;
        await setHlsLive(roomRef, { egressId: result.egressId, playlistUrl });

        // Sync the saved embed's activeRoomId so /live/:savedEmbedId resolves
        // to this broadcast room for public HLS viewers.
        if (savedEmbedId) {
          try {
            await tenantCol("savedEmbeds").doc(savedEmbedId).set(
              {
                activeRoomId: roomId,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
          } catch (embedErr: any) {
            console.warn("[edu/broadcasts] embed activeRoomId sync failed:", embedErr?.message);
          }
        }
      } catch (egressErr: any) {
        console.error("[edu/broadcasts] egress start error:", egressErr?.message || egressErr);
        // Mark room as error so the public HLS endpoint reports the
        // correct state instead of staying stuck at "starting".
        try {
          await setHlsError(roomRef, egressErr?.message || "HLS egress failed to start");
        } catch { /* best-effort */ }
        // Clear the playlist URL so the client does not think HLS is live.
        playlistUrl = null;
      }
    }

    doc.playlistUrl = playlistUrl;
    doc.savedEmbedId = savedEmbedId || null;
    doc.egressId = egressId;

    await tenantCol("eduBroadcasts").doc(broadcastId).set(doc, { merge: true });

    // Link the broadcast back to the event so embed viewers can
    // resolve event → broadcast → hlsPlaybackUrl.
    if (eventId) {
      try {
        await tenantCol("events").doc(eventId).set(
          { broadcastId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true },
        );
      } catch (evErr: any) {
        console.warn("[edu/broadcasts] event broadcastId link failed:", evErr?.message);
      }
    }

    // 5) Mint room access token
    const roomAccessToken = jwt.sign(
      {
        roomId,
        livekitRoomName,
        role: "host",
        identity: `edu-host-${uid}`,
        eduBypass: true,
        permissions: {
          canStream: true,
          canRecord: true,
          canDestinations: true,
          canModerate: true,
          canLayout: true,
          canScreenShare: true,
          canInvite: true,
          canAnalytics: true,
          canMuteGuests: true,
          canRemoveGuests: true,
        },
      },
      getRoomAccessSecret(),
      { expiresIn: "12h" }
    );

    await writeEduAudit({
      orgId: ctx.orgId,
      action: "broadcast.go_live",
      actorUid: uid,
      actorName: displayName,
      targetId: broadcastId,
      meta: { title, templateId, eventId },
    });

    return res.json({
      broadcast: normalizeBroadcast(broadcastId, doc),
      lkToken,
      roomAccessToken,
      livekitUrl: getLiveKitServerUrlForClient(),
      playlistUrl,
    });
  } catch (err: any) {
    console.error("[edu/broadcasts] go-live error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ─── POST /broadcasts/:id/stop ──────────────────────────────────────── */

router.post("/broadcasts/:id/stop", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await loadEduOrgSettingsForUid(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });
    if (!assertEduRole(ctx.orgRole, ["faculty_admin", "faculty_teacher", "student_producer", "student_producer_assigned"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const broadcastId = req.params.id;
    const snap = await tenantCol("eduBroadcasts").doc(broadcastId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    // Stop HLS egress
    if (existing.egressId) {
      try { await stopEgress(existing.egressId); } catch (e: any) {
        console.warn("[edu/broadcasts] egress stop warn:", e?.message || e);
      }
    }

    // Clean up HLS artifacts
    const roomId = existing.roomId;
    if (roomId) {
      try { await deletePrefix(storagePrefix("hls", roomId)); } catch {}
      const roomRef = tenantCol("rooms").doc(roomId);
      const roomSnap = await roomRef.get();
      if (roomSnap.exists) {
        await setHlsIdle(roomRef);

        // Reset the saved embed's activeRoomId so the public viewer
        // shows "offline" instead of pointing at a dead room.
        // Check room doc first, then fall back to the broadcast doc.
        const embedId =
          (roomSnap.data() as any)?.savedEmbedId as string | undefined
          || existing.savedEmbedId as string | undefined;
        if (embedId) {
          try {
            await tenantCol("savedEmbeds").doc(embedId).set(
              {
                activeRoomId: null,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
          } catch (embedErr: any) {
            console.warn("[edu/broadcasts] embed activeRoomId reset failed:", embedErr?.message);
          }
        }
      }
    }

    // Update broadcast doc
    const now = Date.now();
    await tenantCol("eduBroadcasts").doc(broadcastId).set({
      status: "completed",
      endedAt: now,
      updatedAt: now,
      egressId: null,
      playlistUrl: null,
    }, { merge: true });

    // Also reset the linked event's isLive flag so it doesn't stay "live" in the UI
    const eventId = existing.eventId;
    if (typeof eventId === "string" && eventId) {
      const nowIso = new Date(now).toISOString();
      tenantCol("events").doc(eventId).update({
        isLive: false,
        endedAt: nowIso,
        updatedAt: nowIso,
      }).catch((e: any) => console.warn("[edu/broadcasts] event isLive reset failed:", e?.message));
    }

    await writeEduAudit({
      orgId: ctx.orgId,
      action: "broadcast.stop",
      actorUid: uid,
      actorName: ctx.userName || uid,
      targetId: broadcastId,
    });

    return res.json({ broadcast: normalizeBroadcast(broadcastId, { ...existing, status: "completed", endedAt: now }) });
  } catch (err: any) {
    console.error("[edu/broadcasts] stop error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ─── DELETE /broadcasts/:id ──────────────────────────────────────────── */
router.delete("/broadcasts/:id", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await loadEduOrgSettingsForUid(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });
    if (!assertEduRole(ctx.orgRole, ["faculty_admin"])) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const broadcastId = req.params.id;
    const snap = await tenantCol("eduBroadcasts").doc(broadcastId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const existing = snap.data() as any;
    if (existing.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    // If still live, stop egress first
    if (existing.status === "live" && existing.egressId) {
      try { await stopEgress(existing.egressId); } catch (e: any) {
        console.warn("[edu/broadcasts] egress stop warn on delete:", e?.message || e);
      }
    }

    // Clean up HLS artifacts
    if (existing.roomId) {
      try { await deletePrefix(storagePrefix("hls", existing.roomId)); } catch {}
      const roomRef = tenantCol("rooms").doc(existing.roomId);
      const roomSnap = await roomRef.get();
      if (roomSnap.exists) {
        await setHlsIdle(roomRef);

        // Reset embed link — check room doc, then broadcast doc
        const embedId =
          (roomSnap.data() as any)?.savedEmbedId as string | undefined
          || existing.savedEmbedId as string | undefined;
        if (embedId) {
          try {
            await tenantCol("savedEmbeds").doc(embedId).set(
              { activeRoomId: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
              { merge: true },
            );
          } catch {}
        }
      }
    }

    // Delete the broadcast document
    await tenantCol("eduBroadcasts").doc(broadcastId).delete();

    await writeEduAudit({
      orgId: ctx.orgId,
      action: "broadcast.delete",
      actorUid: uid,
      actorName: ctx.userName || uid,
      targetId: broadcastId,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[edu/broadcasts] delete error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ─── GET /broadcasts/:id/watch ──────────────────────────────────────── */
/**
 * Returns live status + HLS playlist URL.
 * Requires EDU org member auth.
 */
router.get("/broadcasts/:id/watch", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await loadEduOrgSettingsForUid(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const broadcastId = req.params.id;
    const snap = await tenantCol("eduBroadcasts").doc(broadcastId).get();
    if (!snap.exists) return res.status(404).json({ error: "not_found" });

    const data = snap.data() as any;
    if (data.orgId !== ctx.orgId) return res.status(403).json({ error: "wrong_org" });

    const isLive = data.status === "live" && !!data.playlistUrl;
    let viewerCount: number | null = null;
    if (isLive && data.livekitRoomName) {
      viewerCount = await getParticipantCount(data.livekitRoomName);
    }

    return res.json({
      id: broadcastId,
      title: asString(data.title),
      status: isLive ? "live" : data.status || "idle",
      playlistUrl: isLive ? data.playlistUrl : null,
      viewerCount: viewerCount ?? data.viewers ?? 0,
      startedAt: coerceMillis(data.startedAt),
    });
  } catch (err: any) {
    console.error("[edu/broadcasts] watch error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

/* ─── GET /broadcasts — list org broadcasts ──────────────────────────── */

router.get("/broadcasts", requireAuth, async (req, res) => {
  const uid = String((req as any).user?.uid || "").trim();
  if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

  try {
    const ctx = await loadEduOrgSettingsForUid(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 200);
    const statusFilter = typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : null;

    const snap = await tenantCol("eduBroadcasts")
      .where("orgId", "==", ctx.orgId)
      .limit(limit)
      .get();

    let broadcasts = snap.docs.map(d => normalizeBroadcast(d.id, d.data()));

    // Filter by status if ?status= is provided (e.g. ?status=live)
    if (statusFilter) {
      broadcasts = broadcasts.filter((b: any) => b.status === statusFilter);
    }

    // Sort in-memory (avoids composite index requirement)
    broadcasts.sort((a: any, b: any) => {
      const ta = typeof a.createdAt === "number" ? a.createdAt : 0;
      const tb = typeof b.createdAt === "number" ? b.createdAt : 0;
      return tb - ta;
    });
    return res.json({ broadcasts });
  } catch (err: any) {
    console.error("[edu/broadcasts] list error:", err?.message || err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
