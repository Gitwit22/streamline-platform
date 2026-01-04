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
    const { youtubeStreamKey, facebookStreamKey, twitchStreamKey, } = req.body;
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
        const streamOutput = new livekit_server_sdk_1.StreamOutput({
            protocol: livekit_server_sdk_1.StreamProtocol.RTMP,
            urls,
        });
        // Start Room Composite egress and stream to all URLs
        const info = await livekitClient_1.egressClient.startRoomCompositeEgress(roomName, { stream: streamOutput }, { layout: "grid" } // you can change layout if needed
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
        return res.json({ success: true });
    }
    catch (err) {
        console.error("Error stopping multistream", err);
        return res.status(500).json({
            error: "Failed to stop multistream",
            details: err?.message,
        });
    }
});
exports.default = router;
