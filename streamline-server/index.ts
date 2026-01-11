import "dotenv/config";
import express from "express";
import cors from "cors";
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
import multistreamRoutes from "./routes/multistream";
import destinationsRoutes from "./routes/destinations";
import liveRoutes from "./routes/live";
import statsRoutes from "./routes/stats";
import { firestore as db } from "./firebaseAdmin";
import path from "path";
import { getLiveKitSdk } from "./lib/livekit"; // adjust path
import type { RoomServiceClient } from "livekit-server-sdk";
import { getCurrentMonthKey } from "./lib/usageTracker";
import admin from "firebase-admin";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";



import { uploadVideo } from "./lib/storageClient";


console.log("CLIENT_URL:", process.env.CLIENT_URL);

const PORT = process.env.PORT || 5137;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";


const app = express();

// Allow primary client plus local dev hosts for testing/incognito shares
const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.CLIENT_URL_2,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
].filter(Boolean) as string[];



app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","Cache-Control"],
}));





// Body parsers must come before any routes that need req.body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Stripe/Billing webhooks
app.use("/api/webhooks", webhookRouter);
app.use("/api/auth", authRoutes);
app.use("/api/account", accountRoutes);

// Admin routes
app.use("/api/admin", adminRoutes);


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
      "/api/admin"
    ]
  });
});



// Recordings API - This handles GET /:id and POST /start, /stop
app.use("/api/recordings", recordingsRoutes);

// Health check
app.get("/", (_req, res) => res.send("API up"));
app.use("/api/usage", usageRoutes); // gives /api/usage/summary

// =============================================================================
// API ROUTES - Order matters! More specific routes first
// =============================================================================

// Token route used by the frontend
app.use("/api/roomToken", roomTokenRoute);

// Multistream routes (YouTube/FB/Twitch)
app.use("/api/rooms", multistreamRoutes);
// Destinations management (encrypted keys)
app.use("/api/destinations", destinationsRoutes);
// Live preflight
app.use("/api/live", liveRoutes);

// Billing routes
app.use("/api/billing", billingRoutes);

// Plans route (for Billing page)
app.use("/api/plans", plansRoutes);
// Public stats for landing page
app.use("/api/stats", statsRoutes);


