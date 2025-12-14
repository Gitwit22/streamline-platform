import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { RoomServiceClient, TrackSource, TrackType } from "livekit-server-sdk";
import multistreamRoutes from "./routes/multistream";

import roomTokenRoute from "./routes/roomToken";

import { firestore as db, auth } from "./firebaseAdmin";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import editingRouter from "./routes/editing";
import { addUsageForUser, getUserUsage } from "./usageHelper";
import { uploadVideo } from "./lib/storageClient";


dotenv.config();


const PORT = process.env.PORT || 5137;

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/", (_req, res) => res.send("API up"));

// Token route used by the frontend
app.use("/api/roomToken", roomTokenRoute);

// Multistream routes (YouTube/FB)
app.use("/api/rooms", multistreamRoutes);

// Editing routes (disabled - returns HTTP 410)
app.use("/api/editing", editingRouter);

// ✅ PROMPT #1: Storage test route
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

// GET /api/usage/me - Get current user's usage (authenticated)
app.get("/api/usage/me", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const userId = decoded.id;

    if (!userId) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const usageData = await getUserUsage(userId);
    return res.json(usageData);
  } catch (err) {
    console.error("usage/me error", err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.post("/api/usage/streamEnded", async (req, res) => {
  try {
    // TEMP: we'll pass uid from the client in the body
    const { uid, minutes = 0, guestCount = 0 } = req.body as {
      uid?: string;
      minutes?: number;
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
    const now = new Date();

    // Use minutes from client (at least 1 minute)
    const durationMinutes = Math.max(1, minutes || 0);
    const durationHours = durationMinutes / 60;

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

// ============================================================================
// WEBHOOK: LiveKit Egress Completed
// ============================================================================
app.post("/api/webhook/egress", async (req, res) => {
  try {
    const event = req.body;
    console.log("📹 Egress webhook received:", event);

    // Check if egress finished successfully
    if (event.event === "egress_finished" && event.egress?.fileOutputs) {
      const fileOutputs = event.egress.fileOutputs;
      
      for (const file of fileOutputs) {
        if (file.fileKey) {
          // The file has been saved to S3/R2
          const recordingId = event.egress.roomName;
          const userId = event.egress.metadata;

          if (recordingId && userId) {
            // Update recording status to "ready"
            await db.collection("recordings").doc(recordingId).update({
              status: "ready",
              videoUrl: `${process.env.R2_ENDPOINT}/${process.env.R2_BUCKET_NAME}/${file.fileKey}`,
              egressId: event.egress.egressId,
              completedAt: new Date().toISOString(),
            });

            console.log(`✅ Recording ${recordingId} ready at ${file.fileKey}`);
          }
        }
      }
    }

    // Acknowledge receipt
    res.json({ ok: true });
  } catch (err) {
    console.error("Egress webhook error:", err);
    res.status(500).json({ error: "Webhook processing error" });
  }
});

// ============================================================================
// ENDPOINT: Save Recording to Firestore
// ============================================================================
app.post("/api/recordings/save", async (req, res) => {
  try {
    const { roomName, title, duration, viewerCount, peakViewers, userId } = req.body;

    if (!roomName || !userId) {
      return res.status(400).json({ error: "roomName and userId are required" });
    }

    const recordingRef = await db.collection("recordings").add({
      roomName,
      title: title || `Stream - ${new Date().toLocaleString()}`,
      userId,
      status: "ready",
      duration: duration || 0,
      viewerCount: viewerCount || 0,
      peakViewers: peakViewers || 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    console.log("✅ Recording created and marked ready:", recordingRef.id);

    res.json({ 
      id: recordingRef.id,
      status: "ready",
      message: "Recording saved and ready to edit!"
    });
  } catch (err) {
    console.error("Save recording error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// ENDPOINT: Get Recording Download URL
// ============================================================================
app.get("/api/recordings/:recordingId/download", async (req, res) => {
  try {
    const { recordingId } = req.params;
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    // Get recording document
    const recordingSnap = await db.collection("recordings").doc(recordingId).get();

    if (!recordingSnap.exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const recordingData = recordingSnap.data() as any;

    // Verify ownership if authenticated
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        const userId = decoded.id;

        if (recordingData.userId !== userId) {
          return res.status(403).json({ error: "Unauthorized" });
        }
      } catch (err) {
        // Invalid token, continue without auth check
      }
    }

    // Check if recording is ready
    if (recordingData.status !== "ready" || !recordingData.videoUrl) {
      return res.status(400).json({ 
        error: "Recording not ready for download",
        status: recordingData.status,
        message: "Please wait for processing to complete"
      });
    }

    // Return download URL
    res.json({
      id: recordingId,
      title: recordingData.title,
      videoUrl: recordingData.videoUrl,
      duration: recordingData.duration,
      fileSize: recordingData.fileSize || null,
      status: recordingData.status,
    });
  } catch (err) {
    console.error("Recording download error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// ENDPOINT: Delete Recording
// ============================================================================
app.delete("/api/recordings/:recordingId", async (req, res) => {
  try {
    const { recordingId } = req.params;
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Verify ownership
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const userId = decoded.id;

    const recordingSnap = await db.collection("recordings").doc(recordingId).get();

    if (!recordingSnap.exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const recordingData = recordingSnap.data() as any;

    if (recordingData.userId !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Delete from Firestore
    await db.collection("recordings").doc(recordingId).delete();

    // TODO: Delete video file from S3/R2 storage
    // if (recordingData.videoUrl) {
    //   const fileKey = recordingData.videoUrl.split('/').pop();
    //   await deleteVideo(fileKey);
    // }

    res.json({ 
      id: recordingId,
      deleted: true,
      message: "Recording deleted successfully"
    });
  } catch (err) {
    console.error("Delete recording error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Serve React app for all routes that don't match /api
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "../dist/index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Server listening on http://localhost:${PORT}`);
});
