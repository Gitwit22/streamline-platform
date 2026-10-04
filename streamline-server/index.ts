import "dotenv/config";
import express from "express";
import cors, { type CorsOptions } from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import webhookRouter from "./routes/webhook";
import authRoutes from "./routes/auth";
import adminRoutes from './routes/admin';
import accountRoutes from "./routes/account";
import collaboratorsRoutes from "./routes/collaborators";
import { requireAuth } from "./middleware/requireAuth";
import billingRoutes from "./routes/billing";
import recordingsRoutes from "./routes/recordings";
import usageRoutes from "./routes/usageRoutes";
import plansRoutes from "./routes/plans";
import roomsCreateRoutes from "./routes/roomsCreate";
import invitesRoutes from "./routes/invites";
import roomInvitesRoutes from "./routes/roomInvites";
import roomGuestAccessRoutes from "./routes/roomGuestAccess";
import multistreamRoutes from "./routes/multistream";
import roomsResolveRoutes from "./routes/roomsResolve";
import roomsHlsConfigRoutes from "./routes/roomsHlsConfig";
import roomsActiveEmbedRoutes from "./routes/roomsActiveEmbed";
import roomControlsRoutes, { enforceRoomControlsForRoom } from "./routes/roomControls";
import roomChatRoutes from "./routes/roomChat";
import roomsLayoutRoutes from "./routes/roomsLayout";
import roomsStudioLayoutRoutes from "./routes/roomsStudioLayout";
import roomsProgramStateRoutes from "./routes/roomsProgramState";
import roomsPolicyRoutes from "./routes/roomsPolicy";
import roomsRecordingsRoutes from "./routes/roomsRecordings";
import destinationsRoutes from "./routes/destinations";
import liveRoutes from "./routes/live";
import statsRoutes from "./routes/stats";
import telemetryRoutes from "./routes/telemetry";
import savedEmbedsRoutes from "./routes/savedEmbeds";
import editingRoutes from "./routes/editing";
import projectsRoutes from "./routes/projects";
import myContentRoutes from "./routes/myContent";
import maintenanceRoutes from "./routes/maintenance";
import onboardingRoutes from "./routes/onboarding";
import { startRecordingCleanup, stopRecordingCleanup } from "./services/recordingCleanup";
import { firestore as db } from "./firebaseAdmin";
import path from "path";
import { getLiveKitSdk } from "./lib/livekit"; // adjust path
import type { RoomServiceClient } from "livekit-server-sdk";
import { getCurrentMonthKey } from "./lib/usageTracker";
import { getEffectiveEntitlements } from "./lib/effectiveEntitlements";
import { evaluateUsageGate } from "./lib/usageOverages";
import { upsertUsageMonthlyOverageTotals } from "./lib/usageOveragesWriter";
import { billLiveStreamMinutes, LiveUsageUserNotFoundError, type LiveUsageResult } from "./lib/liveStreamUsage";
import { isLargeMinutesDiscrepancy } from "./lib/liveSessionMinutes";
import admin from "firebase-admin";
import hlsRoutes from "./routes/hls";
import publicHlsRoutes from "./routes/publicHls";
import publicRoomsHlsConfigRoutes from "./routes/publicRoomsHlsConfig";
import monetizationRoutes from "./routes/monetization";
import { resolveRoomIdentity } from "./lib/roomIdentity";
import { assertRoomPerm, RoomPermissionError } from "./lib/rolePermissions";
import { isProtectedRoomIdentity, moderationActorRole } from "./lib/roomModerationPolicy";
import { PERMISSION_ERRORS } from "./lib/permissionErrors";
import { requireRoomAccessToken, type RoomAccessClaims, getRoomAccess } from "./middleware/roomAccessToken";

import { requireAdmin } from "./middleware/adminAuth";

// Horizon / observability imports
import { logger } from "./lib/logger";
import { requestIdMiddleware } from "./middleware/requestId";
import { globalErrorHandler } from "./middleware/errorHandler";
import horizonApiRoutes from "./routes/horizonApi";
import platformHealthRoutes from "./routes/platformHealth";
import diagnosticsRoutes from "./routes/diagnostics";
import alertRoutes from "./routes/alertRoutes";
import skillsIntegrationRoutes from "./routes/skillsIntegration";
import supportActionsRoutes from "./routes/supportActions";
import supportTicketsRoutes from "./routes/supportTickets";
import supportPublicRoutes from "./routes/supportPublic";
import { attachHorizonWs } from "./routes/horizonWs";
import horizonRoomHooks from "./routes/horizon/roomHooks";
import horizonBotApi from "./routes/horizon/botApi";