// Storage test route
app.get("/api/storage/test", async (req, res) => {
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

// Mute/unmute a single participant's audio (host/mod tools, not platform admin)
app.post("/api/roomModeration/mute", requireAuth, async (req, res) => {
  try {
    const { room, identity, muted } = req.body as {
      room?: string;
      identity?: string;
      muted?: boolean;
    };

    if (!room || !identity || typeof muted !== "boolean") {
      return res.status(400).json({ error: "room, identity and muted are required" });
    }

    console.log("ADMIN MUTE", { room, identity, muted });

    const roomService = await getRoomService();
    const sdk = (await getLiveKitSdk()) as any;
    const TrackType = sdk.TrackType;
    const TrackSource = sdk.TrackSource;

    const participant = await roomService.getParticipant(room, identity);
    const audioTrack = participant.tracks?.find((t: any) => {
      const isAudioType = t.type === TrackType.AUDIO;
      const isMicSource = t.source === TrackSource.MICROPHONE;
      return isAudioType || isMicSource;
    });

    if (!audioTrack) {
      console.warn("No audio track found for", { room, identity });
      return res.status(404).json({ error: "no audio track found" });
    }

    await roomService.mutePublishedTrack(room, identity, audioTrack.sid, muted);

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

// Mute/unmute ALL participants' audio
app.post("/api/roomModeration/mute-all", requireAuth, async (req, res) => {
  try {
    const { room, muted } = req.body as { room?: string; muted?: boolean };

    if (!room || typeof muted !== "boolean") {
      return res.status(400).json({ error: "room and muted are required" });
    }

    console.log("ADMIN MUTE-ALL", { room, muted });

    const roomService = await getRoomService();
    const sdk = (await getLiveKitSdk()) as any;
    const TrackType = sdk.TrackType;
    const TrackSource = sdk.TrackSource;

    const participants = await roomService.listParticipants(room);
    const results: Array<{ identity: string; trackSid: string | null; changed: boolean }> = [];

    for (const p of participants) {
      const audioTrack = p.tracks?.find((t: any) => {
        const isAudioType = t.type === TrackType.AUDIO;
        const isMicSource = t.source === TrackSource.MICROPHONE;
        return isAudioType || isMicSource;
      });

      if (!audioTrack) {
        results.push({ identity: p.identity, trackSid: null, changed: false });
        continue;
      }

      await roomService.mutePublishedTrack(room, p.identity, audioTrack.sid, muted);
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

// Room-level mute lock flag (in-memory) + LiveKit permissions update
app.post("/api/roomModeration/mute-lock", requireAuth, async (req, res) => {
  try {
    const { room, muteLock, hostIdentity } = req.body as {
      room?: string;
      muteLock?: boolean;
      hostIdentity?: string;
    };

    if (!room || typeof muteLock !== "boolean") {
      return res.status(400).json({ error: "room and muteLock are required" });
    }

    roomMuteLocks.set(room, muteLock);
    console.log("ROOM MODERATION MUTE-LOCK", { room, muteLock, hostIdentity });

    // Update LiveKit participant permissions so guests can't re-enable mic
    try {
      const roomService = await getRoomService();
      const sdk = (await getLiveKitSdk()) as any;
      const TrackSource = sdk.TrackSource;

      const participants = await roomService.listParticipants(room);

      for (const p of participants) {
        if (hostIdentity && p.identity === hostIdentity) continue; // never restrict host

        const currentPerms: any = (p as any).permission || {};
        const currentSources: any[] = currentPerms.canPublishSources || [];

        if (muteLock) {
          // Remove audio-related publish sources (mic + screen share audio)
          const blocked = new Set([TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE_AUDIO]);
          const nextSources = currentSources.filter((s) => !blocked.has(s));

          await roomService.updateParticipant(room, p.identity, {
            permission: {
              ...currentPerms,
              canPublishSources: nextSources,
            },
          });
        } else {
          // Restore audio publish ability while preserving any existing sources
          const toEnsure = [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE_AUDIO];
          const merged = Array.from(new Set([...currentSources, ...toEnsure]));

          await roomService.updateParticipant(room, p.identity, {
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
app.post("/api/roomModeration/remove", requireAuth, async (req, res) => {
  try {
    const { room, identity } = req.body;

    if (!room || !identity) {
      return res.status(400).json({ ok: false, error: "room and identity are required" });
    }

    const roomService = await getRoomService(); // or getRoomServiceClient()
    await roomService.removeParticipant(room, identity);

    return res.json({ ok: true });
  } catch (e: any) {
    console.error("remove error", e);
    return res.status(500).json({ ok: false, error: e?.message || "remove_error" });
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
  displayName: displayName?.trim() || "",
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
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const snap = await db
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(401).json({ error: "invalid email or password" });
    }

    const doc = snap.docs[0];
    const data = doc.data() as any;

    const ok = await bcrypt.compare(password, data.passwordHash || "");
    if (!ok) {
      return res.status(401).json({ error: "invalid email or password" });
    }

    const user = {
      id: doc.id,
      email: data.email,
      displayName: data.displayName || "",
      plan: data.plan || "free",
      timeZone: data.timeZone || null,
      onboardingCompleted: data.onboardingCompleted ?? false,
      defaultResolution: data.defaultResolution || null,
      defaultDestinations: data.defaultDestinations || null,
      defaultPrivacy: data.defaultPrivacy || null,
      youtubeConnected: data.youtubeConnected || false,
      facebookConnected: data.facebookConnected || false,
    };

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    // Also return token in response for frontend fallback (non-httpOnly)
    return res.json({ user, token });
  } catch (err) {
    console.error("login error", err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// =============================================================================
// USAGE TRACKING
// =============================================================================

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/usage/summary", async (req, res) => {
  try {
    const uid = req.query.uid as string;
    if (!uid) return res.status(400).json({ error: "uid required" });

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: "user not found" });
    }

    const userData = userSnap.data() || {};
    const usage = (userData.usage || {}) as any;

    return res.json({
      hoursStreamedToday: usage.hoursStreamedToday || 0,
      hoursStreamedThisMonth: usage.hoursStreamedThisMonth || 0,
      ytdHours: usage.ytdHours || 0,
      guestCountToday: usage.guestCountToday || 0,
      periodStart: usage.periodStart ? usage.periodStart.toDate() : null,
      resetDate: usage.resetDate ? usage.resetDate.toDate() : null,
    });
  } catch (err) {
    console.error("usage summary error", err);
    return res.status(500).json({ error: "internal server error" });
  }
});

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
});