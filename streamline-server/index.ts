import "dotenv/config";
import express from "express";
import cors, { type CorsOptions } from "cors";
import cookieParser from "cookie-parser";
import webhookRouter from "./routes/webhook";
import authRoutes from "./routes/auth";
import adminRoutes from './routes/admin';
import accountRoutes from "./routes/account";
import { requireAuth } from "./middleware/requireAuth";
import authRouter from "./routes/auth";
import billingRoutes from "./routes/billing";
import recordingsRoutes from "./routes/recordings";
import usageRoutes from "./routes/usageRoutes";
import plansRoutes from "./routes/plans";
import roomTokenRoute from "./routes/roomToken";
import roomsCreateRoutes from "./routes/roomsCreate";
import invitesRoutes from "./routes/invites";
import roomInvitesRoutes from "./routes/roomInvites";
import roomGuestAccessRoutes from "./routes/roomGuestAccess";
import multistreamRoutes from "./routes/multistream";
import roomsResolveRoutes from "./routes/roomsResolve";
import roomsHlsConfigRoutes from "./routes/roomsHlsConfig";
import roomsActiveEmbedRoutes from "./routes/roomsActiveEmbed";
import roomControlsRoutes from "./routes/roomControls";
import roomsLayoutRoutes from "./routes/roomsLayout";
import roomsPolicyRoutes from "./routes/roomsPolicy";
import roomsRecordingsRoutes from "./routes/roomsRecordings";
import destinationsRoutes from "./routes/destinations";
import liveRoutes from "./routes/live";
import statsRoutes from "./routes/stats";
import telemetryRoutes from "./routes/telemetry";
import savedEmbedsRoutes from "./routes/savedEmbeds";
import editingRoutes from "./routes/editing";
import maintenanceRoutes from "./routes/maintenance";
import { firestore as db } from "./firebaseAdmin";
import path from "path";
import { getLiveKitSdk } from "./lib/livekit"; // adjust path
import type { RoomServiceClient } from "livekit-server-sdk";
import { getCurrentMonthKey } from "./lib/usageTracker";
import { getEffectiveEntitlements } from "./lib/effectiveEntitlements";
import { evaluateUsageGate } from "./lib/usageOverages";
import { upsertUsageMonthlyOverageTotals } from "./lib/usageOveragesWriter";
import admin from "firebase-admin";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import hlsRoutes from "./routes/hls";
import publicHlsRoutes from "./routes/publicHls";
import publicRoomsHlsConfigRoutes from "./routes/publicRoomsHlsConfig";
import { sanitizeDisplayName } from "./lib/sanitizeDisplayName";
import { resolveRoomIdentity } from "./lib/roomIdentity";
import { assertRoomPerm, RoomPermissionError } from "./lib/rolePermissions";
import { PERMISSION_ERRORS } from "./lib/permissionErrors";
import { requireRoomAccessToken, type RoomAccessClaims, getRoomAccess } from "./middleware/roomAccessToken";

import { requireAdmin } from "./middleware/adminAuth";


import { uploadVideo } from "./lib/storageClient";


console.log("CLIENT_URL:", process.env.CLIENT_URL);

const PORT = process.env.PORT || 5137;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";


const app = express();

function normalizeControlsDocId(raw: any): string {
  const id = String(raw || "").trim();
  if (!id) return "default";
  if (id.includes("/")) return "default";
  if (id.length > 128) return id.slice(0, 128);
  return id;
}