import { uploadVideo } from "./lib/storageClient";


const PORT = process.env.PORT || 5137;


const app = express();

// Trust the first proxy (Render / reverse proxy) for accurate req.ip
app.set("trust proxy", 1);

// Security headers – compatibility-first configuration.
// contentSecurityPolicy is disabled to avoid breaking embeds, HLS playback,
// and cross-origin media; crossOriginEmbedderPolicy off for the same reason.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

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
    "https://supporthub.nxtlvlts.com",
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
    // Optional onboarding key for controlled self-serve onboarding
    "x-onboarding-key",
    "X-Onboarding-Key",
    // Room-level access token used by in-room APIs (HLS, multistream, controls, etc.).
    // Explicitly allow both typical header casings to satisfy browser preflight checks.
    "x-room-access-token",
    "X-Room-Access-Token",
    "x-owner-context-uid",
    "X-Owner-Context-Uid",
    // Legacy invite JWT (join links) used for guest RTC join/status without auth.
    "x-invite-token",
    "X-Invite-Token",
    // Guest session JWT (invite-scoped) used by /api/rooms/:roomId/token.
    "x-guest-session",
    "X-Guest-Session",
    // Program-scoped context headers used by Support Hub and admin APIs.
    "x-program-id",
    "X-Program-Id",
    "x-active-program-id",
    "X-Active-Program-Id",
  ],
  exposedHeaders: ["x-sl-auth-fallback", "x-sl-auth-header-invalid", "X-Request-Id"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
// Preflight
app.options(/.*/, cors(corsOptions));

// ── Observability middleware (before all routes, including webhooks) ──
// Request ID must be first so every log line / response includes it.
app.use(requestIdMiddleware);

// Structured request logging via pino-http.
// Skip noisy health-check endpoints to keep logs clean.
app.use(
  pinoHttp({
    logger,
    genReqId: (req: any) => req.id, // reuse requestId middleware value
    autoLogging: {
      ignore: (req: any) => {
        const url = req.url || "";
        return url === "/api/health" || url === "/" || url === "/api";
      },
    },
  })
);

// Stripe/Billing webhooks MUST run before JSON body parsing so Stripe
// webhook signature verification can use the raw request body.
app.use("/api/webhooks", webhookRouter);

// Body parsers for the rest of the API
// Keep the raw bytes for routes that verify HMAC signatures over the body
// (e.g. Horizon bot /events) but are mounted after this global parser.
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));
// CSRF: the session cookie is SameSite=None, so a cross-site form POST would
// carry it. For state-changing requests from a browser Origin we don't trust,
// drop the cookies before parsing so the request is treated as unauthenticated
// (Bearer-token and server-to-server callers, which send no Origin, are unaffected).
app.use((req, _res, next) => {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin && !allowedOrigins.has(normalizeOrigin(origin))) {
    delete req.headers.cookie;
  }
  next();
});
app.use(cookieParser());

// Egress compositor templates – served as static HTML so LiveKit's headless
// Chromium can load them via the customBaseUrl parameter.
app.use(
  "/egress-templates",
  express.static(path.join(process.cwd(), "public", "egress-templates"))
);

