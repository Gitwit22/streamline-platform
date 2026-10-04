/**
 * Admin monitoring & operational awareness endpoints (admin Operations tab).
 *
 *   GET /monitoring/overview           counts: webhooks 24h, live rooms, open tickets, pending alerts
 *   GET /monitoring/services           dependency checks (lib/serviceHealth.ts, cached 30s; ?fresh=1)
 *   GET /monitoring/webhooks           recent webhook deliveries (webhookDeliveries)
 *   GET /alerts                        recent Horizon events (horizon_events, capped)
 *   GET /rooms/active                  live rooms with access mode, viewers, active outputs
 *   GET /rooms/:roomId/stream-summary  admin view of the post-stream summary
 *
 * Support tickets moved to routes/adminSupportTickets.ts (supportTickets
 * collection), mounted by routes/admin.ts at /support/tickets.
 *
 * All routes require admin authentication (requireAdmin middleware is
 * applied by the parent router that mounts this sub-router).
 */

import express from "express";
import { firestore } from "../firebaseAdmin";
import { countQuery } from "../lib/adminMetrics";
import { getServiceHealth } from "../lib/serviceHealth";
import { getCurrentViewers } from "../lib/viewerStats";
import { readViewerStats } from "../lib/viewerStatsPure";
import { getStreamSummary } from "../lib/streamSummary";
import { resolveRoomAccessMode } from "../lib/roomAccessPolicy";
import { EGRESS_SESSIONS } from "../lib/streamingMeter";

const router = express.Router();

