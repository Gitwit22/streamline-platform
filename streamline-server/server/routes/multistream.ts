// server/routes/multistream.ts
import express from "express";
import { 
  EgressClient, 
  StreamOutput, 
  StreamProtocol,
  EncodingOptionsPreset,
  EgressInfo
} from "livekit-server-sdk";
import { firestore } from "../firebaseAdmin";
import { addUsageForUser } from "../usageHelper";
import { generateRecordingPath, getSignedDownloadUrl } from "../lib/storageClient";

const router = express.Router();

// Initialize the egress client
const egressClient = new EgressClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
);

// Keep track of active egress + stream metadata per room
interface ActiveStream {
  egressId: string;
  userId: string;
  roomName: string;
  startedAt: Date;
  guestCount?: number;
}

const activeStreams = new Map<string, ActiveStream>();

// =============================================================================
// START MULTISTREAM
// =============================================================================

router.post("/:roomName/start-multistream", async (req, res) => {
  const { roomName } = req.params;

  const {
    youtubeStreamKey,
    facebookStreamKey,
    twitchStreamKey,
    userId,
    guestCount = 0,
  } = req.body as {
    youtubeStreamKey?: string;
    facebookStreamKey?: string;
    twitchStreamKey?: string;
    userId?: string;
    guestCount?: number;
  };

  console.log('🎬 Multistream request:', { 
    roomName, 
    userId, 
    hasYoutube: !!youtubeStreamKey, 
    hasFacebook: !!facebookStreamKey, 
    hasTwitch: !!twitchStreamKey 
  });

  if (!roomName) {
    return res.status(400).json({
      success: false,
      error: "roomName is required",
    });
  }

  // For MVP, userId is optional - use fallback if not provided
  const finalUserId = userId || `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Build RTMP URLs for each platform
  const urls: string[] = [];

  if (youtubeStreamKey) {
    urls.push(`rtmp://a.rtmp.youtube.com/live2/${youtubeStreamKey}`);
    console.log("   ✅ YouTube URL added");
  }

  if (facebookStreamKey) {
    // Facebook requires RTMPS (secure) on port 443
    let cleanKey = facebookStreamKey;
    if (facebookStreamKey.includes("rtmps://") || facebookStreamKey.includes("rtmp://")) {
      const parts = facebookStreamKey.split("/");
      cleanKey = parts[parts.length - 1];
    }
    const fbUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${cleanKey}`;
    console.log('   ✅ Facebook URL added');
    urls.push(fbUrl);
  }

  if (twitchStreamKey) {
    urls.push(`rtmp://live.twitch.tv/app/${twitchStreamKey}`);
    console.log("   ✅ Twitch URL added");
  }

  if (urls.length === 0) {
    return res.status(400).json({
      success: false,
      error: "At least one stream key (YouTube, Facebook, Twitch) is required",
    });
  }

  try {
    console.log(`📡 Starting multistream for room: ${roomName}`);
    console.log(`   Streaming to ${urls.length} platform(s)`);

    // Create RTMP stream output
    const streamOutput = new StreamOutput({
      protocol: StreamProtocol.RTMP,
      urls,
    });

    // Start Room Composite egress
    const response: EgressInfo = await egressClient.startRoomCompositeEgress(
      roomName,
      {
        stream: streamOutput,
      },
      {
        layout: "grid",
        encodingOptions: EncodingOptionsPreset.H264_1080P_30,
      }
    );

    console.log('✅ Egress API call completed');
    console.log('   Response:', JSON.stringify(response, null, 2));

    // BULLETPROOF: Extract egressId with fallbacks
    // The response is EgressInfo which has egressId directly
    const egressId =
      response?.egressId ||
      (response as any)?.info?.egressId;

    if (!egressId) {
      console.error("❌ No egressId in response!");
      console.error("   Response structure:", Object.keys(response || {}));
      
      return res.status(500).json({
        success: false,
        error: "Egress started but no egressId returned by LiveKit.",
        details: {
          responseKeys: Object.keys(response || {}),
          fullResponse: process.env.NODE_ENV === "development" ? response : undefined,
        },
      });
    }

    console.log('✅ Egress ID extracted:', egressId);

    // Track the active stream with metadata
    activeStreams.set(roomName, {
      egressId,
      userId: finalUserId,
      roomName,
      startedAt: new Date(),
      guestCount,
    });

    // Also store in Firestore for persistence
    await firestore.collection("activeStreams").doc(roomName).set(
      {
        egressId,
        userId: finalUserId,
        roomName,
        startedAt: new Date(),
        guestCount,
      },
      { merge: true }
    );

    console.log('✅ Stream tracked in memory and Firestore');

    // BULLETPROOF: Consistent response shape with required fields
    return res.status(200).json({
      success: true,
      data: {
        egressId,
        status: response?.status || "started",
        roomName,
        outputs: {
          youtube: !!youtubeStreamKey,
          twitch: !!twitchStreamKey,
          facebook: !!facebookStreamKey,
        },
      },
    });

  } catch (err: any) {
    console.error("❌ Error starting multistream:", {
      error: err?.message,
      stack: err?.stack,
      roomName,
      urlCount: urls.length,
    });
    
    // BULLETPROOF: Always return JSON
    return res.status(500).json({
      success: false,
      error: "Failed to start multistream",
      details: err?.message,
    });
  }
});

// =============================================================================
// STOP MULTISTREAM
// =============================================================================

