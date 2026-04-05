import { Router } from "express";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import { signGuestSession } from "../middleware/guestSession";
import { sanitizeDisplayName } from "../lib/sanitizeDisplayName";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { isGreenroomHlsEnabled } from "../lib/platformFeatureFlags";
import admin from "firebase-admin";

const router = Router();

/** Maximum guests who can be pending at once per room. */
const MAX_PENDING_GUESTS = 50;

function normalizeRoomId(raw: string | undefined): string {
  return String(raw || "").trim();
}

function readGreenroomPolicy(room: any) {
  const raw = room?.settings?.greenroom || {};
  const rawMode = raw.mode;
  const mode: "off" | "prejoin" | "hls_waiting" =
    rawMode === "prejoin" || rawMode === "hls_waiting" ? rawMode : "off";
  return {
    mode,
    requireApproval: raw.requireApproval === true,
    autoAdmit: raw.autoAdmit === true,
    vipBypass: raw.vipBypass === true,
    // Pre-normalize to lowercase for O(1) Set lookups at request time.
    vipList: new Set<string>(
      Array.isArray(raw.vipList)
        ? (raw.vipList as string[]).filter((v) => typeof v === "string").map((v) => v.toLowerCase())
        : []
    ),
    blockedList: new Set<string>(
      Array.isArray(raw.blockedList)
        ? (raw.blockedList as string[]).filter((v) => typeof v === "string").map((v) => v.toLowerCase())
        : []
    ),
  };
}

function buildGuestSessionCookie(res: any, guestSessionToken: string) {
  const isProduction = String(process.env.NODE_ENV || "development").toLowerCase() === "production";
  const secure = isProduction;
  const sameSite: "none" | "lax" = isProduction ? "none" : "lax";
  res.cookie("sl_guest", guestSessionToken, {
    httpOnly: true,
    sameSite,
    secure,
    path: "/",
    maxAge: 4 * 60 * 60 * 1000, // 4 hours
  });
}

/**
 * POST /api/rooms/:roomId/greenroom/request
 *
 * Guest requests access to a room via the greenroom queue.
 * No authentication required — any caller with a display name may request.
 *
 * Policy enforced:
 * - blockedList names are rejected (403).
 * - vipList names with vipBypass=true are auto-admitted immediately.
 * - autoAdmit=true admits immediately.
 * - requireApproval=true queues the request.
 *
 * Body: { displayName: string }
 * Returns:
 *   - approved immediately: { approved: true, guestSessionToken } + sets sl_guest cookie
 *   - pending:              { pending: true, requestId }
 *   - blocked:              403 { error: "guest_blocked" }
 */
