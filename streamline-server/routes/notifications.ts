/**
 * Notification routes for StreamLine EDU.
 *
 * Mounted at /api/edu  →  /api/edu/notifications/*
 *
 * All endpoints require authentication via requireAuth and verify the
 * caller belongs to an EDU org.
 */

import express from "express";
import { requireAuth } from "../middleware/requireAuth";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { loadEduOrgSettingsForUid } from "../lib/eduOrgContext";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount,
} from "../services/notificationService";

const router = express.Router();

/* ── GET /notifications — list notifications for the current user ── */
router.get("/notifications", requireAuth as any, async (req: any, res) => {
  try {
    const uid = String(req.user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await loadEduOrgSettingsForUid(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(200, Math.floor(limitRaw)))
      : 50;
    const unreadOnly = req.query.unreadOnly === "true";

    const notifications = await listNotifications(uid, { limit, unreadOnly });

    return res.json({ notifications });
  } catch (err) {
    console.error("[notifications] GET /notifications error:", (err as any)?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/* ── GET /notifications/unread-count — quick badge count ─────────── */
router.get("/notifications/unread-count", requireAuth as any, async (req: any, res) => {
  try {
    const uid = String(req.user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const ctx = await loadEduOrgSettingsForUid(uid);
    if (!ctx) return res.status(403).json({ error: "not_edu_member" });

    const count = await getUnreadCount(uid);
    return res.json({ count });
  } catch (err) {
    console.error("[notifications] GET /notifications/unread-count error:", (err as any)?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/* ── PATCH /notifications/:id/read — mark one notification as read ─ */
router.patch("/notifications/:id/read", requireAuth as any, async (req: any, res) => {
  try {
    const uid = String(req.user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const notificationId = String(req.params.id || "").trim();
    if (!notificationId) return res.status(400).json({ error: "missing_id" });

    const updated = await markNotificationRead(notificationId, uid);
    if (!updated) return res.status(404).json({ error: "not_found" });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[notifications] PATCH /notifications/:id/read error:", (err as any)?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/* ── POST /notifications/read-all — mark all as read ──────────────── */
router.post("/notifications/read-all", requireAuth as any, async (req: any, res) => {
  try {
    const uid = String(req.user?.uid || "").trim();
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const count = await markAllNotificationsRead(uid);
    return res.json({ ok: true, updated: count });
  } catch (err) {
    console.error("[notifications] POST /notifications/read-all error:", (err as any)?.message || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
