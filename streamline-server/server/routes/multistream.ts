// server/routes/multistream.ts
import express from "express";
import { egressClient } from "../livekitClient";
import { StreamOutput, StreamProtocol, EncodedFileOutput, EncodedFileType } from "livekit-server-sdk";

const router = express.Router();

// Keep track of active egress per room in memory
const activeEgressIds = new Map<string, string>();

router.post("/:roomName/start-multistream", async (req, res) => {
  const { roomName } = req.params;

  const {
    youtubeStreamKey,
    facebookStreamKey,
    twitchStreamKey,
  } = req.body as {
    youtubeStreamKey?: string;
    facebookStreamKey?: string;
    twitchStreamKey?: string;
  };

  if (!roomName) {
    return res.status(400).json({ error: "roomName is required" });
  }

  // Build RTMP URLs for each platform
  const urls: string[] = [];

  if (youtubeStreamKey) {
    // YouTube
    urls.push(`rtmp://a.rtmp.youtube.com/live2/${youtubeStreamKey}`);
  }

  if (facebookStreamKey) {
    // Facebook
    urls.push(
      `rtmps://live-api-s.facebook.com:443/rtmp/${facebookStreamKey}`
    );
  }

  if (twitchStreamKey) {
    // Twitch
    urls.push(`rtmp://live.twitch.tv/app/${twitchStreamKey}`);
  }

  if (urls.length === 0) {
    return res
      .status(400)
      .json({ error: "At least one stream key (YouTube, Facebook, Twitch) is required" });
  }

  try {
    const streamOutput = new StreamOutput({
      protocol: StreamProtocol.RTMP,
      urls,
    });

    // Prepare output options - stream is required, file is optional
    const outputOptions: any = { stream: streamOutput };

    // Add file output if R2 credentials are configured (saves recording to R2)
    if (
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_ENDPOINT &&
      process.env.R2_BUCKET
    ) {
      const fileOutput = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath: `recordings/${roomName}-${Date.now()}.mp4`,
        s3: {
          accessKey: process.env.R2_ACCESS_KEY_ID,
          secret: process.env.R2_SECRET_ACCESS_KEY,
          endpoint: process.env.R2_ENDPOINT,
          bucket: process.env.R2_BUCKET,
        },
      });
      outputOptions.file = fileOutput;
    }

    // Start Room Composite egress and stream to all URLs
    const info = await egressClient.startRoomCompositeEgress(
      roomName,
      outputOptions,
      { layout: "grid" } // you can change layout if needed
    );

    // Remember egressId so we can stop it later
    if (info.egressId) {
      activeEgressIds.set(roomName, info.egressId);
    }

    return res.json({
      success: true,
      egressId: info.egressId,
      urls,
    });
  } catch (err: any) {
    console.error("Error starting multistream", err);
    return res.status(500).json({
      error: "Failed to start multistream",
      details: err?.message,
    });
  }
});

router.post("/:roomName/stop-multistream", async (req, res) => {
  const { roomName } = req.params;

  if (!roomName) {
    return res.status(400).json({ error: "roomName is required" });
  }

  const egressId = activeEgressIds.get(roomName);

  if (!egressId) {
    return res.status(404).json({
      error: "No active multistream found for this room",
    });
  }

  try {
    await egressClient.stopEgress(egressId);
    activeEgressIds.delete(roomName);

    // Fetch the egress info to get the video URL
    let videoUrl = null;
    try {
      const egressInfoList = await egressClient.listEgress({ egressId });
      if (egressInfoList && egressInfoList.length > 0 && egressInfoList[0].file) {
        videoUrl = egressInfoList[0].file.location;
      }
    } catch (infoErr) {
      console.error("Error fetching egress info:", infoErr);
      // Don't fail the request if we can't get the info
    }

    return res.json({ success: true, videoUrl });
  } catch (err: any) {
    console.error("Error stopping multistream", err);
    return res.status(500).json({
      error: "Failed to stop multistream",
      details: err?.message,
    });
  }
});

export default router;
