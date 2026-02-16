import express from "express";
import { firestore as db } from "../firebaseAdmin";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

const router = express.Router();

type AccessMode = "public" | "unlisted" | "password";

function asString(v: any): string {
  return typeof v === "string" ? v : "";
}

function coerceAccessMode(v: any): AccessMode {
  const raw = asString(v).trim();
  if (raw === "unlisted") return "unlisted";
  if (raw === "password") return "password";
  return "public";
}

function getJwtSecret(): string {
  const raw = asString(process.env.JWT_SECRET).trim();
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  if ((env === "production" || env === "staging") && (!raw || raw === "dev-secret")) {
    throw new Error("Missing JWT_SECRET (no dev-secret in production)");
  }
  return raw || "dev-secret";
}

function getClientIp(req: any): string {
  try {
    const xfwd = String(req.headers?.["x-forwarded-for"] || "").trim();
    if (xfwd) return xfwd.split(",")[0].trim();
  } catch {}
  return String(req.ip || req.connection?.remoteAddress || "unknown");
}

// Best-effort in-memory rate limiting for embed endpoints.
// Not perfect in multi-instance deployments, but blocks obvious abuse.
const embedWindowMs = 60_000;
const embedHits = new Map<string, { count: number; resetAt: number }>();

function hitEmbedRateLimit(key: string, max: number): boolean {
  const now = Date.now();
  const k = key || "unknown";
  const existing = embedHits.get(k);
  if (!existing || now >= existing.resetAt) {
    embedHits.set(k, { count: 1, resetAt: now + embedWindowMs });
    return false;
  }
  existing.count += 1;
  return existing.count > max;
}

function signEmbedGrant(embedId: string): string {
  return jwt.sign(
    { type: "edu_embed_grant", embedId },
    getJwtSecret(),
    { expiresIn: "30m" }
  );
}

function verifyEmbedGrant(grant: string, embedId: string): boolean {
  try {
    const decoded = jwt.verify(grant, getJwtSecret()) as any;
    return decoded?.type === "edu_embed_grant" && asString(decoded?.embedId).trim() === embedId;
  } catch {
    return false;
  }
}

async function loadPublicEventPayload(eventId: string) {
  const evSnap = await db.collection("events").doc(eventId).get();
  if (!evSnap.exists) return null;

  const ev = evSnap.data() || {};

  const title = typeof (ev as any).title === "string" ? (ev as any).title : "";
  const scheduledStartAt = coerceIso((ev as any).scheduledStartAt);
  const status = typeof (ev as any).status === "string" ? (ev as any).status : null;
  const broadcastId = typeof (ev as any).broadcastId === "string" ? (ev as any).broadcastId : null;

  let broadcast: any = null;
  if (broadcastId) {
    const bSnap = await db.collection("broadcasts").doc(broadcastId).get();
    if (bSnap.exists) {
      const b = bSnap.data() || {};
      broadcast = {
        id: bSnap.id,
        status: typeof (b as any).status === "string" ? (b as any).status : null,
        hlsPlaybackUrl: typeof (b as any).hlsPlaybackUrl === "string" ? (b as any).hlsPlaybackUrl : null,
        recordingId: typeof (b as any).recordingId === "string" ? (b as any).recordingId : null,
        replayUrl: typeof (b as any).replayUrl === "string" ? (b as any).replayUrl : null,
        endedAt: coerceIso((b as any).endedAt),
      };
    }
  }

  return {
    event: {
      id: evSnap.id,
      title,
      scheduledStartAt,
      status,
      broadcastId,
    },
    broadcast,
  };
}

