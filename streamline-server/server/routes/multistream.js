"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// server/routes/multistream.ts
const express_1 = __importDefault(require("express"));
const livekitClient_1 = require("../livekitClient");
const livekit_server_sdk_1 = require("livekit-server-sdk");
const router = express_1.default.Router();
// Keep track of active egress per room in memory
const activeEgressIds = new Map();
router.post("/:roomName/start-multistream", async (req, res) => {
    const { roomName } = req.params;
    const { youtubeStreamKey, facebookStreamKey, } = req.body;
    if (!roomName) {
        return res.status(400).json({ error: "roomName is required" });
    }
    // Build RTMP URLs for each platform
    const urls = [];
    if (youtubeStreamKey) {
        // YouTube
        urls.push(`rtmp://a.rtmp.youtube.com/live2/${youtubeStreamKey}`);
    }
    if (facebookStreamKey) {
        // Facebook
        urls.push(`rtmps://live-api-s.facebook.com:443/rtmp/${facebookStreamKey}`);
    }
    if (urls.length === 0) {
        return res
            .status(400)
            .json({ error: "At least one stream key (YouTube or Facebook) is required" });
    }
    try {
        const streamOutput = new livekit_server_sdk_1.StreamOutput({
            protocol: livekit_server_sdk_1.StreamProtocol.RTMP,
            urls,
        });
        const outputOptions = { stream: streamOutput };
        // Add file output if R2 credentials are configured (saves recording to R2)
        if (process.env.R2_ACCESS_KEY_ID &&
            process.env.R2_SECRET_ACCESS_KEY &&
            process.env.R2_ENDPOINT &&
            process.env.R2_BUCKET) {
            const fileOutput = new livekit_server_sdk_1.EncodedFileOutput({
                fileType: livekit_server_sdk_1.EncodedFileType.MP4,
                filepath: `recordings/${roomName}-${Date.now()}.mp4`,
                output: {
                    case: "s3",
                    value: new livekit_server_sdk_1.S3Upload({
                        accessKey: process.env.R2_ACCESS_KEY_ID,
                        secret: process.env.R2_SECRET_ACCESS_KEY,
                        endpoint: process.env.R2_ENDPOINT,
                        bucket: process.env.R2_BUCKET,
                    }),
                },
            });
            outputOptions.file = fileOutput;
        }
        // Start Room Composite egress and stream to all URLs
        const info = await livekitClient_1.egressClient.startRoomCompositeEgress(roomName, outputOptions, { layout: "grid" } // you can change layout if needed
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
    }
    catch (err) {
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
        await livekitClient_1.egressClient.stopEgress(egressId);
        activeEgressIds.delete(roomName);
        // Fetch the egress info to get the video URL
        let videoUrl = null;
        try {
            const egressInfoList = await livekitClient_1.egressClient.listEgress({ egressId });
            if (egressInfoList && egressInfoList.length > 0) {
                const fileResults = egressInfoList[0].fileResults;
                if (fileResults && fileResults.length > 0 && fileResults[0].location) {
                    videoUrl = fileResults[0].location;
                }
            }
        }
        catch (infoErr) {
            console.error("Error fetching egress info:", infoErr);
            // Don't fail the request if we can't get the info
        }
        return res.json({ success: true, videoUrl });
    }
    catch (err) {
        console.error("Error stopping multistream", err);
        return res.status(500).json({
            error: "Failed to stop multistream",
            details: err?.message,
        });
    }
});
// Emergency stop endpoint for beforeunload (Task 5.1)
router.post("/:roomName/emergency-stop", async (req, res) => {
    const { roomName } = req.params;
    const { egressId } = req.body;
    if (!roomName || !egressId) {
        return res.status(400).json({ error: "roomName and egressId are required" });
    }
    try {
        await livekitClient_1.egressClient.stopEgress(egressId);
        activeEgressIds.delete(roomName);
        return res.json({ success: true });
    }
    catch (err) {
        console.error("Emergency stop failed:", err);
        return res.status(500).json({
            error: "Failed to stop",
            details: err?.message
        });
    }
});
exports.default = router;