app.use("/api/auth", authRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/collaborators", collaboratorsRoutes);
app.use("/api/support/tickets", supportPublicRoutes);

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

// Monetization v1 (PPV, PWYW, Donations for HLS rooms)
app.use("/api/monetization", monetizationRoutes);

// Onboarding/reset endpoints (guarded; demo-safe)
app.use("/api/onboarding", onboardingRoutes);
// Recordings API - This handles GET /:id and POST /start, /stop
app.use("/api/recordings", recordingsRoutes);

// Editing API (authenticated)
app.use("/api/editing", editingRoutes);

// Projects API (core media workspace — independent of editing)
app.use("/api/projects", projectsRoutes);

// My Content API (SavedVideo library — Layer 1)
app.use("/api/my-content", myContentRoutes);

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
// Per-session persistent chat (roomAccessToken scoped)
app.use("/api/rooms", roomChatRoutes);
// Horizon ↔ room hooks (chat-events, voice-stream, agent chat response)
app.use("/api/rooms", horizonRoomHooks);
// Persistent room layout config (controls viewer layout; recordings inherit)
app.use("/api/rooms", roomsLayoutRoutes);
// Studio layout config (preset-based canvas composition for the program output)
app.use("/api/rooms", roomsStudioLayoutRoutes);
// Program state (shared output/compositor state; synced to LiveKit room metadata)
app.use("/api/rooms", roomsProgramStateRoutes);
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

// Reject legacy EDU/Corporate lane requests
app.use("/api/edu", (_req, res) => res.status(404).json({ error: "lane_removed" }));
app.use("/api/corp", (_req, res) => res.status(404).json({ error: "lane_removed" }));

// Billing routes
app.use("/api/billing", billingRoutes);

// Plans route (for Billing page)
app.use("/api/plans", plansRoutes);
// Public stats for landing page
app.use("/api/stats", statsRoutes);
// Lightweight telemetry events
app.use("/api/telemetry", telemetryRoutes);

// =============================================================================
// HORIZON BOT API — bot-accessible via HORIZON_WEBHOOK_SECRET bearer token
// =============================================================================
app.use("/api/horizon/bot", horizonBotApi);

// =============================================================================
// HORIZON / ADMIN MONITORING ROUTES — all admin-only
// =============================================================================
app.use("/api/horizon", requireAdmin, horizonApiRoutes);
app.use("/api/horizon/health", requireAdmin, platformHealthRoutes);
app.use("/api/horizon/diagnostics", requireAdmin, diagnosticsRoutes);
app.use("/api/horizon/alerts", requireAdmin, alertRoutes);
app.use("/api/horizon/skills", requireAdmin, skillsIntegrationRoutes);
app.use("/api/horizon/support/actions", requireAdmin, supportActionsRoutes);
app.use("/api/horizon/support/tickets", requireAdmin, supportTicketsRoutes);

// Protected config health (helps diagnose env drift across Render services)
app.get("/api/health/config", requireAdmin, (req, res) => {
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

// Room-level mute lock is persisted at rooms/{roomId}/controls/default.muteLocked
// (shared across instances and delivered to clients via the controls SSE stream).
function muteLockDocRef(roomId: string) {
  return db.collection("rooms").doc(roomId).collection("controls").doc("default");
}

async function assertEffectiveRoomControl(
  req: express.Request,
  roomId: string,
  perm: "canMuteGuests" | "canRemoveGuests",
): Promise<{ access: RoomAccessClaims; ownerUid: string | null; isHost: boolean }> {
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

  const ownerRaw = (ctx.room as any)?.ownerId;
  const ownerUid = typeof ownerRaw === "string" && ownerRaw.trim() ? ownerRaw.trim() : null;
  return { access, ownerUid, isHost: moderationActorRole(role) === "host" };
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

    let control: Awaited<ReturnType<typeof assertEffectiveRoomControl>>;
    try {
      control = await assertEffectiveRoomControl(req as any, roomId, "canMuteGuests");
    } catch (err) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ error: err.code });
      }
      throw err;
    }

    // Cohosts can't mute the owner / producers.
    if (!control.isHost && isProtectedRoomIdentity(String(identity), control.ownerUid)) {
      return res.status(403).json({ error: "cannot_moderate_host" });
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
    const { muted, hostIdentity } = req.body as { room?: string; muted?: boolean; hostIdentity?: string };

    if (typeof muted !== "boolean") {
      return res.status(400).json({ error: "muted is required" });
    }

    const { access, roomId, livekitRoomName } = getRoomAccess(req as any);

    let control: Awaited<ReturnType<typeof assertEffectiveRoomControl>>;
    try {
      control = await assertEffectiveRoomControl(req as any, roomId, "canMuteGuests");
    } catch (err) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ error: err.code });
      }
      throw err;
    }

    // Like mute-lock: never mute the caller, the room owner or producers.
    // hostIdentity from the body is honored only for hosts (a cohost can't use
    // it to exempt someone else).
    const skipIdentities: Array<string | null | undefined> = [
      access.identity,
      control.isHost && typeof hostIdentity === "string" ? hostIdentity : null,
    ];

    console.log("ADMIN MUTE-ALL", { roomId, livekitRoomName, muted });

    const roomService = await getRoomService();
    const sdk = (await getLiveKitSdk()) as any;
    const TrackType = sdk.TrackType;
    const TrackSource = sdk.TrackSource;

    if (process.env.AUTH_DEBUG === "1") {
      console.log("[livekit-debug] listParticipants (mute-all)", { livekitRoomName });
    }

    const participants = await roomService.listParticipants(livekitRoomName);
    const results: Array<{ identity: string; trackSid: string | null; changed: boolean; skipped?: "protected" }> = [];

    for (const p of participants) {
      if (isProtectedRoomIdentity(String(p.identity || ""), control.ownerUid, skipIdentities)) {
        results.push({ identity: p.identity, trackSid: null, changed: false, skipped: "protected" });
        continue;
      }
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

// Room-level mute lock (persisted in Firestore) + LiveKit permissions update (host tools)
app.post("/api/roomModeration/mute-lock", requireAuth, requireRoomAccessToken as any, async (req, res) => {
  try {
    const { muteLock, hostIdentity } = req.body as {
      room?: string;
      muteLock?: boolean;
      hostIdentity?: string;
    };

    if (typeof muteLock !== "boolean") {
      return res.status(400).json({ error: "muteLock is required" });
    }

    const { access, roomId, livekitRoomName } = getRoomAccess(req as any);

    try {
      await assertEffectiveRoomControl(req as any, roomId, "canMuteGuests");
    } catch (err) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ error: err.code });
      }
      throw err;
    }

    // Persist by canonical roomId (shared across server instances). Writing to
    // the default controls doc also pushes `muteLocked` to every participant's
    // controls SSE stream so clients can disable their mic toggle immediately.
    await muteLockDocRef(roomId).set(
      {
        muteLocked: muteLock,
        muteLockUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        muteLockUpdatedBy: (req as any).user?.uid || null,
      },
      { merge: true },
    );
    console.log("ROOM MODERATION MUTE-LOCK", { roomId, livekitRoomName, muteLock, hostIdentity });

    // Update LiveKit participant permissions so guests can't re-enable their
    // mic. Permissions are recomputed from each participant's base permission
    // (numeric TrackSource enums, as read from listParticipants) plus the
    // current room controls, so unlocking never re-grants audio to someone the
    // host individually force-muted. Hosts/producers are never restricted.
    let enforcement: { applied: number; skipped: number } | null = null;
    try {
      enforcement = await enforceRoomControlsForRoom({
        roomId,
        livekitRoomName,
        skipIdentities: [access.identity, hostIdentity],
      });
    } catch (permErr) {
      // Don't fail the whole request if permissions update has issues; just log
      console.error("mute-lock permissions update error", permErr);
    }

    return res.json({ ok: true, muteLock, roomId, enforcement });
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

