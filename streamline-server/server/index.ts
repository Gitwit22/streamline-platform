import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { RoomServiceClient, TrackSource, TrackType } from "livekit-server-sdk";
import multistreamRoutes from "./routes/multistream";

import roomTokenRoute from "./routes/roomToken";

import { firestore as db, auth } from "./firebaseAdmin";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import editingRouter from "./routes/editing";


dotenv.config();


const port = process.env.PORT || 3157;

const app = express();
app.use(cors());
app.use(express.json());

// Rate limiting for API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});

app.use("/api/", apiLimiter);

// Health check
app.get("/", (_req, res) => res.send("API up"));

// Token route used by the frontend
app.use("/api/roomToken", roomTokenRoute);

// Multistream routes (YouTube/FB)
app.use("/api/rooms", multistreamRoutes);


app.use("/api/editing", editingRouter);

// -------------------------------
// Admin Controls (Host/Mod Only)
// -------------------------------
const roomService = new RoomServiceClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
);
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// Mute/unmute a participant
// Admin: mute/unmute a single participant's audio
app.post("/api/admin/mute", async (req, res) => {
  try {
    const { room, identity, muted } = req.body as {
      room?: string;
      identity?: string;
      muted?: boolean;
    };

    if (!room || !identity || typeof muted !== "boolean") {
      return res
        .status(400)
        .json({ error: "room, identity and muted are required" });
    }

    // Log for debugging
    console.log("ADMIN MUTE", { room, identity, muted });

    const participant = await roomService.getParticipant(room, identity);

    const audioTrack = participant.tracks?.find((t) => {
      const isAudioType = t.type === TrackType.AUDIO;
      const isMicSource = t.source === TrackSource.MICROPHONE;
      return isAudioType || isMicSource;
    });

    if (!audioTrack) {
      console.warn("No audio track found for", { room, identity });
      return res.status(404).json({ error: "no audio track found" });
    }

    await roomService.mutePublishedTrack(
      room,
      identity,
      audioTrack.sid,
      muted
    );

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

// Admin: mute/unmute ALL participants' audio
// Admin: mute/unmute ALL participants' audio
app.post("/api/admin/mute-all", async (req, res) => {
  try {
    const { room, muted } = req.body as {
      room?: string;
      muted?: boolean;
    };

    if (!room || typeof muted !== "boolean") {
      return res
        .status(400)
        .json({ error: "room and muted are required" });
    }

    console.log("ADMIN MUTE-ALL", { room, muted });

    const participants = await roomService.listParticipants(room);

    const results: {
      identity: string;
      trackSid: string | null;
      changed: boolean;
    }[] = [];

    for (const p of participants) {
      const audioTrack = p.tracks?.find((t) => {
        const isAudioType = t.type === TrackType.AUDIO;
        const isMicSource = t.source === TrackSource.MICROPHONE;
        return isAudioType || isMicSource;
      });

      if (!audioTrack) {
        results.push({
          identity: p.identity,
          trackSid: null,
          changed: false,
        });
        continue;
      }

      await roomService.mutePublishedTrack(
        room,
        p.identity,
        audioTrack.sid,
        muted
      );

      results.push({
        identity: p.identity,
        trackSid: audioTrack.sid,
        changed: true,
      });
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

// Remove/kick a participant
app.post("/api/admin/remove", async (req, res) => {
  try {
    const { room, identity } = req.body;
    await roomService.removeParticipant(room, identity);
    res.json({ ok: true });
  } catch (e: any) {
    console.error("remove error", e);
    res.status(500).json({ error: e.message || "remove_error" });
  }
});

// ---------- SIGNUP (with onboarding) ----------
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
      defaultDestinations?: { youtube?: boolean; facebook?: boolean };
      defaultPrivacy?: string;
    };

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    // Check if user already exists
    const existingSnap = await db
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      return res.status(409).json({ error: "email already in use" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const userData: any = {
      email,
      displayName: displayName || "",
      passwordHash,
      plan: "free",
      youtubeConnected: false,
      facebookConnected: false,
      createdAt: new Date().toISOString(),
      onboardingCompleted: !skipOnboarding,
    };

    if (timeZone) {
      userData.timeZone = timeZone;
    }

    // Only store streaming defaults if they didn't skip onboarding
    if (!skipOnboarding) {
      userData.defaultResolution = defaultResolution || "720p";
      userData.defaultDestinations = {
        youtube: defaultDestinations?.youtube ?? false,
        facebook: defaultDestinations?.facebook ?? false,
      };
      if (defaultPrivacy) {
        userData.defaultPrivacy = defaultPrivacy; // e.g. "public" | "unlisted"
      }
    }

    const userRef = await db.collection("users").add(userData);
    await userRef.update({ id: userRef.id });

    const user = {
      id: userRef.id,
      email: userData.email,
      displayName: userData.displayName,
      plan: userData.plan,
      timeZone: userData.timeZone || null,
      onboardingCompleted: userData.onboardingCompleted,
      defaultResolution: userData.defaultResolution || null,
      defaultDestinations: userData.defaultDestinations || null,
      defaultPrivacy: userData.defaultPrivacy || null,
      youtubeConnected: userData.youtubeConnected,
      facebookConnected: userData.facebookConnected,
    };

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });

    return res.json({ user, token });
  } catch (err) {
    console.error("signup error", err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// ---------- LOGIN ----------
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

    return res.json({ user, token });
  } catch (err) {
    console.error("login error", err);
    return res.status(500).json({ error: "internal server error" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/usage/summary", async (req, res) => {
  try {
    // TEMP: hardcode a test user id for now
    const uid = req.query.uid as string; // later you'll pull from auth
    if (!uid) return res.status(400).json({ error: "uid required" });

    const userRef = db.collection("users").doc(uid);

    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: "user not found" });
    }

    const userData = userSnap.data() || {};
    const usage = (userData.usage || {}) as any;
    const planId = (userData.plan as string) || "free";

    // read plan doc
const planSnap = await db.collection("plans").doc(planId).get();
    const planData = planSnap.data() || {};

    const usedHours = usage.hoursStreamedThisMonth || 0;
    const maxHours = planData.maxHoursPerMonth || 0;
    const ytdHours = usage.ytdHours || 0;
    const resetDate = usage.resetDate || null;

    return res.json({
      displayName: userData.displayName || "",
      planId,
      usedHours,
      maxHours,
      ytdHours,
      resetDate,
      maxGuests: planData.maxGuests || 0,
      multistreamEnabled: !!planData.multistreamEnabled,
    });
  } catch (err) {
    console.error("usage summary error", err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.post("/api/usage/streamEnded", async (req, res) => {
  try {
    // TEMP: we’ll pass uid from the client in the body
    const { uid, guestCount = 0 } = req.body as {
      uid?: string;
      guestCount?: number;
    };

    if (!uid) {
      return res.status(400).json({ error: "uid required" });
    }

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: "user not found" });
    }

    const userData = userSnap.data() || {};
    const usage = (userData.usage || {}) as any;

    if (!usage.lastStreamStart || !usage.lastStreamStart.toDate) {
      return res.status(400).json({ error: "lastStreamStart missing" });
    }

    const now = new Date();
    const start: Date = usage.lastStreamStart.toDate();
    const durationMs = now.getTime() - start.getTime();
    const durationHours = Math.max(durationMs / (1000 * 60 * 60), 0);

    // --- handle monthly reset if needed ---
    const resetDate: Date | null =
      usage.resetDate && usage.resetDate.toDate
        ? usage.resetDate.toDate()
        : null;

    if (resetDate && resetDate < now) {
      // new period starts now, reset monthly usage
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
    const guestCountToday = (usage.guestCountToday || 0) + guestCount;

    await userRef.update({
      "usage.hoursStreamedToday": hoursStreamedToday,
      "usage.hoursStreamedThisMonth": hoursStreamedThisMonth,
      "usage.ytdHours": ytdHours,
      "usage.guestCountToday": guestCountToday,
      "usage.lastUsageUpdate": now,
    });

    return res.json({
      ok: true,
      durationHours,
      hoursStreamedThisMonth,
      ytdHours,
    });
  } catch (err) {
    console.error("streamEnded error", err);
    return res.status(500).json({ error: "internal error" });
  }
});



const PORT = process.env.PORT || 5137; // use whatever you were using when it worked
app.listen(PORT, () => {
  console.log(`✅ API listening on http://localhost:${PORT}`);
});