// Allow primary client plus local dev hosts for testing/incognito shares
const normalizeOrigin = (origin: string) => {
  const trimmed = String(origin || "").trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

const allowedOrigins = new Set(
  [
    process.env.CLIENT_URL,
    process.env.CLIENT_URL_2,
    // Render deployments
    "https://streamline-platform.onrender.com",
    "https://streamline-hls-dev-web.onrender.com",
    // Production custom domains
    "https://streamline.nxtlvlts.com",
    "https://www.streamline.nxtlvlts.com",
    // Local dev
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
  ]
    .filter(Boolean)
    .map((o) => normalizeOrigin(String(o)))
);

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow same-origin / server-to-server / curl (no Origin header)
    if (!origin) return callback(null, true);

    // Normalize (strip trailing slash)
    const normalized = normalizeOrigin(origin);

    // Note: for disallowed browser origins, do NOT throw (which becomes a 500).
    // Instead, disable CORS for that request (no ACAO header) and let the browser block it.
    if (allowedOrigins.has(normalized)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Cache-Control",
    // Room-level access token used by in-room APIs (HLS, multistream, controls, etc.).
    // Explicitly allow both typical header casings to satisfy browser preflight checks.
    "x-room-access-token",
    "X-Room-Access-Token",
    // Legacy invite JWT (join links) used for guest RTC join/status without auth.
    "x-invite-token",
    "X-Invite-Token",
  ],
  exposedHeaders: ["x-sl-auth-fallback", "x-sl-auth-header-invalid"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
// Preflight
app.options(/.*/, cors(corsOptions));





// Stripe/Billing webhooks MUST run before JSON body parsing so Stripe
// webhook signature verification can use the raw request body.
app.use("/api/webhooks", webhookRouter);

// Body parsers for the rest of the API
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use("/api/auth", authRoutes);
app.use("/api/account", accountRoutes);

// Admin routes
app.use("/api/admin", adminRoutes);

// Maintenance routes (admin-only)
app.use("/api/maintenance", maintenanceRoutes);


// Health endpoint
app.get("/api", (req, res) => {
  res.json({
    service: "StreamLine Backend API",
    status: "running",
    endpoints: [
      "/api/billing",
      "/api/webhooks",
      "/api/recordings",
      "/api/rooms",
      "/api/admin",
      "/api/hls",
    ]
  });
});

// HLS routes
app.use("/api/hls", hlsRoutes);
// Public viewer HLS status (no auth, tiny payload)
app.use("/api/public/hls", publicHlsRoutes);
// Public viewer-safe HLS config (no auth)
app.use("/api/public/rooms", publicRoomsHlsConfigRoutes);
// Recordings API - This handles GET /:id and POST /start, /stop
app.use("/api/recordings", recordingsRoutes);

// Editing API (authenticated)
app.use("/api/editing", editingRoutes);

// Health check
app.get("/", (_req, res) => res.send("API up"));
app.use("/api/usage", usageRoutes); // gives /api/usage/summary

// =============================================================================
// API ROUTES - Order matters! More specific routes first
// =============================================================================

// RTC token minting: use /api/rooms/:roomId/token (mounted via roomGuestAccessRoutes)

// Room creation (host flow)
app.use("/api/rooms", roomsCreateRoutes);

// Room invite creation (authenticated)
app.use("/api/rooms", roomInvitesRoutes);

// Guest invite redeem + room status/token (mixed auth)
app.use("/api", roomGuestAccessRoutes);

// Invite resolve/accept flow
app.use("/api/invites", invitesRoutes);

// Multistream routes (YouTube/FB/Twitch)
app.use("/api/multistream", multistreamRoutes);
// Room resolve endpoint (/api/rooms/resolve)
app.use("/api/rooms", roomsResolveRoutes);
// Room access policy (allowGuests, etc.)
app.use("/api/rooms", roomsPolicyRoutes);
// Realtime in-room controls (host/cohost writes; all participants read via roomAccessToken)
app.use("/api/rooms", roomControlsRoutes);
// Persistent room layout config (controls viewer layout; recordings inherit)
app.use("/api/rooms", roomsLayoutRoutes);
// Latest recording state + reconcile helpers
app.use("/api/rooms", roomsRecordingsRoutes);
// Room-level persistent HLS config (NOT runtime HLS state)
app.use("/api/rooms", roomsHlsConfigRoutes);
// Room-level selection of which Saved Embed to use for HLS control
app.use("/api/rooms", roomsActiveEmbedRoutes);
// Destinations management (encrypted keys)
app.use("/api/destinations", destinationsRoutes);
// Live preflight
app.use("/api/live", liveRoutes);

// Saved embeds (user-owned) -> stable Firestore rooms
app.use("/api/saved-embeds", savedEmbedsRoutes);

// Billing routes
app.use("/api/billing", billingRoutes);

// Plans route (for Billing page)
app.use("/api/plans", plansRoutes);
// Public stats for landing page
app.use("/api/stats", statsRoutes);
// Lightweight telemetry events
app.use("/api/telemetry", telemetryRoutes);

// Protected config health (helps diagnose env drift across Render services)
app.get("/api/health/config", requireAuth, (req, res) => {
  const asBool = (v: any) => (v ? true : false);
  return res.json({
    ok: true,
    env: String(process.env.NODE_ENV || "development"),
    tokenGrants: "v3-no-sources",
    hasLivekitUrl: asBool(process.env.LIVEKIT_URL),
    hasLivekitApiKey: asBool(process.env.LIVEKIT_API_KEY),
    hasLivekitApiSecret: asBool(process.env.LIVEKIT_API_SECRET),
    hasJwtSecret: asBool(process.env.JWT_SECRET),
    hasRoomAccessTokenSecret: asBool(process.env.ROOM_ACCESS_TOKEN_SECRET),
  });
});


// Storage test route
app.get("/api/storage/test", requireAdmin, async (req, res) => {
  try {
    const testContent = `StreamLine Storage Test - ${new Date().toISOString()}`;
    const testBuffer = Buffer.from(testContent);
    const testPath = `test/${Date.now()}-test.txt`;

    const publicUrl = await uploadVideo(testBuffer, testPath, "text/plain");

    res.json({
      success: true,
      message: "✅ R2 storage is working!",
      publicUrl,
      testPath,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("❌ Storage test failed:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Storage test failed",
    });
  }
});

// =============================================================================
// Admin Controls (Host/Mod Only)
// =============================================================================

async function getRoomService(): Promise<RoomServiceClient> {
  const { RoomServiceClient } = await getLiveKitSdk();

  return new RoomServiceClient(
    process.env.LIVEKIT_URL!,
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!
  );
}

// In-memory room-level flags (non-persistent across server restarts)
const roomMuteLocks = new Map<string, boolean>();

async function assertEffectiveRoomControl(
  req: express.Request,
  roomId: string,
  perm: "canMuteGuests" | "canRemoveGuests",
): Promise<void> {
  const trimmedRoomId = String(roomId || "").trim();
  if (!trimmedRoomId) {
    throw new RoomPermissionError(400, PERMISSION_ERRORS.INVALID_ROOM, "roomId is required");
  }

  const ctx = await assertRoomPerm(req as any, trimmedRoomId, perm);
  const access = ctx.roomAccess as RoomAccessClaims | undefined;

  if (!access || !access.roomId) {
    throw new RoomPermissionError(401, PERMISSION_ERRORS.UNAUTHORIZED);
  }
  if (access.roomId !== trimmedRoomId) {
    throw new RoomPermissionError(403, PERMISSION_ERRORS.ROOM_MISMATCH);
  }

  // Moderation endpoints are permission-gated via roomAccessToken permissions
  // (assertRoomPerm above). Some deployments may want host-only moderation.
  const role = String(access.role || "").toLowerCase();
  const hostOnly = process.env.ROOM_MODERATION_HOST_ONLY === "1";
  if (hostOnly && role !== "host") {
    if (process.env.AUTH_DEBUG === "1") {
      console.log("[perm-debug] moderation host-only blocked", { role, perm });
    }
    throw new RoomPermissionError(403, PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS);
  }
}

// Mute/unmute a single participant's audio (host tools, not platform admin)
app.post("/api/roomModeration/mute", requireAuth, requireRoomAccessToken as any, async (req, res) => {
  try {
    const { identity, muted } = req.body as {
      identity?: string;
      muted?: boolean;
    };

    if (!identity || typeof muted !== "boolean") {
      return res.status(400).json({ error: "identity and muted are required" });
    }

    const { roomId, livekitRoomName } = getRoomAccess(req as any);

    try {
      await assertEffectiveRoomControl(req as any, roomId, "canMuteGuests");
    } catch (err) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ error: err.code });
      }
      throw err;
    }

    console.log("ADMIN MUTE", { roomId, livekitRoomName, identity, muted });

    const roomService = await getRoomService();
    const sdk = (await getLiveKitSdk()) as any;
    const TrackType = sdk.TrackType;
    const TrackSource = sdk.TrackSource;

    const participant = await roomService.getParticipant(livekitRoomName, identity);
    const tracks: any[] = Array.isArray((participant as any)?.tracks) ? (participant as any).tracks : [];
    const audioTrack =
      tracks.find((t: any) => t?.source === TrackSource.MICROPHONE) ||
      tracks.find((t: any) => t?.type === TrackType.AUDIO);

    if (!audioTrack) {
      console.warn("No audio track found for", { roomId, livekitRoomName, identity });
      return res.status(404).json({ error: "no audio track found" });
    }

    if (process.env.AUTH_DEBUG === "1") {
      console.log("[livekit-debug] mutePublishedTrack", {
        livekitRoomName,
        identity,
        trackSid: audioTrack.sid,
        muted,
      });
    }

    await roomService.mutePublishedTrack(livekitRoomName, identity, audioTrack.sid, muted);

    return res.json({
      ok: true,
      muted,
      trackSid: audioTrack.sid,
      identity,
    });
  } catch (e: any) {
    console.error("mute error", e);
    const msg =
      typeof e?.message === "string"
        ? e.message
        : typeof e?.toString === "function"
        ? e.toString()
        : "mute_error";
    return res.status(500).json({ error: msg });
  }
});