function toMs(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v?.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** Run fn over items with at most `n` in flight. */
async function mapLimit<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

// -------------------------------------------------------------------------
// GET /api/admin/monitoring/overview
// -------------------------------------------------------------------------
router.get("/monitoring/overview", async (_req, res) => {
  try {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const deliveries = firestore.collection("webhookDeliveries").where("createdAt", ">=", oneDayAgo);
    const [total, failed, retrying, activeRooms, openTickets, inProgressTickets, pendingAlerts] = await Promise.all([
      countQuery(deliveries, "webhooks 24h"),
      countQuery(deliveries.where("status", "==", "failed"), "webhooks failed"),
      countQuery(deliveries.where("status", "==", "retrying"), "webhooks retrying"),
      countQuery(firestore.collection("rooms").where("status", "==", "live"), "live rooms"),
      countQuery(firestore.collection("supportTickets").where("status", "in", ["open", "new"]), "open tickets"),
      countQuery(firestore.collection("supportTickets").where("status", "==", "in_progress"), "in-progress tickets"),
      countQuery(firestore.collection("horizon_events").where("status", "==", "pending"), "pending alerts"),
    ]);
    const t = Number(total || 0);
    const f = Number(failed || 0);
    const r = Number(retrying || 0);
    return res.json({
      webhooks: { total: t, success: Math.max(0, t - f - r), failed: f, retrying: r },
      activeRooms: Number(activeRooms || 0),
      supportTickets: { open: Number(openTickets || 0), inProgress: Number(inProgressTickets || 0) },
      // Legacy name: pending Horizon events (alerts / support requests).
      pendingSupportEvents: Number(pendingAlerts || 0),
      checkedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[admin/monitoring/overview]", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -------------------------------------------------------------------------
// GET /api/admin/monitoring/services
// -------------------------------------------------------------------------
router.get("/monitoring/services", async (req, res) => {
  try {
    const fresh = String(req.query.fresh || "") === "1";
    const services = await getServiceHealth({ fresh });
    return res.json({ services });
  } catch (err: any) {
    console.error("[admin/monitoring/services]", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -------------------------------------------------------------------------
// GET /api/admin/monitoring/webhooks
// -------------------------------------------------------------------------
router.get("/monitoring/webhooks", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1), 200);
    const statusFilter = String(req.query.status || "").trim().toLowerCase();

    let query: FirebaseFirestore.Query = firestore.collection("webhookDeliveries");
    if (statusFilter === "success" || statusFilter === "failed" || statusFilter === "retrying") {
      query = query.where("status", "==", statusFilter);
    }
    const snap = await query.orderBy("createdAt", "desc").limit(limit).get();
    const deliveries = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return res.json({ deliveries, count: deliveries.length });
  } catch (err: any) {
    console.error("[admin/monitoring/webhooks]", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -------------------------------------------------------------------------
// GET /api/admin/alerts
// Recent Horizon events (support.alert / alert.* / monitoring.*), stored by
// routes/horizon/botApi.ts and routes/horizon.ts (capped collection).
// -------------------------------------------------------------------------
router.get("/alerts", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1), 200);
    const snap = await firestore.collection("horizon_events").orderBy("createdAt", "desc").limit(limit).get();
    const alerts = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return res.json({ alerts, count: alerts.length });
  } catch (err: any) {
    console.error("[admin/alerts]", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -------------------------------------------------------------------------
// GET /api/admin/rooms/active
// Rooms with status "live": owner, access mode, participants, current/peak/
// unique viewers, active outputs (open egress meters), session start.
// -------------------------------------------------------------------------
router.get("/rooms/active", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1), 200);
    const withViewers = String(req.query.viewers ?? "1") !== "0";

    const snap = await firestore.collection("rooms").where("status", "==", "live").limit(limit).get();

    const ownerIds = Array.from(
      new Set(snap.docs.map((d) => String((d.data() as any)?.ownerId || "").trim()).filter(Boolean))
    );
    const ownerEmails = new Map<string, string | null>();
    for (let i = 0; i < ownerIds.length; i += 100) {
      const refs = ownerIds.slice(i, i + 100).map((id) => firestore.collection("users").doc(id));
      try {
        const owners = await firestore.getAll(...refs, { fieldMask: ["email", "displayName"] });
        owners.forEach((o) => ownerEmails.set(o.id, o.exists ? ((o.data() as any)?.email ?? null) : null));
      } catch (err: any) {
        console.warn("[admin/rooms/active] owner lookup failed:", err?.message || err);
      }
    }

    const rooms = await mapLimit(snap.docs, 8, async (doc) => {
      const d = (doc.data() || {}) as any;
      const stats = readViewerStats(d.viewerStats);
      const [current, outputs] = await Promise.all([
        withViewers ? getCurrentViewers(doc.id, { room: d }).catch(() => null) : Promise.resolve(null),
        countQuery(
          firestore.collection(EGRESS_SESSIONS).where("roomId", "==", doc.id).where("meterOpen", "==", true),
          "room outputs"
        ),
      ]);
      return {
        roomId: doc.id,
        name: d.name || d.title || null,
        livekitRoomName: d.livekitRoomName || null,
        roomType: d.roomType || null,
        ownerId: d.ownerId || null,
        ownerEmail: d.ownerId ? ownerEmails.get(String(d.ownerId)) ?? null : null,
        status: d.status || null,
        access: resolveRoomAccessMode(d),
        createdAt: toMs(d.createdAt),
        startedAt: stats?.startedAt ?? toMs(d.liveStartedAt) ?? null,
        sessionId: stats?.sessionId ?? null,
        participants: current ? current.host + current.onStage + current.rtcAudience : null,
        onStage: current ? current.host + current.onStage : null,
        currentViewers: current ? current.total : null,
        hlsViewers: current ? current.hls : null,
        livekitRoomExists: current ? current.roomExists : null,
        viewerStats: stats
          ? {
              sessionId: stats.sessionId,
              startedAt: stats.startedAt,
              endedAt: stats.endedAt,
              peak: stats.peak,
              totalUnique: stats.totalUnique,
              totalUniqueRtc: stats.totalUniqueRtc,
              totalUniqueHls: stats.totalUniqueHls,
            }
          : null,
        hlsStatus: d.hls?.status || null,
        activeOutputs: outputs,
      };
    });

    rooms.sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));
    return res.json({ rooms, count: rooms.length, limit });
  } catch (err: any) {
    console.error("[admin/rooms/active]", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -------------------------------------------------------------------------
// GET /api/admin/rooms/:roomId/stream-summary?sessionId=
// Same payload as GET /api/rooms/:roomId/stream-summary (host-only there).
// -------------------------------------------------------------------------
router.get("/rooms/:roomId/stream-summary", async (req, res) => {
  const roomId = String(req.params.roomId || "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(roomId)) return res.status(400).json({ error: "invalid_room_id" });
  const rawSession = typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";
  if (rawSession && !/^[A-Za-z0-9_-]{1,128}$/.test(rawSession)) return res.status(400).json({ error: "invalid_session_id" });
  try {
    const roomSnap = await firestore.collection("rooms").doc(roomId).get();
    if (!roomSnap.exists) return res.status(404).json({ error: "room_not_found" });
    const summary = await getStreamSummary(roomId, roomSnap.data() || {}, rawSession || null);
    if (!summary) return res.status(404).json({ error: "no_session" });
    res.setHeader("Cache-Control", "no-store");
    return res.json(summary);
  } catch (err: any) {
    console.error("[admin/rooms/stream-summary]", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