router.post("/:roomName/stop-multistream", async (req, res) => {
  const { roomName } = req.params;
  const { egressId } = req.body;

  console.log('⏹️ Stop multistream request:', { roomName, egressId });

  if (!roomName) {
    return res.status(400).json({
      success: false,
      error: "roomName is required",
    });
  }

  let targetEgressId = egressId;
  let activeStream = activeStreams.get(roomName);

  // Fallback: if no egressId provided, use the one from activeStreams
  if (!targetEgressId && activeStream) {
    targetEgressId = activeStream.egressId;
  }

  if (!targetEgressId) {
    return res.status(400).json({
      success: false,
      error: "egressId is required or no active stream for this room",
    });
  }

  try {
    // Stop the egress
    console.log('🛑 Stopping egress:', targetEgressId);
    await egressClient.stopEgress(targetEgressId);
    console.log('✅ Egress stopped successfully');

    // Clean up tracking
    activeStreams.delete(roomName);
    try {
      await firestore.collection("activeStreams").doc(roomName).delete();
    } catch (cleanupErr) {
      console.warn("Failed to cleanup activeStreams doc:", cleanupErr);
    }

    // If we have activeStream metadata, process post-stream tasks
    let recordingId: string | null = null;
    let videoUrl: string | null = null;
    let durationSeconds = 0;
    let durationMinutes = 0;

    if (activeStream && targetEgressId === activeStream.egressId) {
      // Calculate stream duration
      const now = new Date();
      const durationMs = now.getTime() - activeStream.startedAt.getTime();
      durationSeconds = Math.floor(durationMs / 1000);
      durationMinutes = Math.ceil(durationMs / 60000);

      console.log('⏱️ Stream duration:', durationMinutes, 'minutes');

      // Add usage for this stream
      try {
        await addUsageForUser(activeStream.userId, durationMinutes, {
          guestCount: activeStream.guestCount,
          description: `Stream in room ${activeStream.roomName}`,
        });
        console.log('✅ Usage tracked');
      } catch (usageErr) {
        console.warn("Failed to update usage:", usageErr);
      }

      // Generate recording path and get the video URL
      let recordingPath: string | null = null;
      try {
        const timestamp = Date.now();
        recordingPath = generateRecordingPath(activeStream.userId, activeStream.roomName, timestamp);
        videoUrl = await getSignedDownloadUrl(recordingPath);
        console.log("🎬 Recording path:", recordingPath);
      } catch (storageErr) {
        console.warn("Failed to generate recording URL:", storageErr);
      }

      // Create recording document in Firestore
      try {
        const recordingRef = await firestore.collection("recordings").add({
          userId: activeStream.userId,
          roomName: activeStream.roomName,
          title: `Stream - ${new Date(activeStream.startedAt).toLocaleString()}`,
          status: "ready",
          duration: durationSeconds,
          durationMinutes,
          viewerCount: activeStream.guestCount || 0,
          peakViewers: activeStream.guestCount || 0,
          videoUrl,
          thumbnailUrl: null,
          storagePath: recordingPath,
          progress: 100,
          createdAt: activeStream.startedAt,
          updatedAt: now,
        });
        recordingId = recordingRef.id;
        console.log(`✅ Created recording doc: ${recordingRef.id}`);
      } catch (firestoreErr) {
        console.warn("Failed to create recording doc:", firestoreErr);
      }
    }

    // BULLETPROOF: Consistent response shape
    return res.status(200).json({
      success: true,
      data: {
        egressId: targetEgressId,
        roomName,
        status: "stopped",
        durationSeconds,
        durationMinutes,
        recordingId,
        videoUrl,
        stoppedAt: new Date().toISOString(),
      },
    });

  } catch (err: any) {
    console.error("❌ Error stopping multistream:", err);
    
    // BULLETPROOF: Always return JSON
    return res.status(500).json({
      success: false,
      error: "Failed to stop multistream",
      details: err?.message,
    });
  }
});

// =============================================================================
// LEGACY STOP ENDPOINT (for backward compatibility)
// =============================================================================

router.post("/stop-multistream", async (req, res) => {
  const { egressId } = req.body;

  console.log('⏹️ Legacy stop multistream:', { egressId });

  if (!egressId) {
    return res.status(400).json({
      success: false,
      error: "egressId is required",
    });
  }

  try {
    console.log(`🛑 Stopping egress: ${egressId}`);
    
    const response: EgressInfo = await egressClient.stopEgress(egressId);
    
    // Remove from tracking map
    for (const [roomName, stream] of activeStreams.entries()) {
      if (stream.egressId === egressId) {
        activeStreams.delete(roomName);
        try {
          await firestore.collection("activeStreams").doc(roomName).delete();
        } catch (e) {
          // Ignore cleanup errors
        }
        break;
      }
    }

    console.log(`✅ Stopped egress: ${egressId}`);
    
    // BULLETPROOF: Extract egressId from response
    const stoppedEgressId = response?.egressId || egressId;
    
    // BULLETPROOF: Consistent response shape
    return res.status(200).json({
      success: true,
      data: {
        egressId: stoppedEgressId,
        status: "stopped",
        stoppedAt: new Date().toISOString(),
      },
    });

  } catch (error: any) {
    console.error("❌ Error stopping multistream:", error?.message);
    
    // BULLETPROOF: Always return JSON
    return res.status(500).json({
      success: false,
      error: "Failed to stop multistream",
      details: error?.message,
    });
  }
});

// =============================================================================
// GET STATUS OF ALL ACTIVE STREAMS
// =============================================================================

router.get("/status", (_req, res) => {
  const streams = Array.from(activeStreams.entries()).map(([roomName, stream]) => ({
    roomName,
    egressId: stream.egressId,
    userId: stream.userId,
    startedAt: stream.startedAt.toISOString(),
    durationMinutes: Math.floor((Date.now() - stream.startedAt.getTime()) / 60000),
  }));

  // BULLETPROOF: Consistent response shape
  return res.status(200).json({
    success: true,
    data: {
      activeStreams: streams,
      totalActive: streams.length,
    },
  });
});

export default router;