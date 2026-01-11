"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const firebaseAdmin_1 = require("../firebaseAdmin");
const requireAuth_1 = require("../middleware/requireAuth");
const featureAccess_1 = require("./featureAccess");
const crypto_1 = require("../lib/crypto");
const mediaPresets_1 = require("../lib/mediaPresets");
// livekit-server-sdk is ESM; use dynamic import so CommonJS builds work on Render
let _lkMod = null;
async function getLiveKitSdk() {
    if (_lkMod)
        return _lkMod;
    _lkMod = await import("livekit-server-sdk");
    return _lkMod;
}
async function getPlanLimit(uid, field) {
    const userSnap = await firebaseAdmin_1.firestore.collection("users").doc(uid).get();
    const planId = String((userSnap.data() || {}).planId || "free");
    const planSnap = await firebaseAdmin_1.firestore.collection("plans").doc(planId).get();
    if (!planSnap.exists)
        return undefined;
    const limits = (planSnap.data() || {}).limits || {};
    const raw = limits[field];
    if (raw === undefined || raw === null)
        return undefined;
    const num = Number(raw);
    return Number.isFinite(num) ? num : undefined;
}
const router = (0, express_1.Router)();
router.post("/:roomName/start-multistream", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const requestStartedAt = Date.now();
        const uid = req.user?.uid;
        const roomName = String(req.params.roomName || "").trim();
        if (!uid)
            return res.status(401).json({ error: "Unauthorized" });
        if (!roomName)
            return res.status(400).json({ error: "Missing roomName param" });
        const streamDocId = `${uid}_${roomName}`; // always non-empty if checks passed
        const ref = firebaseAdmin_1.firestore.collection("activeStreams").doc(streamDocId);
        // if your client sends individual keys or destination IDs:
        const rawBody = req.body || {};
        const trimKey = (k) => (typeof k === "string" ? k.trim() : "");
        const youtubeStreamKey = trimKey(rawBody.youtubeStreamKey) || undefined;
        const facebookStreamKey = trimKey(rawBody.facebookStreamKey) || undefined;
        const twitchStreamKey = trimKey(rawBody.twitchStreamKey) || undefined;
        const { guestCount, destinationIds, enabledTargetIds, sessionKeys, presetId } = rawBody;
        console.log("[multistream:start] uid:", uid, "room:", roomName, {
            youtubeStreamKey: !!youtubeStreamKey,
            facebookStreamKey: !!facebookStreamKey,
            twitchStreamKey: !!twitchStreamKey,
            guestCount,
            destinationIdsCount: Array.isArray(destinationIds) ? destinationIds.length : 0,
            enabledTargetIdsCount: Array.isArray(enabledTargetIds) ? enabledTargetIds.length : 0,
        });
        const destIds = Array.isArray(enabledTargetIds)
            ? enabledTargetIds.map((id) => String(id)).filter(Boolean)
            : Array.isArray(destinationIds)
                ? destinationIds.map((id) => String(id)).filter(Boolean)
                : [];
        const sessionKeyMap = sessionKeys && typeof sessionKeys === "object" ? sessionKeys : {};
        if (!youtubeStreamKey && !facebookStreamKey && !twitchStreamKey && destIds.length === 0) {
            return res.status(400).json({ error: "At least one stream key is required" });
        }
        // Load user (optional, but fine)
        const userSnap = await firebaseAdmin_1.firestore.collection("users").doc(uid).get();
        if (!userSnap.exists)
            return res.status(401).json({ error: "User not found" });
        const planId = await (0, mediaPresets_1.getUserPlanId)(uid);
        const access = await (0, featureAccess_1.canAccessFeature)(uid, "multistream");
        if (!access.allowed) {
            return res.status(403).json({ error: access.reason || "Multistreaming is not available on your plan" });
        }
        // Clamp preset by plan
        const { preset, effectiveId, requestedId, clamped } = (0, mediaPresets_1.clampPresetForPlan)(planId, presetId);
        const encodingOptions = (0, mediaPresets_1.toEncodingOptions)(preset, "stream");
        // Destination cap enforcement (plan-based)
        const maxDestinations = await getPlanLimit(uid, "maxDestinations");
        if (maxDestinations !== undefined && maxDestinations > 0 && destIds.length > maxDestinations) {
            return res.status(403).json({ error: "destination_limit_exceeded", limit: maxDestinations });
        }
        // Save intent / status (optional but useful)
        await ref.set({
            uid,
            roomName,
            youtubeStreamKey: youtubeStreamKey || null,
            facebookStreamKey: facebookStreamKey || null,
            twitchStreamKey: twitchStreamKey || null,
            destinationIds: destIds,
            guestCount: Number(guestCount || 0),
            status: "starting",
            updatedAt: Date.now(),
            presetRequestedId: requestedId,
            presetEffectiveId: effectiveId,
            usageType: "live",
        }, { merge: true });
        // Build RTMP URLs for each platform and any stored destinations
        const urls = [];
        const logEntries = [];
        const maskUrl = (url) => {
            const idx = url.lastIndexOf("/");
            if (idx === -1)
                return "***";
            return `${url.slice(0, idx + 1)}***`;
        };
        const pushLog = (platform, url, key, source) => {
            urls.push(url);
            logEntries.push({ platform, url: maskUrl(url), keyLen: key.length, last4: key.slice(-4), source });
        };
        if (youtubeStreamKey) {
            const url = `rtmp://a.rtmp.youtube.com/live2/${youtubeStreamKey}`;
            pushLog("youtube", url, youtubeStreamKey, "direct");
        }
        if (facebookStreamKey) {
            const url = `rtmps://live-api-s.facebook.com:443/rtmp/${facebookStreamKey}`;
            pushLog("facebook", url, facebookStreamKey, "direct");
        }
        if (twitchStreamKey) {
            const url = `rtmp://live.twitch.tv/app/${twitchStreamKey}`;
            pushLog("twitch", url, twitchStreamKey, "direct");
        }
        const usedSessionKeys = new Set();
        if (destIds.length > 0) {
            try {
                const col = firebaseAdmin_1.firestore.collection("users").doc(uid).collection("destinations");
                const snaps = await Promise.all(destIds.map((id) => col.doc(id).get()));
                for (const snap of snaps) {
                    if (!snap.exists)
                        continue;
                    const data = snap.data();
                    if (!data)
                        continue;
                    if (data.mode === "connected") {
                        return res.status(400).json({ error: "connected_target_not_supported_yet" });
                    }
                    const targetId = data.targetId || snap.id;
                    const sessionKey = sessionKeyMap[targetId];
                    const baseRaw = String(sessionKey?.rtmpUrlBase || data.rtmpUrlBase || "");
                    const base = (0, crypto_1.normalizeRtmpBase)(baseRaw);
                    if (!base)
                        continue;
                    let dec = null;
                    if (sessionKey?.streamKey) {
                        dec = trimKey(sessionKey.streamKey);
                    }
                    else if (data.persistent !== false) {
                        const maybeDec = data.streamKeyEnc ? (0, crypto_1.decryptStreamKey)(data.streamKeyEnc) : null;
                        dec = maybeDec ? trimKey(maybeDec) : null;
                    }
                    if (!dec)
                        continue;
                    const url = `${base}/${dec}`;
                    const source = sessionKey?.streamKey ? "session" : "main";
                    pushLog(String(data.platform || "destination"), url, dec, source);
                    if (sessionKey?.streamKey)
                        usedSessionKeys.add(targetId);
                }
            }
            catch (e) {
                console.error("[multistream:start] failed to resolve destinationIds", e);
            }
        }
        // Handle standalone session keys (e.g., custom RTMP) that aren't tied to saved destinations
        for (const [keyId, entry] of Object.entries(sessionKeyMap || {})) {
            if (usedSessionKeys.has(keyId))
                continue;
            let base = (0, crypto_1.normalizeRtmpBase)(String(entry?.rtmpUrlBase || ""));
            let dec = entry?.streamKey ? trimKey(entry.streamKey) : "";
            // If base missing but streamKey looks like a full RTMP URL, split it
            if (!base && dec.startsWith("rtmp")) {
                const idx = dec.lastIndexOf("/");
                if (idx > 8) {
                    const maybeBase = (0, crypto_1.normalizeRtmpBase)(dec.slice(0, idx));
                    const maybeKey = trimKey(dec.slice(idx + 1));
                    if (maybeBase && maybeKey) {
                        base = maybeBase;
                        dec = maybeKey;
                    }
                }
            }
            if (!base || !dec)
                continue;
            const url = `${base}/${dec}`;
            pushLog("custom", url, dec, "session");
        }
        if (urls.length === 0) {
            return res.status(400).json({ error: "At least one stream key is required" });
        }
        console.log("[multistream:start] RTMP URLs (masked):", logEntries);
        try {
            // Import LiveKit egress client and types using dynamic helper
            const { EgressClient, StreamOutput, StreamProtocol } = await getLiveKitSdk();
            const livekitUrl = process.env.LIVEKIT_URL;
            const livekitApiKey = process.env.LIVEKIT_API_KEY;
            const livekitApiSecret = process.env.LIVEKIT_API_SECRET;
            const egressClient = new EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);
            // Create RTMP stream output
            const streamOutput = new StreamOutput({ protocol: StreamProtocol.RTMP, urls });
            // Start Room Composite egress with preset encoding
            const response = await egressClient.startRoomCompositeEgress(roomName, { stream: streamOutput }, { layout: "grid", encodingOptions });
            console.log("[multistream:start] Egress response:", {
                egressId: response?.egressId,
                room: roomName,
                raw: response,
            });
            if (response.egressId) {
                const startedAt = Date.now();
                const warmupMs = startedAt - requestStartedAt;
                const platforms = logEntries.map((e) => e.platform);
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
                    updatedAt: startedAt,
                    presetRequestedId: requestedId,
                    presetEffectiveId: effectiveId,
                    usageType: "live",
                    warmupMs,
                    warmupPlatforms: platforms,
                }, { merge: true });
                console.log("[multistream:warmup] egress started", {
                    uid,
                    roomName,
                    warmupMs,
                    warmupSeconds: Math.round(warmupMs / 1000),
                    platforms,
                });
                // Ensure non-empty JSON body
                return res.status(200).json({
                    success: true,
                    egressId: response.egressId,
                    status: "started",
                    effectivePresetId: effectiveId,
                    requestedPresetId: requestedId,
                    presetClamped: clamped,
                });
            }
            else {
                console.error("[multistream:start] No egressId returned from LiveKit");
                return res.status(500).json({ error: "Failed to start egress - no ID returned" });
            }
        }
        catch (err) {
            console.error("[multistream:start] error:", err);
            return res.status(500).json({ error: "Failed to start multistream", details: err?.message || String(err) });
        }
    }
    catch (err) {
        console.error("[multistream:start] outer error:", err);
        return res.status(500).json({ error: "Failed to start multistream" });
    }
});
router.post("/:roomName/stop-multistream", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        const roomName = String(req.params.roomName || "").trim();
        if (!uid)
            return res.status(401).json({ error: "Unauthorized" });
        if (!roomName)
            return res.status(400).json({ error: "Missing roomName param" });
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
                return res.status(404).json({ error: "No active multistream found for this room and no egressId provided" });
            }
            const querySnap = await firebaseAdmin_1.firestore
                .collection("activeStreams")
                .where("egressId", "==", egressId)
                .limit(1)
                .get();
            if (querySnap.empty) {
                return res.status(404).json({ error: "No active multistream found for this egressId" });
            }
            const candidate = querySnap.docs[0];
            const data = (candidate.data() || {});
            const ownerUid = data.uid;
            const ownerRoomName = typeof data.roomName === "string" ? data.roomName.trim() : undefined;
            const roomMatches = ownerRoomName
                ? ownerRoomName === roomName
                : candidate.id === streamDocId;
            if (ownerUid !== uid || !roomMatches) {
                console.info("[multistream:stop] egressId owner/room mismatch; denying stop", {
                    uid,
                    roomName,
                    activeUid: ownerUid,
                    activeRoomName: ownerRoomName || null,
                });
                return res.status(404).json({ error: "No active multistream found for this egressId" });
            }
            doc = candidate;
            foundRef = candidate.ref;
        }
        if (!egressId) {
            return res.status(400).json({ error: "No egressId found for active stream" });
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
            const message = err?.message || String(err);
            const code = err?.code || err?.status;
            const isNotRunning = code === 412 || /412/.test(message) || /not running/i.test(message);
            if (isNotRunning) {
                console.warn("stopEgress returned precondition/unknown state; treating as already stopped", { egressId, message });
                await foundRef.delete();
                return res.json({ success: true, status: "stopped", reason: "not_running" });
            }
            console.error("Error stopping multistream:", err);
            return res.status(500).json({ error: "Failed to stop multistream", details: message });
        }
    }
    catch (err) {
        console.error("stop-multistream error:", err);
        return res.status(500).json({ error: "Failed to stop multistream" });
    }
});
exports.default = router;