// Mute/unmute ALL participants' audio (host tools)
app.post("/api/roomModeration/mute-all", requireAuth, requireRoomAccessToken as any, async (req, res) => {
  try {
    const { muted } = req.body as { room?: string; muted?: boolean };

    if (typeof muted !== "boolean") {
      return res.status(400).json({ error: "muted is required" });
    }

    const { roomId, livekitRoomName } = getRoomAccess(req as any);

    try {
      await assertEffectiveRoomControl(req as any, roomId, "canMuteGuests");
    } catch (err) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ error: err.code });
      }
      throw err;
    }

    console.log("ADMIN MUTE-ALL", { roomId, livekitRoomName, muted });

    const roomService = await getRoomService();
    const sdk = (await getLiveKitSdk()) as any;
    const TrackType = sdk.TrackType;
    const TrackSource = sdk.TrackSource;

    if (process.env.AUTH_DEBUG === "1") {
      console.log("[livekit-debug] listParticipants (mute-all)", { livekitRoomName });
    }

    const participants = await roomService.listParticipants(livekitRoomName);
    const results: Array<{ identity: string; trackSid: string | null; changed: boolean }> = [];

    for (const p of participants) {
      const tracks: any[] = Array.isArray((p as any)?.tracks) ? (p as any).tracks : [];
      const audioTrack =
        tracks.find((t: any) => t?.source === TrackSource.MICROPHONE) ||
        tracks.find((t: any) => t?.type === TrackType.AUDIO);

      if (!audioTrack) {
        results.push({ identity: p.identity, trackSid: null, changed: false });
        continue;
      }

          if (process.env.AUTH_DEBUG === "1") {
            console.log("[livekit-debug] mutePublishedTrack (mute-all)", {
              livekitRoomName,
              identity: p.identity,
              trackSid: audioTrack.sid,
              muted,
            });
          }

          await roomService.mutePublishedTrack(livekitRoomName, p.identity, audioTrack.sid, muted);
      results.push({ identity: p.identity, trackSid: audioTrack.sid, changed: true });
    }

    return res.json({ ok: true, muted, results });
  } catch (e: any) {
    console.error("mute-all error", e);
    const msg =
      typeof e?.message === "string"
        ? e.message
        : typeof e?.toString === "function"
        ? e.toString()
        : "mute_all_error";
    return res.status(500).json({ error: msg });
  }
});

