"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const firebaseAdmin_1 = require("../firebaseAdmin");
const requireAuth_1 = require("../middleware/requireAuth");
const crypto_1 = require("../lib/crypto");
const router = (0, express_1.Router)();
function deriveStatus(hasEnc, streamKeyDec, enabled) {
    if (!hasEnc) {
        return { status: "needs_attention", statusReason: "missing_key" };
    }
    if (!streamKeyDec) {
        return { status: "needs_attention", statusReason: "invalid_format" };
    }
    if (!enabled) {
        return { status: "disconnected", statusReason: undefined };
    }
    return { status: "connected", statusReason: undefined };
}
function toItem(doc) {
    const data = doc.data() || {};
    const hasEnc = !!data.streamKeyEnc;
    const dec = hasEnc ? (0, crypto_1.decryptStreamKey)(data.streamKeyEnc) : null;
    const hasKey = !!dec;
    const keyPreview = dec ? dec.slice(-4) : null;
    const { status, statusReason } = deriveStatus(hasEnc, dec, !!data.enabled);
    return {
        id: doc.id,
        platform: String(data.platform || ""),
        name: data.name || undefined,
        enabled: !!data.enabled,
        rtmpUrlBase: String(data.rtmpUrlBase || ""),
        status,
        statusReason: statusReason ?? null,
        hasKey,
        keyPreview,
        updatedAt: Number(data.updatedAt || 0) || undefined,
    };
}
// GET /api/destinations?platform=youtube&includeDisabled=false
router.get("/", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid)
            return res.status(401).json({ error: "unauthorized" });
        const platform = req.query.platform ? String(req.query.platform).trim().toLowerCase() : "";
        const includeDisabled = req.query.includeDisabled === "true" || req.query.includeDisabled === true ? true : false;
        let q = firebaseAdmin_1.firestore.collection("users").doc(uid).collection("destinations");
        if (platform) {
            q = q.where("platform", "==", platform);
        }
        if (!includeDisabled) {
            q = q.where("enabled", "==", true);
        }
        const snap = await q.get();
        const items = snap.docs.map(toItem);
        // Optional: fetch plan limit
        let limit;
        const userSnap = await firebaseAdmin_1.firestore.collection("users").doc(uid).get();
        const planId = String((userSnap.data() || {}).planId || "free");
        const planSnap = await firebaseAdmin_1.firestore.collection("plans").doc(planId).get();
        if (planSnap.exists) {
            const limits = (planSnap.data() || {}).limits || {};
            limit = Number(limits.maxDestinations || 0) || undefined;
        }
        const payload = { ok: true, items, usedCount: items.length, limit };
        return res.json(payload);
    }
    catch (err) {
        console.error("GET /api/destinations error:", err);
        return res.status(500).json({ error: "server_error", details: err?.message || String(err) });
    }
});
async function getPlanLimit(uid) {
    const userSnap = await firebaseAdmin_1.firestore.collection("users").doc(uid).get();
    const planId = String((userSnap.data() || {}).planId || "free");
    const planSnap = await firebaseAdmin_1.firestore.collection("plans").doc(planId).get();
    if (planSnap.exists) {
        const limits = (planSnap.data() || {}).limits || {};
        const limit = Number(limits.maxDestinations || 0) || undefined;
        return limit;
    }
    return undefined;
}
async function getEnabledCount(uid) {
    const snap = await firebaseAdmin_1.firestore.collection("users").doc(uid).collection("destinations").where("enabled", "==", true).get();
    return snap.size;
}
// POST /api/destinations
router.post("/", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid)
            return res.status(401).json({ error: "unauthorized" });
        const { platform, name, rtmpUrlBase, streamKeyEnc, enabled } = req.body || {};
        if (!platform || !rtmpUrlBase) {
            return res.status(400).json({ error: "missing_required_fields", details: "platform and rtmpUrlBase are required" });
        }
        const normalizedBase = (0, crypto_1.normalizeRtmpBase)(String(rtmpUrlBase));
        // Duplicate rule: same platform + same normalized base per user
        const dupSnap = await firebaseAdmin_1.firestore.collection("users").doc(uid).collection("destinations")
            .where("platform", "==", String(platform).toLowerCase())
            .where("rtmpUrlBase", "==", normalizedBase)
            .limit(1)
            .get();
        if (!dupSnap.empty) {
            return res.status(409).json({ error: "duplicate_target" });
        }
        // Build doc data
        const now = Date.now();
        const docData = {
            platform: String(platform).toLowerCase(),
            name: name ? String(name) : null,
            enabled: enabled === false ? false : true,
            rtmpUrlBase: normalizedBase,
            streamKeyEnc: streamKeyEnc || null,
            updatedAt: now,
        };
        const col = firebaseAdmin_1.firestore.collection("users").doc(uid).collection("destinations");
        const createdRef = await col.add(docData);
        const createdSnap = await createdRef.get();
        const destination = toItem(createdSnap);
        const usedCount = await getEnabledCount(uid);
        const limit = await getPlanLimit(uid);
        const payload = {
            ok: true,
            destination,
            validation: { status: destination.status, statusReason: destination.statusReason ?? null },
            usedCount,
            limit,
        };
        return res.status(201).json(payload);
    }
    catch (err) {
        console.error("POST /api/destinations error:", err);
        return res.status(500).json({ error: "server_error", details: err?.message || String(err) });
    }
});
// POST /api/destinations/validate (pre-create)
router.post("/validate", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid)
            return res.status(401).json({ error: "unauthorized" });
        const body = req.body || {};
        if (!body.platform || !body.rtmpUrlBase) {
            return res.status(400).json({ error: "missing_required_fields" });
        }
        const normalizedBase = (0, crypto_1.normalizeRtmpBase)(body.rtmpUrlBase);
        const dec = body.streamKeyEnc ? (0, crypto_1.decryptStreamKey)(body.streamKeyEnc) : null;
        const { status, statusReason } = deriveStatus(dec, true);
        const payload = { ok: true, status, statusReason: statusReason ?? null };
        return res.json(payload);
    }
    catch (err) {
        console.error("POST /api/destinations/validate error:", err);
        return res.status(500).json({ error: "server_error", details: err?.message || String(err) });
    }
});
// POST /api/destinations/:id/validate (validate existing; does not update)
router.post("/:id/validate", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid)
            return res.status(401).json({ error: "unauthorized" });
        const id = String(req.params.id || "");
        if (!id)
            return res.status(400).json({ error: "invalid_query" });
        const ref = firebaseAdmin_1.firestore.collection("users").doc(uid).collection("destinations").doc(id);
        const snap = await ref.get();
        if (!snap.exists)
            return res.status(404).json({ error: "destination_not_found" });
        const item = toItem(snap);
        const payload = { ok: true, status: item.status, statusReason: item.statusReason ?? null };
        return res.json(payload);
    }
    catch (err) {
        console.error("POST /api/destinations/:id/validate error:", err);
        return res.status(500).json({ error: "server_error", details: err?.message || String(err) });
    }
});
// PUT /api/destinations/:id
router.put("/:id", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid)
            return res.status(401).json({ error: "unauthorized" });
        const id = String(req.params.id || "");
        if (!id)
            return res.status(400).json({ error: "invalid_query" });
        const updates = req.body || {};
        const ref = firebaseAdmin_1.firestore.collection("users").doc(uid).collection("destinations").doc(id);
        const snap = await ref.get();
        if (!snap.exists)
            return res.status(404).json({ error: "destination_not_found" });
        const current = snap.data();
        let nextPlatform = typeof updates.platform === "string" ? String(updates.platform).toLowerCase() : current.platform;
        let nextBase = typeof updates.rtmpUrlBase === "string" ? (0, crypto_1.normalizeRtmpBase)(String(updates.rtmpUrlBase)) : current.rtmpUrlBase;
        if ((nextPlatform !== current.platform) || (nextBase !== current.rtmpUrlBase)) {
            const dupSnap = await firebaseAdmin_1.firestore.collection("users").doc(uid).collection("destinations")
                .where("platform", "==", nextPlatform)
                .where("rtmpUrlBase", "==", nextBase)
                .limit(1)
                .get();
            const isDup = !dupSnap.empty && dupSnap.docs[0].id !== id;
            if (isDup) {
                return res.status(409).json({ error: "duplicate_target" });
            }
        }
        const docData = {
            platform: nextPlatform,
            rtmpUrlBase: nextBase,
            name: typeof updates.name === "string" ? String(updates.name) : (current.name || null),
            enabled: typeof updates.enabled === "boolean" ? !!updates.enabled : !!current.enabled,
            streamKeyEnc: updates.streamKeyEnc ?? current.streamKeyEnc ?? null,
            updatedAt: Date.now(),
        };
        await ref.set(docData, { merge: true });
        const updatedSnap = await ref.get();
        const destination = toItem(updatedSnap);
        const usedCount = await getEnabledCount(uid);
        const limit = await getPlanLimit(uid);
        return res.json({ ok: true, destination, usedCount, limit });
    }
    catch (err) {
        console.error("PUT /api/destinations/:id error:", err);
        return res.status(500).json({ error: "server_error", details: err?.message || String(err) });
    }
});
// DELETE /api/destinations/:id
router.delete("/:id", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid)
            return res.status(401).json({ error: "unauthorized" });
        const id = String(req.params.id || "");
        if (!id)
            return res.status(400).json({ error: "invalid_query" });
        const ref = firebaseAdmin_1.firestore.collection("users").doc(uid).collection("destinations").doc(id);
        const snap = await ref.get();
        if (!snap.exists)
            return res.status(404).json({ error: "destination_not_found" });
        await ref.delete();
        return res.json({ ok: true });
    }
    catch (err) {
        console.error("DELETE /api/destinations/:id error:", err);
        return res.status(500).json({ error: "server_error", details: err?.message || String(err) });
    }
});
exports.default = router;