// Public room settings (currently only muteLock).
// Accepts the canonical roomId (path param or ?roomId=); a LiveKit/display
// room name is resolved to its roomId for backwards compatibility.
app.get("/api/roomSettings/:room", async (req, res) => {
  const roomParam = String((req.query as any)?.roomId || req.params.room || "").trim();
  if (!roomParam) {
    return res.status(400).json({ error: "room is required" });
  }
  if (roomParam.includes("/") || roomParam.length > 256) {
    return res.status(400).json({ error: "invalid_room" });
  }
  try {
    let roomId = roomParam;
    let snap = await muteLockDocRef(roomId).get();
    if (!snap.exists) {
      const roomDoc = await db.collection("rooms").doc(roomParam).get();
      if (!roomDoc.exists) {
        const resolved = await resolveRoomIdentity({ roomName: roomParam });
        if (resolved?.roomId) {
          roomId = resolved.roomId;
          snap = await muteLockDocRef(roomId).get();
        }
      }
    }
    const muteLock = snap.exists ? (snap.data() as any)?.muteLocked === true : false;
    return res.json({ muteLock, roomId });
  } catch (err: any) {
    console.warn("[roomSettings] lookup failed", { room: roomParam, err: err?.message });
    return res.json({ muteLock: false });
  }
});

