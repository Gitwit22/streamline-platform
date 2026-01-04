"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const livekit_server_sdk_1 = require("livekit-server-sdk");
const router = express_1.default.Router();
router.post("/", async (req, res) => {
    try {
        const { roomName, identity, uid } = req.body;
        console.log("roomToken request", { roomName, identity, uid });
        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;
        const livekitUrl = process.env.LIVEKIT_URL;
        if (!apiKey || !apiSecret || !livekitUrl) {
            console.error("Missing LiveKit env vars");
            return res.status(500).json({ error: "server not configured" });
        }
        const room = roomName || "default";
        const userIdentity = identity || "Guest";
        const at = new livekit_server_sdk_1.AccessToken(apiKey, apiSecret, {
            identity: userIdentity,
        });
        at.addGrant({
            room,
            roomJoin: true,
            canPublish: true,
            canSubscribe: true,
        });
        const token = await at.toJwt();
        return res.json({
            token,
            serverUrl: livekitUrl,
        });
    }
    catch (err) {
        console.error("roomToken error", err);
        return res.status(500).json({ error: "internal_error" });
    }
});
exports.default = router;