// Room-level mute lock flag (in-memory) + LiveKit permissions update (host tools)
app.post("/api/roomModeration/mute-lock", requireAuth, requireRoomAccessToken as any, async (req, res) => {
  try {
    const { room, muteLock, hostIdentity } = req.body as {
      room?: string;
      muteLock?: boolean;
      hostIdentity?: string;
    };

    if (typeof muteLock !== "boolean") {
      return res.status(400).json({ error: "muteLock is required" });
    }

    const { roomId, livekitRoomName } = getRoomAccess(req as any);

    try {
      await assertEffectiveRoomControl(req as any, roomId, "canMuteGuests");
    } catch (err) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ error: err.code });
      }
      throw err;
    }

    roomMuteLocks.set(livekitRoomName, muteLock);
    console.log("ROOM MODERATION MUTE-LOCK", { roomId, livekitRoomName, muteLock, hostIdentity });

    // Update LiveKit participant permissions so guests can't re-enable mic
    try {
      const roomService = await getRoomService();
      const sdk = (await getLiveKitSdk()) as any;
      const TrackSource = sdk.TrackSource;

      const toSourceString = (s: any): string => {
        if (typeof s === "string") return s.toLowerCase();
        // LiveKit server SDK may surface TrackSource values as enums; normalize to strings
        if (s === TrackSource.MICROPHONE) return "microphone";
        if (s === TrackSource.CAMERA) return "camera";
        if (s === TrackSource.SCREEN_SHARE) return "screen_share";
        if (s === TrackSource.SCREEN_SHARE_AUDIO) return "screen_share_audio";
        return String(s).toLowerCase();
      };

      const participants = await roomService.listParticipants(livekitRoomName);

      for (const p of participants) {
        if (hostIdentity && p.identity === hostIdentity) continue; // never restrict host

        const currentPerms: any = (p as any).permission || {};
        const currentSourcesRaw: any[] = Array.isArray(currentPerms.canPublishSources)
          ? currentPerms.canPublishSources
          : [];
        const currentSources = currentSourcesRaw.map(toSourceString).filter(Boolean);

        const isMic = (s: any) => toSourceString(s) === "microphone";
        const isScreenShareAudio = (s: any) => toSourceString(s) === "screen_share_audio";

        if (muteLock) {
          // Remove audio-related publish sources (mic + screen share audio)
          const nextSources = currentSources.filter((s) => !(isMic(s) || isScreenShareAudio(s)));

          await roomService.updateParticipant(livekitRoomName, p.identity, {
            permission: {
              ...currentPerms,
              canPublishSources: nextSources,
            },
          });
        } else {
          // Restore audio publish ability while preserving any existing sources.
          // Always use string publish sources for LiveKit compatibility.
          const toEnsure = ["microphone", "screen_share_audio"];
          const merged = Array.from(new Set([...(currentSources || []), ...toEnsure]));

          await roomService.updateParticipant(livekitRoomName, p.identity, {
            permission: {
              ...currentPerms,
              canPublishSources: merged,
            },
          });
        }
      }
    } catch (permErr) {
      // Don't fail the whole request if permissions update has issues; just log
      console.error("mute-lock permissions update error", permErr);
    }

    return res.json({ ok: true, muteLock });
  } catch (e: any) {
    console.error("mute-lock error", e);
    const msg =
      typeof e?.message === "string"
        ? e.message
        : typeof e?.toString === "function"
        ? e.toString()
        : "mute_lock_error";
    return res.status(500).json({ error: msg });
  }
});

