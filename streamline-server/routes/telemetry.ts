import express from "express";
import { sanitizeDisplayName } from "../lib/sanitizeDisplayName";
import { firestore } from "../firebaseAdmin";
import { SlidingWindowLimiter, clientIp } from "../lib/rateLimit";
import { tryGetGuestSession } from "../middleware/guestSession";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import {
  isValidPresenceRoomId,
  joinPresenceKey,
  parseGuestPresenceStage,
  type GuestPresenceStage,
} from "../lib/joinPagePresence";

const router = express.Router();

// Join-page presence heartbeats arrive every ~20s per guest; allow headroom
// for several guests behind one NAT, but stop floods.
const presenceIpLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 60 });
const presenceRoomIpLimiter = new SlidingWindowLimiter({ windowMs: 60_000, max: 20 });

// Room existence cache so heartbeats don't read rooms/{id} every time.
const ROOM_EXISTS_TTL_MS = 60_000;
const roomExistsCache = new Map<string, { exists: boolean; at: number }>();

async function roomExists(roomId: string): Promise<boolean> {
  const now = Date.now();
  const cached = roomExistsCache.get(roomId);
  if (cached && now - cached.at < ROOM_EXISTS_TTL_MS) return cached.exists;
  const snap = await firestore.collection("rooms").doc(roomId).get();
  if (roomExistsCache.size > 5000) roomExistsCache.clear();
  roomExistsCache.set(roomId, { exists: snap.exists, at: now });
  return snap.exists;
}

/** rooms/{roomId}/joinPagePresence/{key}; read by GET /api/invites/room-status. */
export function joinPresenceCollection(roomId: string) {
  return firestore.collection("rooms").doc(roomId).collection("joinPagePresence");
}

/**
 * Join-page presence: { roomId, stage, identity?, displayName?, guestSessionToken? }.
 * No auth; rate limited; roomId must exist. A valid guest session for the
 * room supplies identity/displayName when the body omits them.
 */
async function handleGuestPresence(req: express.Request, res: express.Response, stage: GuestPresenceStage) {
  const body = (req.body || {}) as any;
  const roomId = body.roomId;
  if (!isValidPresenceRoomId(roomId)) {
    return res.status(400).json({ error: "roomId_invalid" });
  }
  const trimmedRoomId = roomId.trim();

  const ip = clientIp(req);
  const ipHit = presenceIpLimiter.hit(ip);
  const roomHit = presenceRoomIpLimiter.hit(`${ip}|${trimmedRoomId}`);
  if (!ipHit.allowed || !roomHit.allowed) {
    const retryMs = Math.max(ipHit.retryAfterMs, roomHit.retryAfterMs);
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryMs / 1000))));
    return res.status(429).json({ error: "rate_limited" });
  }

  if (!(await roomExists(trimmedRoomId))) {
    return res.status(404).json({ error: "room_not_found" });
  }

  const session = tryGetGuestSession(req, trimmedRoomId);
  const scopedSession = session && session.roomId === trimmedRoomId ? session : null;

  const rawIdentity = typeof body.identity === "string" ? body.identity.trim().slice(0, 200) : "";
  const identity = rawIdentity || scopedSession?.identity || "";
  const rawName =
    (typeof body.displayName === "string" ? body.displayName : "") || scopedSession?.displayName || "";
  const displayName = sanitizeDisplayName(String(rawName)).trim().slice(0, 64);

  const key = joinPresenceKey({
    identity,
    fallback: `${ip}|${req.get("user-agent") || ""}`,
  });
  const ref = joinPresenceCollection(trimmedRoomId).doc(key);

  if (stage === "left") {
    await ref.delete().catch(() => {});
    return res.json({ ok: true });
  }

  await ref.set(
    {
      stage,
      displayName: displayName || null,
      lastSeenAtMs: Date.now(),
    },
    { merge: true },
  );
  return res.json({ ok: true });
}

// Guest join-page presence: { roomId, stage: "join_page" | "entered_room" | "left", ... }.
// (Product telemetry is recorded server-side via lib/telemetry.ts.)
router.post("/guest", async (req, res) => {
  try {
    const stage = parseGuestPresenceStage((req.body as any)?.stage);
    if (!stage) return res.status(400).json({ error: "stage_invalid" });
    return await handleGuestPresence(req, res, stage);
  } catch (err) {
    console.error("telemetry/guest error", err);
    return res.status(500).json({ error: "telemetry_error" });
  }
});

export default router;
