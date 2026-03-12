/**
 * Admin monitoring & operational awareness endpoints.
 *
 * These endpoints give the admin console visibility into:
 *   - Platform health overview
 *   - Monitored service status
 *   - Webhook delivery log
 *   - Active alerts
 *   - Active rooms
 *   - Support tickets (horizon_events with type support.request)
 *
 * All routes require admin authentication (requireAdmin middleware is
 * applied by the parent router that mounts this sub-router).
 */

import express from "express";
import { firestore } from "../firebaseAdmin";

const router = express.Router();

// -------------------------------------------------------------------------
// GET /api/admin/monitoring/overview
// High-level health summary for the admin dashboard.
// -------------------------------------------------------------------------
router.get("/monitoring/overview", async (_req, res) => {
  try {
    // Webhook delivery stats (last 24h)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const deliveriesSnap = await firestore
      .collection("webhookDeliveries")
      .where("createdAt", ">=", oneDayAgo)
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();

    let successCount = 0;
    let failedCount = 0;
    for (const doc of deliveriesSnap.docs) {
      const d = doc.data();
      if (d.status === "success") successCount++;
      else failedCount++;
    }

    // Active rooms count
    const activeRoomsSnap = await firestore
      .collection("rooms")
      .where("status", "==", "live")
      .limit(500)
      .get();

    // Pending support events count
    const pendingSupportSnap = await firestore
      .collection("horizon_events")
      .where("status", "==", "pending")
      .limit(500)
      .get();

    return res.json({
      webhooks: {
        total: deliveriesSnap.size,
        success: successCount,
        failed: failedCount,
      },
      activeRooms: activeRoomsSnap.size,
      pendingSupportEvents: pendingSupportSnap.size,
      checkedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[admin/monitoring/overview]", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -------------------------------------------------------------------------
// GET /api/admin/monitoring/services
// Returns a list of monitored services and their current state.
// (Placeholder: initially populated from env-var presence checks.)
// -------------------------------------------------------------------------
router.get("/monitoring/services", async (_req, res) => {
  try {
    const services = [
      {
        name: "api_server",
        status: "operational",
        checkedAt: new Date().toISOString(),
      },
      {
        name: "firestore",
        status: firestore ? "operational" : "degraded",
        checkedAt: new Date().toISOString(),
      },
      {
        name: "livekit",
        status: process.env.LIVEKIT_URL ? "configured" : "not_configured",
        checkedAt: new Date().toISOString(),
      },
      {
        name: "webhook_hooks",
        status:
          process.env.STREAMLINE_HOOKS_ENABLED === "true"
            ? "enabled"
            : "disabled",
        checkedAt: new Date().toISOString(),
      },
      {
        name: "horizon_bot",
        status:
          process.env.HORIZON_WEBHOOK_URL && process.env.HORIZON_WEBHOOK_SECRET
            ? "configured"
            : "not_configured",
        checkedAt: new Date().toISOString(),
      },
    ];

    return res.json({ services });
  } catch (err: any) {
    console.error("[admin/monitoring/services]", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -------------------------------------------------------------------------
// GET /api/admin/monitoring/webhooks
// Recent webhook delivery log (paginated).
// -------------------------------------------------------------------------
router.get("/monitoring/webhooks", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1),
      200
    );
    const statusFilter = String(req.query.status || "").trim().toLowerCase();

    let query: FirebaseFirestore.Query = firestore
      .collection("webhookDeliveries")
      .orderBy("createdAt", "desc")
      .limit(limit);

    if (statusFilter === "success" || statusFilter === "failed") {
      query = firestore
        .collection("webhookDeliveries")
        .where("status", "==", statusFilter)
        .orderBy("createdAt", "desc")
        .limit(limit);
    }

    const snap = await query.get();
    const deliveries = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return res.json({ deliveries, count: deliveries.length });
  } catch (err: any) {
    console.error("[admin/monitoring/webhooks]", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -------------------------------------------------------------------------
// GET /api/admin/alerts
// Recent alerts (horizon_events with type containing "alert" or "support").
// -------------------------------------------------------------------------
router.get("/alerts", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1),
      200
    );

    const snap = await firestore
      .collection("horizon_events")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    const alerts = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return res.json({ alerts, count: alerts.length });
  } catch (err: any) {
    console.error("[admin/alerts]", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -------------------------------------------------------------------------
// GET /api/admin/rooms/active
// List rooms with status "live".
// -------------------------------------------------------------------------
router.get("/rooms/active", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || "100"), 10) || 100, 1),
      500
    );

    const snap = await firestore
      .collection("rooms")
      .where("status", "==", "live")
      .limit(limit)
      .get();

    const rooms = snap.docs.map((doc) => {
      const d = doc.data() || {};
      return {
        roomId: doc.id,
        livekitRoomName: d.livekitRoomName || null,
        roomType: d.roomType || null,
        ownerId: d.ownerId || null,
        status: d.status || null,
        createdAt: d.createdAt || null,
      };
    });

    return res.json({ rooms, count: rooms.length });
  } catch (err: any) {
    console.error("[admin/rooms/active]", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -------------------------------------------------------------------------
// GET /api/admin/support/tickets
// List support-related horizon_events (type = support.request) with status.
// -------------------------------------------------------------------------
router.get("/support/tickets", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1),
      200
    );
    const statusFilter = String(req.query.status || "").trim().toLowerCase();

    let query: FirebaseFirestore.Query = firestore
      .collection("horizon_events")
      .where("type", "==", "support.request")
      .orderBy("createdAt", "desc")
      .limit(limit);

    if (statusFilter) {
      query = firestore
        .collection("horizon_events")
        .where("type", "==", "support.request")
        .where("status", "==", statusFilter)
        .orderBy("createdAt", "desc")
        .limit(limit);
    }

    const snap = await query.get();
    const tickets = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return res.json({ tickets, count: tickets.length });
  } catch (err: any) {
    console.error("[admin/support/tickets]", err?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