// Public room settings (currently only muteLock)
app.get("/api/roomSettings/:room", (req, res) => {
  const roomParam = String(req.params.room || "").trim();
  if (!roomParam) {
    return res.status(400).json({ error: "room is required" });
  }
  const muteLock = !!roomMuteLocks.get(roomParam);
  return res.json({ muteLock });
});

// Remove/kick a participant
app.post("/api/roomModeration/remove", requireAuth, requireRoomAccessToken as any, async (req, res) => {
  try {
    const { identity } = req.body;

    if (!identity) {
      return res.status(400).json({ ok: false, error: "identity is required" });
    }

    const { roomId, livekitRoomName } = getRoomAccess(req as any);

    try {
      await assertEffectiveRoomControl(req as any, roomId, "canRemoveGuests");
    } catch (err) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ ok: false, error: err.code });
      }
      throw err;
    }

    const roomService = await getRoomService();

    if (process.env.AUTH_DEBUG === "1") {
      console.log("[livekit-debug] removeParticipant", {
        livekitRoomName,
        identity,
      });
    }

    await roomService.removeParticipant(livekitRoomName, identity);

    return res.json({ ok: true });
  } catch (e: any) {
    console.error("remove error", e);
    return res.status(500).json({ ok: false, error: e?.message || "remove_error" });
  }
});

// Remove/kick ALL participants in a room
app.post("/api/roomModeration/remove-all", requireAuth, requireRoomAccessToken as any, async (req, res) => {
  try {
    const { roomId, livekitRoomName } = getRoomAccess(req as any);

    try {
      await assertEffectiveRoomControl(req as any, roomId, "canRemoveGuests");
    } catch (err) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ ok: false, error: err.code });
      }
      throw err;
    }

    const roomService = await getRoomService();

    if (process.env.AUTH_DEBUG === "1") {
      console.log("[livekit-debug] listParticipants (remove-all)", { livekitRoomName });
    }

    const participants = await roomService.listParticipants(livekitRoomName);

    const results: Array<{ identity: string; removed: boolean; error?: string }> = [];

    for (const p of participants) {
      const identity = (p as any)?.identity;
      if (!identity) continue;
      try {
        if (process.env.AUTH_DEBUG === "1") {
          console.log("[livekit-debug] removeParticipant (remove-all)", {
            livekitRoomName,
            identity,
          });
        }

        await roomService.removeParticipant(livekitRoomName, identity);
        results.push({ identity, removed: true });
      } catch (err: any) {
        console.error("remove-all failed for participant", { livekitRoomName, identity, err });
        results.push({
          identity,
          removed: false,
          error: typeof err?.message === "string" ? err.message : "remove_participant_failed",
        });
      }
    }

    const removedCount = results.filter((r) => r.removed).length;
    return res.json({ ok: true, removedCount, results });
  } catch (e: any) {
    console.error("remove-all error", e);
    return res.status(500).json({ ok: false, error: e?.message || "remove_all_error" });
  }
});