// Remove/kick a participant
app.post("/api/roomModeration/remove", requireAuth, requireRoomAccessToken as any, async (req, res) => {
  try {
    const { identity } = req.body;

    if (!identity) {
      return res.status(400).json({ ok: false, error: "identity is required" });
    }

    const { roomId, livekitRoomName } = getRoomAccess(req as any);

    let control: Awaited<ReturnType<typeof assertEffectiveRoomControl>>;
    try {
      control = await assertEffectiveRoomControl(req as any, roomId, "canRemoveGuests");
    } catch (err) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ ok: false, error: err.code });
      }
      throw err;
    }

    // Cohosts can't remove the owner / producers.
    if (!control.isHost && isProtectedRoomIdentity(String(identity), control.ownerUid)) {
      return res.status(403).json({ ok: false, error: "cannot_moderate_host" });
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
      const control = await assertEffectiveRoomControl(req as any, roomId, "canRemoveGuests");
      // Remove-all kicks the owner too and ends the room: host only.
      if (!control.isHost) {
        throw new RoomPermissionError(403, PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS);
      }
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

    // Mark the room as "ended" so guests see "session has ended" instead of
    // "room has not started yet".  The host is the only caller of remove-all
    // (requires canRemoveGuests), so this is always the right lifecycle transition.
    try {
      await db.collection("rooms").doc(roomId).set(
        {
          status: "ended",
          endedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (statusErr) {
      // Best-effort — don't fail the kick operation if status update fails
      console.warn("[remove-all] failed to set room status=ended", { roomId, err: (statusErr as any)?.message });
    }

    return res.json({ ok: true, removedCount, results });
  } catch (e: any) {
    console.error("remove-all error", e);
    return res.status(500).json({ ok: false, error: e?.message || "remove_all_error" });
  }
});


// =============================================================================
// AUTH ENDPOINTS
// =============================================================================

// NOTE: /api/auth/login, /api/auth/signup, and /api/auth/legacy-login are
// handled exclusively by routes/auth.ts via app.use("/api/auth", authRoutes).
// The legacy inline signup that created Firebase Auth users without storing
// passwordHash in Firestore has been removed to prevent auth drift.

// =============================================================================
// USAGE TRACKING
// =============================================================================

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// NOTE: /api/usage/summary is implemented in routes/usageRoutes.ts
// and is requireAuth-protected with a stable payload.

// Live usage minutes are computed SERVER-SIDE from egressSessions start/end
// timestamps (see lib/liveStreamUsage.ts). Client-supplied `minutes` /
// `transcodeMinutes` are ignored for billing (logged only on large drift).
// Transcode minutes are billed per egress by stop-multistream / egress_ended.
app.post("/api/usage/streamEnded", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).user?.uid as string | undefined;
    if (!uid) {
      return res.status(401).json({ error: "authentication required" });
    }

    const body = (req.body || {}) as {
      roomId?: unknown;
      minutes?: unknown;
      guestCount?: unknown;
      transcodeMinutes?: unknown;
    };
    const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
    if (!roomId) {
      return res.status(400).json({ error: "roomId required" });
    }

    // Caller must own the room, be an admin, or be a delegated producer with
    // destination (streaming) permission — same gate as start/stop-multistream.
    let ownerUid: string;
    try {
      const ctx = await assertRoomPerm(req as any, roomId, "canDestinations");
      ownerUid = String((ctx.room as any)?.ownerId || "").trim() || uid;
    } catch (err) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ error: err.code });
      }
      throw err;
    }

    let result: LiveUsageResult;
    try {
      result = await billLiveStreamMinutes({
        db,
        ownerUid,
        roomId,
        guestCount: Number(body.guestCount || 0),
      });
    } catch (err) {
      if (err instanceof LiveUsageUserNotFoundError) {
        return res.status(404).json({ error: "user not found" });
      }
      throw err;
    }

    if (isLargeMinutesDiscrepancy(body.minutes, result.minutes)) {
      console.warn("[usage] streamEnded client/server minutes discrepancy", {
        uid,
        ownerUid,
        roomId,
        clientMinutes: body.minutes,
        clientTranscodeMinutes: body.transcodeMinutes,
        serverMinutes: result.minutes,
      });
    }

    console.log("[usage] streamEnded server-computed", {
      uid,
      ownerUid,
      roomId,
      minutes: result.minutes,
      sessionsCounted: result.sessionsCounted.map((s) => s.id),
      skipped: result.skipped,
    });

    // Pro-only: compute and persist overage totals when the user is over limit.
    // Best-effort: do not fail streamEnded if this bookkeeping write fails.
    if (result.minutes > 0 && result.totals) {
      try {
        const entitlements = await getEffectiveEntitlements(ownerUid);
        const decision = evaluateUsageGate({
          allowsOverages: !!(entitlements.features as any).allowsOverages,
          limits: {
            participantMinutes: Number(entitlements.limits.monthlyMinutes || 0),
            transcodeMinutes: Number(entitlements.limits.transcodeMinutes || 0),
          },
          usage: {
            participantMinutes: Number(result.totals.participantMinutes || 0),
            transcodeMinutes: Number(result.totals.transcodeMinutes || 0),
          },
          checkParticipant: true,
          checkTranscode: true,
        });

        if (decision.shouldLogOverages && decision.overageTotals) {
          await upsertUsageMonthlyOverageTotals({
            uid: ownerUid,
            monthKey: result.monthKey,
            totals: decision.overageTotals,
          });
        }
      } catch (e) {
        console.error("[usage] failed to update overage totals", e);
      }
    }

    return res.json({
      ok: true,
      serverComputed: true,
      minutes: result.minutes,
      durationHours: result.minutes / 60,
      sessionsCounted: result.sessionsCounted.length,
      alreadyCounted: result.minutes === 0 && result.skipped.some((s) => s.reason === "already_counted"),
      hoursStreamedThisMonth: result.totals?.hoursStreamedThisMonth ?? null,
      ytdHours: result.totals?.ytdHours ?? null,
      usageMonthly: {
        id: result.usageDocId,
        monthKey: result.monthKey,
        totals: result.totals,
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

// =============================================================================
// GLOBAL ERROR HANDLER — must be registered after all routes
// =============================================================================
app.use(globalErrorHandler);

// =============================================================================
// SERVER STARTUP + GRACEFUL SHUTDOWN
// =============================================================================

const server = app.listen(PORT, () => {
  logger.info(
    {
      port: PORT,
      env: String(process.env.NODE_ENV || "development"),
      tokenGrants: "v3-no-sources",
      hasLivekitUrl: !!process.env.LIVEKIT_URL,
      hasLivekitApiKey: !!process.env.LIVEKIT_API_KEY,
      hasLivekitApiSecret: !!process.env.LIVEKIT_API_SECRET,
      hasJwtSecret: !!process.env.JWT_SECRET,
      hasRoomAccessTokenSecret: !!process.env.ROOM_ACCESS_TOKEN_SECRET,
    },
    `Server listening on http://localhost:${PORT}`
  );

  // Start the export render worker (background Firestore poller).
  // Set EXPORT_WORKER_ENABLED=0 to disable on instances that should not render.
  const workerEnabled = String(process.env.EXPORT_WORKER_ENABLED ?? "1").trim();
  if (workerEnabled !== "0" && workerEnabled.toLowerCase() !== "false") {
    import("./lib/renderWorker.js").then(({ startExportWorker }) => {
      startExportWorker();
    }).catch((err) => {
      logger.warn({ err: (err as any)?.message }, "Export worker failed to start (non-fatal)");
    });
  }

  // Start the recording retention cleanup service (runs every hour).
  // Deletes recordings older than 24 hours from R2 and Firestore.
  // Set RECORDING_CLEANUP_DRY_RUN=1 to preview deletions without actually removing files.
  startRecordingCleanup();
});

// Attach Horizon WebSocket (authenticated admin-only WS)
const horizonWss = attachHorizonWs(server);

// =============================================================================
// PROCESS-LEVEL HANDLERS
// =============================================================================

process.on("unhandledRejection", (reason: unknown) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err: Error) => {
  logger.fatal({ err }, "Uncaught exception — exiting");
  // Flush logs then exit.  pino is sync-by-default to stdout, so a short
  // timeout is sufficient to let any async transport finish.
  setTimeout(() => process.exit(1), 500);
});

let shuttingDown = false;

function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Received shutdown signal — closing server");

  // Stop background work so nothing new starts while connections drain.
  stopRecordingCleanup();
  import("./lib/renderWorker.js")
    .then(({ stopExportWorker }) => stopExportWorker())
    .catch((err) => {
      logger.warn({ err: (err as any)?.message }, "Export worker stop failed (non-fatal)");
    });

  // Close Horizon WebSocket clients; open sockets would otherwise keep
  // server.close() from completing.
  for (const client of horizonWss.clients) {
    try {
      client.close(1001, "Server shutting down");
    } catch {
      client.terminate();
    }
  }
  horizonWss.close();

  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
  // Force exit if server hasn't closed in 10 s
  setTimeout(() => {
    logger.warn("Forcing exit after shutdown timeout");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));