"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const firebaseAdmin_1 = require("../firebaseAdmin");
const requireAuth_1 = require("../middleware/requireAuth");
const featureAccess_1 = require("./featureAccess");
// livekit-server-sdk is ESM; use dynamic import so CommonJS builds work on Render
let _lkMod = null;
async function getLiveKitSdk() {
    if (_lkMod)
        return _lkMod;
    _lkMod = await Promise.resolve().then(() => __importStar(require("livekit-server-sdk")));
    return _lkMod;
}
const router = (0, express_1.Router)();
router.post("/:roomName/start-multistream", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        const roomName = String(req.params.roomName || "").trim();
        if (!uid)
            return res.status(401).json({ error: "unauthorized" });
        if (!roomName)
            return res.status(400).json({ error: "invalid_query", details: "roomName param required" });
        const streamDocId = `${uid}_${roomName}`; // always non-empty if checks passed
        const ref = firebaseAdmin_1.firestore.collection("activeStreams").doc(streamDocId);
        // if your client sends individual keys:
        const { youtubeStreamKey, facebookStreamKey, twitchStreamKey, guestCount } = req.body || {};
        console.log("[multistream:start] uid:", uid, "room:", roomName, {
            youtubeStreamKey: !!youtubeStreamKey,
            facebookStreamKey: !!facebookStreamKey,
            twitchStreamKey: !!twitchStreamKey,
            guestCount,
        });
        if (!youtubeStreamKey && !facebookStreamKey && !twitchStreamKey) {
            return res.status(400).json({ error: "missing_required_fields", details: "At least one stream key is required" });
        }
        // Load user (optional, but fine)
        const userSnap = await firebaseAdmin_1.firestore.collection("users").doc(uid).get();
        if (!userSnap.exists)
            return res.status(404).json({ error: "not_found", details: "user not found" });
        const access = await (0, featureAccess_1.canAccessFeature)(uid, "multistream");
        if (!access.allowed) {
            return res.status(403).json({ error: "limit_exceeded", details: access.reason || "Multistreaming is not available on your plan" });
        }
        // Save intent / status (optional but useful)
        await ref.set({
            uid,
            roomName,
            youtubeStreamKey: youtubeStreamKey || null,
            facebookStreamKey: facebookStreamKey || null,
            twitchStreamKey: twitchStreamKey || null,
            guestCount: Number(guestCount || 0),
            status: "starting",
            updatedAt: Date.now(),
        }, { merge: true });
        // Build RTMP URLs for each platform
        const urls = [];
        if (youtubeStreamKey)
            urls.push(`rtmp://a.rtmp.youtube.com/live2/${youtubeStreamKey}`);
        if (facebookStreamKey)
            urls.push(`rtmps://live-api-s.facebook.com:443/rtmp/${facebookStreamKey}`);
        if (twitchStreamKey)
            urls.push(`rtmp://live.twitch.tv/app/${twitchStreamKey}`);
        if (urls.length === 0) {
            return res.status(400).json({ error: "missing_required_fields", details: "At least one stream key is required" });
        }
        console.log("[multistream:start] RTMP URLs:", urls);
        try {
            // Import LiveKit egress client and types using dynamic helper
            const { EgressClient, StreamOutput, StreamProtocol, EncodingOptionsPreset } = await getLiveKitSdk();
            const livekitUrl = process.env.LIVEKIT_URL;
            const livekitApiKey = process.env.LIVEKIT_API_KEY;
            const livekitApiSecret = process.env.LIVEKIT_API_SECRET;
            const egressClient = new EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);
            // Create RTMP stream output
            const streamOutput = new StreamOutput({ protocol: StreamProtocol.RTMP, urls });
            // Start Room Composite egress with preset encoding
            const response = await egressClient.startRoomCompositeEgress(roomName, { stream: streamOutput }, { layout: "grid", encodingOptions: EncodingOptionsPreset.H264_1080P_30 });
            console.log("[multistream:start] Egress response:", {
                egressId: response?.egressId,
                room: roomName,
                raw: response,
            });
            if (response.egressId) {
                // Save to Firestore only after success
                await ref.set({
                    uid,
                    roomName,
                    youtubeStreamKey: youtubeStreamKey || null,
                    facebookStreamKey: facebookStreamKey || null,
                    twitchStreamKey: twitchStreamKey || null,
                    guestCount: Number(guestCount || 0),
                    status: "started",
                    egressId: response.egressId,
                    updatedAt: Date.now(),
                }, { merge: true });
                // Ensure non-empty JSON body
                return res.status(200).json({ success: true, egressId: response.egressId, status: "started" });
            }
            else {
                console.error("[multistream:start] No egressId returned from LiveKit");
                return res.status(500).json({ error: "server_error", details: "Failed to start egress - no ID returned" });
            }
        }
        catch (err) {
            console.error("[multistream:start] error:", err);
            return res.status(500).json({ error: "server_error", details: err?.message || String(err) });
        }
    }
    catch (err) {
        console.error("[multistream:start] outer error:", err);
        return res.status(500).json({ error: "server_error" });
    }
});
router.post("/:roomName/stop-multistream", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        const roomName = String(req.params.roomName || "").trim();
        if (!uid)
            return res.status(401).json({ error: "unauthorized" });
        if (!roomName)
            return res.status(400).json({ error: "invalid_query", details: "roomName param required" });
        const streamDocId = `${uid}_${roomName}`;
        const ref = firebaseAdmin_1.firestore.collection("activeStreams").doc(streamDocId);
        let doc = await ref.get();
        let egressId = null;
        let foundRef = ref;
        if (doc.exists) {
            const data = doc.data();
            egressId = data?.egressId;
        }
        else {
            // Fallback: search for activeStreams doc with matching egressId from request body
            egressId = req.body.egressId;
            if (!egressId) {
                return res.status(404).json({ error: "not_found", details: "No active multistream found for this room and no egressId provided" });
            }
            const querySnap = await firebaseAdmin_1.firestore.collection("activeStreams").where("egressId", "==", egressId).get();
            if (querySnap.empty) {
                return res.status(404).json({ error: "not_found", details: "No active multistream found for this egressId" });
            }
            // Use the first matching doc
            doc = querySnap.docs[0];
            foundRef = doc.ref;
        }
        if (!egressId) {
            return res.status(400).json({ error: "missing_required_fields", details: "No egressId found for active stream" });
        }
        // Import LiveKit egress client using dynamic helper
        const { EgressClient } = await getLiveKitSdk();
        const livekitUrl = process.env.LIVEKIT_URL;
        const livekitApiKey = process.env.LIVEKIT_API_KEY;
        const livekitApiSecret = process.env.LIVEKIT_API_SECRET;
        const egressClient = new EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);
        try {
            await egressClient.stopEgress(egressId);
            await foundRef.delete();
            return res.json({ success: true, status: "stopped" });
        }
        catch (err) {
            console.error("Error stopping multistream:", err);
            return res.status(500).json({ error: "server_error", details: err?.message });
        }
    }
    catch (err) {
        console.error("stop-multistream error:", err);
        return res.status(500).json({ error: "server_error" });
    }
});
exports.default = router;