// =============================================================================
// AUTH ENDPOINTS
// =============================================================================

// Helper function to calculate next reset date based on signup date
function calculateNextResetDate(createdAt: Date): Date {
  const now = new Date();
  const signupDay = createdAt.getDate();
  
  // Next reset is on the same day next month
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, signupDay);
  
  // If we've already passed this month's reset day, use next month
  if (now.getDate() >= signupDay) {
    return new Date(now.getFullYear(), now.getMonth() + 2, signupDay);
  }
  
  return nextMonth;
}

// Signup
app.post("/api/auth/signup", async (req, res) => {
  try {
    const {
      email,
      password,
      displayName,
      timeZone,
      skipOnboarding,
      defaultResolution,
      defaultDestinations,
      defaultPrivacy,
    } = req.body as {
      email?: string;
      password?: string;
      displayName?: string;
      timeZone?: string;
      skipOnboarding?: boolean;
      defaultResolution?: string;
      defaultDestinations?: { youtube?: boolean; facebook?: boolean, twitch?: boolean };
      defaultPrivacy?: string;
    };

    console.log("🔐 Signup request:", { email, displayName, timeZone });

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "password must be at least 6 characters" });
    }

    const existingSnap = await db
      .collection("users")
      .where("email", "==", email.trim().toLowerCase())
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      return res.status(409).json({ error: "email already in use" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date();
    const monthKey = getCurrentMonthKey();

    // =============================================================================
    // CREATE USER DOCUMENT WITH COMPLETE STRUCTURE
    // =============================================================================

    // Build userData (DO NOT store passwordHash)
const userData: any = {
  email: email.trim().toLowerCase(),
  displayName: sanitizeDisplayName(displayName).trim(),
  timeZone: timeZone || "America/Chicago",

  // Plan assignment
  planId: "free",
  plan: "free", // optional legacy fallback
  planUpdatedAt: now,

  // Social connections
  youtubeConnected: false,
  facebookConnected: false,
  twitchConnected: false,

  // Timestamps
  createdAt: now,
  updatedAt: now,

  // Onboarding
  onboardingCompleted: !skipOnboarding,

  // Billing configuration
  billing: {
    anniversaryDay: now.getDate(),
    nextResetAt: calculateNextResetDate(now),

    // ✅ overages defaults (keep here)
    overagesEnabled: false,
    billingEnabled: false,
    overageRatePerMin: 0,
  },

  // Usage metadata
  usageMeta: {
    activeMonthKey: monthKey,
    lastResetAt: now,
    ytdMinutes: 0,
  },

  admin: { isAdmin: false },

  preferences: skipOnboarding
    ? {}
    : {
        defaultResolution: defaultResolution || "720p",
        defaultDestinations: {
          youtube: defaultDestinations?.youtube ?? false,
          facebook: defaultDestinations?.facebook ?? false,
          twitch: defaultDestinations?.twitch ?? false,
        },
        defaultPrivacy: defaultPrivacy || "public",
      },
};

// Legacy fields (optional)
if (!skipOnboarding) {
  userData.defaultResolution = userData.preferences.defaultResolution;
  userData.defaultDestinations = userData.preferences.defaultDestinations;
  if (defaultPrivacy) userData.defaultPrivacy = defaultPrivacy;
}

// 1) Create Firebase Auth user (this generates UID)
const userRecord = await admin.auth().createUser({
  email: userData.email,
  password, // must be in scope
  displayName: userData.displayName,
});

const uid = userRecord.uid;

// 2) Create Firestore user doc at users/{uid}
const userRef = db.collection("users").doc(uid);

await userRef.set({
  ...userData,
  id: uid,  // optional
  uid: uid, // optional but helpful

  // ✅ optional mirror for older code that checks root
  overagesEnabled: userData.billing.overagesEnabled,
});

console.log("✅ User document created:", uid);


    // =============================================================================
    // INITIALIZE MONTHLY USAGE DOCUMENT
    // =============================================================================

    const usageData = {
      uid: userRef.id,
      monthKey,
      periodStart: now,
      periodEnd: null, // Will be set when month ends
      
      totals: {
        streamMinutes: 0,
        participantMinutes: 0,
        transcodeMinutes: 0,
        overageMinutes: 0,
      },
      
      lastSession: null,
      
      source: "server", // Mark as server-written for security
      updatedAt: now,
    };

    await db.collection("usageMonthly").doc(`${userRef.id}_${monthKey}`).set(usageData);
    console.log("✅ Monthly usage document initialized");

    // =============================================================================
    // RETURN SUCCESS RESPONSE
    // =============================================================================

    const user = {
      id: userRef.id,
      uid: userRef.id, // Include both for compatibility
      email: userData.email,
      displayName: userData.displayName,
      planId: userData.planId,
      plan: userData.plan,
      timeZone: userData.timeZone,
      onboardingCompleted: userData.onboardingCompleted,
      defaultResolution: userData.defaultResolution || null,
      defaultDestinations: userData.defaultDestinations || null,
      defaultPrivacy: userData.defaultPrivacy || null,
      youtubeConnected: userData.youtubeConnected,
      facebookConnected: userData.facebookConnected,
      createdAt: userData.createdAt.toISOString ? userData.createdAt.toISOString() : userData.createdAt,
    };

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });

    console.log("✅ Signup successful for:", email);

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    // Also return token in response for frontend fallback (non-httpOnly)
    return res.json({ user, token });
  } catch (err) {
    console.error("❌ Signup error:", err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// Login
// NOTE: /api/auth/login and /api/auth/signup are now handled exclusively by
// routes/auth.ts via app.use("/api/auth", authRoutes). The legacy inline
// implementations that signed different JWT payloads have been removed to
// ensure a single, consistent auth flow.

// =============================================================================
// USAGE TRACKING
// =============================================================================

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// NOTE: /api/usage/summary is implemented in routes/usageRoutes.ts
// and is requireAuth-protected with a stable payload.

app.post("/api/usage/streamEnded", async (req, res) => {
  try {
    const authedUid = (req as any).user?.uid as string | undefined;
    const { uid: bodyUid, minutes, guestCount } = req.body as {
      uid?: string;
      minutes?: number;
      guestCount?: number;
      transcodeMinutes?: number;
    };

    const uid = bodyUid || authedUid;
    if (!uid) {
      return res.status(400).json({ error: "uid required" });
    }

    console.log("[usage] streamEnded start", {
      authedUid,
      bodyUid,
      uid,
      minutes,
      guestCount,
      transcodeMinutes: (req.body as any)?.transcodeMinutes,
    });

    const participantMinutes = Math.max(1, Math.round(Number(minutes || 0)));
    const transcodeMinutes = Math.max(0, Math.round(Number((req.body as any)?.transcodeMinutes || 0)));
    if (!participantMinutes) {
      return res.status(400).json({ error: "minutes required" });
    }

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: "user not found" });
    }

    const userData = userSnap.data() || {};
    const usage = (userData.usage || {}) as any;
    const now = new Date();

    const durationMinutes = participantMinutes;
    const durationHours = durationMinutes / 60;

    console.log("[usage] calculated durations", {
      uid,
      participantMinutes,
      transcodeMinutes,
      durationHours,
    });

    // Handle monthly reset
    const resetDate: Date | null =
      usage.resetDate && usage.resetDate.toDate
        ? usage.resetDate.toDate()
        : null;

    if (resetDate && resetDate < now) {
      const nextReset = new Date();
      nextReset.setMonth(nextReset.getMonth() + 1);

      usage.hoursStreamedThisMonth = 0;
      usage.periodStart = now;
      usage.resetDate = nextReset;

      await userRef.update({
        "usage.hoursStreamedThisMonth": 0,
        "usage.periodStart": now,
        "usage.resetDate": nextReset,
      });
    }

    const hoursStreamedToday =
      (usage.hoursStreamedToday || 0) + durationHours;
    const hoursStreamedThisMonth =
      (usage.hoursStreamedThisMonth || 0) + durationHours;
    const ytdHours = (usage.ytdHours || 0) + durationHours;
    const guestCountToday = (usage.guestCountToday || 0) + (guestCount || 0);

    console.log("[usage] updating legacy usage", {
      uid,
      hoursStreamedToday,
      hoursStreamedThisMonth,
      ytdHours,
      guestCountToday,
    });

    await userRef.update({
      "usage.hoursStreamedToday": hoursStreamedToday,
      "usage.hoursStreamedThisMonth": hoursStreamedThisMonth,
      "usage.ytdHours": ytdHours,
      "usage.guestCountToday": guestCountToday,
      "usage.lastUsageUpdate": now,
    });

    // Also track canonical usageMonthly participant/transcode minutes
    const monthKey = getCurrentMonthKey();
    const usageDocId = `${uid}_${monthKey}`;
    const usageRef = db.collection("usageMonthly").doc(usageDocId);
    const usageSnap = await usageRef.get();
    const existing = usageSnap.exists ? (usageSnap.data() as any) : {};

    const prevUsage = existing.usage || {};
    const prevYtd = existing.ytd || {};
    const prevMinutes = prevUsage.minutes || {};
    const prevYtdMinutes = prevYtd.minutes || {};

    const nextUsage = {
      participantMinutes: Number(prevUsage.participantMinutes || 0) + durationMinutes,
      transcodeMinutes: Number(prevUsage.transcodeMinutes || 0) + transcodeMinutes,
      // Preserve any existing HLS minutes; HLS-specific updates occur in the HLS stop handler.
      hlsMinutes: Number(prevUsage.hlsMinutes || 0),
      minutes: {
        live: {
          currentPeriod: Number(prevMinutes.live?.currentPeriod || 0) + durationMinutes,
          lifetime:
            Number(
              prevMinutes.live?.lifetime ||
              prevYtdMinutes.live?.lifetime ||
              0
            ) + durationMinutes,
        },
        recording: {
          currentPeriod: Number(prevMinutes.recording?.currentPeriod || 0),
          lifetime: Number(prevMinutes.recording?.lifetime || prevYtdMinutes.recording?.lifetime || 0),
        },
      },
    };

    const nextYtd = {
      participantMinutes: Number(prevYtd.participantMinutes || 0) + durationMinutes,
      transcodeMinutes: Number(prevYtd.transcodeMinutes || 0) + transcodeMinutes,
      // Preserve any existing HLS minutes.
      hlsMinutes: Number(prevYtd.hlsMinutes || 0),
      minutes: {
        live: {
          lifetime:
            Number(prevYtdMinutes.live?.lifetime || prevMinutes.live?.lifetime || 0) + durationMinutes,
        },
        recording: {
          lifetime: Number(prevYtdMinutes.recording?.lifetime || prevMinutes.recording?.lifetime || 0),
        },
      },
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

    // Pro-only: compute and persist overage totals when the user is over limit.
    // Best-effort: do not fail streamEnded if this bookkeeping write fails.
    try {
      const entitlements = await getEffectiveEntitlements(uid);
      const decision = evaluateUsageGate({
        allowsOverages: !!(entitlements.features as any).allowsOverages,
        limits: {
          participantMinutes: Number(entitlements.limits.monthlyMinutes || 0),
          transcodeMinutes: Number(entitlements.limits.transcodeMinutes || 0),
        },
        usage: {
          participantMinutes: Number(nextUsage.participantMinutes || 0),
          transcodeMinutes: Number(nextUsage.transcodeMinutes || 0),
        },
        checkParticipant: true,
        checkTranscode: true,
      });

      if (decision.shouldLogOverages && decision.overageTotals) {
        await upsertUsageMonthlyOverageTotals({
          uid,
          monthKey,
          totals: decision.overageTotals,
        });
      }
    } catch (e) {
      console.error("[usage] failed to update overage totals", e);
    }

    console.log("[usage] updated usageMonthly", {
      uid,
      monthKey,
      usageDocId,
      nextUsage,
      nextYtd,
    });

    return res.json({
      ok: true,
      durationHours,
      hoursStreamedThisMonth,
      ytdHours,
      usageMonthly: {
        id: usageDocId,
        usage: nextUsage,
        ytd: nextYtd,
        monthKey,
      },
    });
  } catch (err) {
    console.error("[usage] streamEnded error", err);
    return res.status(500).json({ error: "internal error" });
  }
});

// =============================================================================
// SERVE FRONTEND - Must be LAST (catch-all route)
// =============================================================================

app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.originalUrl });
});



app.listen(PORT, () => {
  console.log(`✅ Server listening on http://localhost:${PORT}`);
  console.log("[config-health]", {
    env: String(process.env.NODE_ENV || "development"),
    tokenGrants: "v3-no-sources",
    hasLivekitUrl: !!process.env.LIVEKIT_URL,
    hasLivekitApiKey: !!process.env.LIVEKIT_API_KEY,
    hasLivekitApiSecret: !!process.env.LIVEKIT_API_SECRET,
    hasJwtSecret: !!process.env.JWT_SECRET,
    hasRoomAccessTokenSecret: !!process.env.ROOM_ACCESS_TOKEN_SECRET,
  });
});