function coerceIso(value: any): string | null {
  if (typeof value === "string" && value.trim()) return value;
  // Firestore Timestamp
  if (value && typeof value === "object" && typeof value.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

// Public viewer-safe endpoint used by embed players.
// MVP: no access gating; returns only the fields needed for playback UI.
router.get("/events/:eventId", async (req, res) => {
  try {
    const eventId = String(req.params.eventId || "").trim();
    if (!eventId) return res.status(400).json({ error: "eventId_required" });

    const evSnap = await db.collection("events").doc(eventId).get();
    if (!evSnap.exists) return res.status(404).json({ error: "event_not_found" });

    const ev = evSnap.data() || {};

    const title = typeof (ev as any).title === "string" ? (ev as any).title : "";
    const scheduledStartAt = coerceIso((ev as any).scheduledStartAt);
    const status = typeof (ev as any).status === "string" ? (ev as any).status : null;
    const broadcastId = typeof (ev as any).broadcastId === "string" ? (ev as any).broadcastId : null;

    // SECURITY: legacy endpoint no longer returns stream URLs.
    // Use GET /api/public/edu/embed?embedId=... for authorized playback details.
    let broadcast: any = null;
    if (broadcastId) {
      const bSnap = await db.collection("broadcasts").doc(broadcastId).get();
      if (bSnap.exists) {
        const b = bSnap.data() || {};
        broadcast = {
          id: bSnap.id,
          status: typeof (b as any).status === "string" ? (b as any).status : null,
          hlsPlaybackUrl: null,
          recordingId: null,
          replayUrl: null,
          endedAt: coerceIso((b as any).endedAt),
        };
      }
    }

    return res.json({
      event: {
        id: evSnap.id,
        title,
        scheduledStartAt,
        status,
        broadcastId,
      },
      broadcast,
    });
  } catch (err: any) {
    console.error("GET /api/public/edu/events/:eventId error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// ---------------------------------------------------------------------------
// Secure embed endpoints (gate on embedId, not eventId)
// ---------------------------------------------------------------------------

// GET /api/public/edu/embed/meta?embedId=...&t=...
// Returns viewer-safe metadata (no HLS URL). Token is required for unlisted/password.
router.get("/embed/meta", async (req, res) => {
  try {
    const ip = getClientIp(req);
    if (hitEmbedRateLimit(`meta:${ip}`, 120)) {
      return res.status(429).json({ error: "rate_limited" });
    }

    const embedId = asString(req.query.embedId).trim();
    const token = asString(req.query.t).trim();
    if (!embedId) return res.status(400).json({ error: "embedId_required" });

    const embedSnap = await db.collection("embeds").doc(embedId).get();
    if (!embedSnap.exists) return res.status(404).json({ error: "embed_not_found" });
    const embed = embedSnap.data() || {};

    const accessMode = coerceAccessMode((embed as any).accessMode);
    const expectedToken = asString((embed as any).token).trim();
    const passwordHash = asString((embed as any).passwordHash);
    const hasPassword = !!passwordHash;

    if (accessMode !== "public") {
      if (!token || !expectedToken || token !== expectedToken) {
        return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
      }
    }

    const eventId = asString((embed as any).eventId).trim();
    if (!eventId) return res.status(404).json({ error: "event_not_found" });

    const payload = await loadPublicEventPayload(eventId);
    if (!payload) return res.status(404).json({ error: "event_not_found" });

    // Strip playback URLs from meta.
    const b = payload.broadcast
      ? {
          ...payload.broadcast,
          hlsPlaybackUrl: null,
          recordingId: null,
          replayUrl: null,
        }
      : null;

    return res.json({
      embed: {
        embedId,
        accessMode,
        requiresPassword: accessMode === "password" && hasPassword,
      },
      event: payload.event,
      broadcast: b,
    });
  } catch (err: any) {
    console.error("GET /api/public/edu/embed/meta error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// POST /api/public/edu/embed/auth  { embedId, t, password }
// Returns a short-lived grant token for password-protected embeds.
router.post("/embed/auth", express.json(), async (req, res) => {
  try {
    const ip = getClientIp(req);
    if (hitEmbedRateLimit(`auth:${ip}`, 30)) {
      return res.status(429).json({ error: "rate_limited" });
    }

    const embedId = asString(req.body?.embedId).trim();
    const token = asString(req.body?.t).trim();
    const password = asString(req.body?.password);
    if (!embedId) return res.status(400).json({ error: "embedId_required" });

    const embedSnap = await db.collection("embeds").doc(embedId).get();
    if (!embedSnap.exists) return res.status(404).json({ error: "embed_not_found" });
    const embed = embedSnap.data() || {};

    const accessMode = coerceAccessMode((embed as any).accessMode);
    if (accessMode !== "password") return res.status(400).json({ error: "not_password_mode" });

    const expectedToken = asString((embed as any).token).trim();
    if (!token || !expectedToken || token !== expectedToken) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const passwordHash = asString((embed as any).passwordHash);
    if (!passwordHash) return res.status(400).json({ error: "password_not_configured" });
    if (!password.trim()) return res.status(400).json({ error: "password_required" });

    const ok = await bcrypt.compare(password, passwordHash);
    if (!ok) return res.status(401).json({ error: "invalid_password" });

    return res.json({ grant: signEmbedGrant(embedId), expiresInSeconds: 1800 });
  } catch (err: any) {
    console.error("POST /api/public/edu/embed/auth error", err);
    return res.status(500).json({ error: "internal" });
  }
});

// GET /api/public/edu/embed?embedId=...&t=...&g=...
// Returns playback data when authorized.
router.get("/embed", async (req, res) => {
  try {
    const ip = getClientIp(req);
    if (hitEmbedRateLimit(`embed:${ip}`, 240)) {
      return res.status(429).json({ error: "rate_limited" });
    }

    const embedId = asString(req.query.embedId).trim();
    const token = asString(req.query.t).trim();
    const grant = asString(req.query.g).trim();
    if (!embedId) return res.status(400).json({ error: "embedId_required" });

    const embedSnap = await db.collection("embeds").doc(embedId).get();
    if (!embedSnap.exists) return res.status(404).json({ error: "embed_not_found" });
    const embed = embedSnap.data() || {};

    const accessMode = coerceAccessMode((embed as any).accessMode);
    const expectedToken = asString((embed as any).token).trim();
    const passwordHash = asString((embed as any).passwordHash);
    const hasPassword = !!passwordHash;

    if (accessMode !== "public") {
      if (!token || !expectedToken || token !== expectedToken) {
        return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
      }
    }

    if (accessMode === "password" && hasPassword) {
      if (!grant || !verifyEmbedGrant(grant, embedId)) {
        return res.status(401).json({ error: "password_required" });
      }
    }

    const eventId = asString((embed as any).eventId).trim();
    if (!eventId) return res.status(404).json({ error: "event_not_found" });

    const payload = await loadPublicEventPayload(eventId);
    if (!payload) return res.status(404).json({ error: "event_not_found" });

    return res.json({
      embed: {
        embedId,
        accessMode,
      },
      event: payload.event,
      broadcast: payload.broadcast,
    });
  } catch (err: any) {
    console.error("GET /api/public/edu/embed error", err);
    return res.status(500).json({ error: "internal" });
  }
});

export default router;