router.post("/:roomId/greenroom/request", async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });

  const rawDisplayName = String(req.body?.displayName || "").trim();
  const displayName = sanitizeDisplayName(rawDisplayName) || rawDisplayName.slice(0, 40);
  if (!displayName) {
    return res.status(400).json({ error: "display_name_required" });
  }

  try {
    const platformEnabled = await isGreenroomHlsEnabled();
    if (!platformEnabled) {
      return res.status(409).json({
        error: "feature_disabled",
        feature: "greenroomHlsEnabled",
      });
    }

    const snap = await db.collection("rooms").doc(roomId).get();
    if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

    const room = (snap.data() as any) || {};
    const policy = readGreenroomPolicy(room);

    // Greenroom must be active.
    if (policy.mode === "off") {
      return res.status(409).json({ error: "greenroom_not_active" });
    }

    // blockedList check (case-insensitive display name match).
    const lowerName = displayName.toLowerCase();
    const isBlocked = policy.blockedList.has(lowerName);
    if (isBlocked) {
      return res.status(403).json({ error: "guest_blocked" });
    }

    // Auto-admit paths.
    const isVip = policy.vipList.has(lowerName);
    const shouldAutoAdmit = policy.autoAdmit || (policy.vipBypass && isVip);

    if (shouldAutoAdmit) {
      // Issue a guest session token immediately.
      const inviteId = `greenroom:${roomId}:auto:${Date.now()}`;
      const guestSessionToken = signGuestSession({ inviteId, roomId, role: "guest", displayName }, "4h");
      buildGuestSessionCookie(res, guestSessionToken);
      return res.json({ ok: true, approved: true, guestSessionToken });
    }

    // requireApproval path: enqueue in runtime.guestStaging.guests.
    const stagingRef = db.collection("rooms").doc(roomId);

    // Check pending count to avoid unbounded growth.
    const existing = room.runtime?.guestStaging?.guests || {};
    const pendingCount = Object.values(existing).filter((g: any) => g?.status === "pending").length;
    if (pendingCount >= MAX_PENDING_GUESTS) {
      return res.status(429).json({ error: "greenroom_full", details: "Too many pending guests" });
    }

    // Generate a random ID by obtaining a new document reference without writing it.
    const requestId = stagingRef.collection("_ids").doc().id;

    const guestEntry = {
      displayName,
      requestedAt: admin.firestore.Timestamp.now(),
      status: "pending",
    };

    await stagingRef.set(
      { runtime: { guestStaging: { enabled: true, guests: { [requestId]: guestEntry } } } },
      { merge: true }
    );

    return res.json({ ok: true, pending: true, requestId });
  } catch (err: any) {
    console.error("POST /api/rooms/:roomId/greenroom/request error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * GET /api/rooms/:roomId/greenroom/status?requestId=<id>
 *
 * Guest polls for their approval status.
 * No authentication required.
 *
 * When approved: sets sl_guest cookie and returns { approved: true, guestSessionToken }.
 * When denied:   returns { denied: true }.
 * When pending:  returns { pending: true }.
 * When not found: returns { pending: true } (treat as still pending to avoid enumeration).
 */
router.get("/:roomId/greenroom/status", async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });

  const requestId = String(req.query?.requestId || "").trim();
  if (!requestId) {
    return res.status(400).json({ error: "request_id_required" });
  }

  try {
    const platformEnabled = await isGreenroomHlsEnabled();
    if (!platformEnabled) {
      return res.status(409).json({
        error: "feature_disabled",
        feature: "greenroomHlsEnabled",
      });
    }

    const snap = await db.collection("rooms").doc(roomId).get();
    if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

    const room = (snap.data() as any) || {};
    const guests = room.runtime?.guestStaging?.guests || {};
    const entry = guests[requestId];

    if (!entry || entry.status === "pending") {
      return res.json({ ok: true, pending: true });
    }

    if (entry.status === "denied") {
      return res.json({ ok: true, denied: true });
    }

    if (entry.status === "admitted") {
      const displayName = String(entry.displayName || "").trim();
      const inviteId = `greenroom:${roomId}:${requestId}`;
      const guestSessionToken = signGuestSession({ inviteId, roomId, role: "guest", displayName }, "4h");
      buildGuestSessionCookie(res, guestSessionToken);
      return res.json({ ok: true, approved: true, guestSessionToken });
    }

    // Unknown status — treat as pending.
    return res.json({ ok: true, pending: true });
  } catch (err: any) {
    console.error("GET /api/rooms/:roomId/greenroom/status error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * GET /api/rooms/:roomId/greenroom/pending
 *
 * Host-only. Returns the list of pending guest requests.
 * Auth: requireAuth + canLayout.
 *
 * Returns: { ok, roomId, pending: [{ requestId, displayName, requestedAt }] }
 */
router.get("/:roomId/greenroom/pending", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });

  try {
    const platformEnabled = await isGreenroomHlsEnabled();
    if (!platformEnabled) {
      return res.status(409).json({
        error: "feature_disabled",
        feature: "greenroomHlsEnabled",
      });
    }

    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");

    const snap = await db.collection("rooms").doc(ctx.roomId).get();
    if (!snap.exists) return res.status(404).json({ error: PERMISSION_ERRORS.ROOM_NOT_FOUND });

    const room = (snap.data() as any) || {};
    const guests = room.runtime?.guestStaging?.guests || {};

    const pending = Object.entries(guests)
      .filter(([, entry]: [string, any]) => entry?.status === "pending")
      .map(([requestId, entry]: [string, any]) => ({
        requestId,
        displayName: String(entry.displayName || ""),
        requestedAt: entry.requestedAt
          ? (typeof entry.requestedAt.toMillis === "function"
            ? entry.requestedAt.toMillis()
            : null)
          : null,
      }))
      .sort((a, b) => (a.requestedAt ?? 0) - (b.requestedAt ?? 0));

    return res.json({ ok: true, roomId: ctx.roomId, pending });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    console.error("GET /api/rooms/:roomId/greenroom/pending error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * POST /api/rooms/:roomId/greenroom/approve
 *
 * Host approves a pending guest request.
 * Auth: requireAuth + canLayout.
 *
 * Body: { requestId: string }
 * Returns: { ok, roomId, requestId, displayName }
 */
router.post("/:roomId/greenroom/approve", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });

  const requestId = String(req.body?.requestId || "").trim();
  if (!requestId) {
    return res.status(400).json({ error: "request_id_required" });
  }

  try {
    const platformEnabled = await isGreenroomHlsEnabled();
    if (!platformEnabled) {
      return res.status(409).json({
        error: "feature_disabled",
        feature: "greenroomHlsEnabled",
      });
    }

    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");

    await db.runTransaction(async (tx) => {
      const ref = db.collection("rooms").doc(ctx.roomId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new RoomPermissionError(404, PERMISSION_ERRORS.ROOM_NOT_FOUND);

      const room = (snap.data() as any) || {};
      const entry = room.runtime?.guestStaging?.guests?.[requestId];
      if (!entry) throw Object.assign(new Error("request_not_found"), { status: 404 });
      if (entry.status !== "pending") {
        throw Object.assign(new Error("request_not_pending"), { status: 409 });
      }

      tx.set(
        ref,
        { runtime: { guestStaging: { guests: { [requestId]: { ...entry, status: "admitted", admittedAt: admin.firestore.Timestamp.now() } } } } },
        { merge: true }
      );
    });

    const snap = await db.collection("rooms").doc(ctx.roomId).get();
    const room = (snap.data() as any) || {};
    const entry = room.runtime?.guestStaging?.guests?.[requestId] || {};

    return res.json({ ok: true, roomId: ctx.roomId, requestId, displayName: String(entry.displayName || "") });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    if (err?.status === 404) return res.status(404).json({ error: "request_not_found" });
    if (err?.status === 409) return res.status(409).json({ error: "request_not_pending" });
    console.error("POST /api/rooms/:roomId/greenroom/approve error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/**
 * POST /api/rooms/:roomId/greenroom/deny
 *
 * Host denies a pending guest request.
 * Auth: requireAuth + canLayout.
 *
 * Body: { requestId: string }
 * Returns: { ok, roomId, requestId }
 */
router.post("/:roomId/greenroom/deny", requireAuth as any, async (req: any, res) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ error: "invalid_room_id" });

  const requestId = String(req.body?.requestId || "").trim();
  if (!requestId) {
    return res.status(400).json({ error: "request_id_required" });
  }

  try {
    const platformEnabled = await isGreenroomHlsEnabled();
    if (!platformEnabled) {
      return res.status(409).json({
        error: "feature_disabled",
        feature: "greenroomHlsEnabled",
      });
    }

    const ctx = await assertRoomPerm(req as any, roomId, "canLayout");

    await db.runTransaction(async (tx) => {
      const ref = db.collection("rooms").doc(ctx.roomId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new RoomPermissionError(404, PERMISSION_ERRORS.ROOM_NOT_FOUND);

      const room = (snap.data() as any) || {};
      const entry = room.runtime?.guestStaging?.guests?.[requestId];
      if (!entry) throw Object.assign(new Error("request_not_found"), { status: 404 });

      tx.set(
        ref,
        { runtime: { guestStaging: { guests: { [requestId]: { ...entry, status: "denied", deniedAt: admin.firestore.Timestamp.now() } } } } },
        { merge: true }
      );
    });

    return res.json({ ok: true, roomId: ctx.roomId, requestId });
  } catch (err: any) {
    if (err instanceof RoomPermissionError) {
      return res.status(err.status).json({ error: err.code });
    }
    if (err?.status === 404) return res.status(404).json({ error: "request_not_found" });
    console.error("POST /api/rooms/:roomId/greenroom/deny error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
