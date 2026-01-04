"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const firebaseAdmin_1 = require("../firebaseAdmin");
const requireAuth_1 = require("../middleware/requireAuth");
const featureAccess_1 = require("./featureAccess");
const crypto_1 = require("../lib/crypto");
const router = (0, express_1.Router)();
function deriveStatus(hasEnc, dec, enabled) {
    if (!hasEnc)
        return { status: "needs_attention", statusReason: "missing_key" };
    if (!dec)
        return { status: "needs_attention", statusReason: "invalid_format" };
    if (!enabled)
        return { status: "disconnected", statusReason: undefined };
    return { status: "connected", statusReason: undefined };
}
// POST /api/live/preflight
// destinationIds? omitted => use enabled destinations
// video/audio are client hints only; server enforces plan/destinations
// networkProbeMs is ignored for MVP
router.post("/preflight", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user?.uid;
        if (!uid)
            return res.status(401).json({ error: "unauthorized" });
        const access = await (0, featureAccess_1.canAccessFeature)(uid, "multistream");
        if (!access.allowed) {
            return res.status(403).json({ error: "limit_exceeded", details: access.reason || "Feature not available" });
        }
        const destinationIds = Array.isArray(req.body?.destinationIds) ? req.body.destinationIds.map((s) => String(s)) : [];
        let q = firebaseAdmin_1.firestore.collection("users").doc(uid).collection("destinations");
        if (destinationIds.length > 0) {
            // Firestore cannot do IN with more than 10; if >10, fallback to fetch all and filter
            if (destinationIds.length <= 10) {
                q = q.where("__name__", "in", destinationIds);
                const snap = await q.get();
                if (snap.empty) {
                    return res.status(404).json({ error: "destination_not_found" });
                }
                const items = snap.docs.map(d => ({ id: d.id, data: d.data() }));
                const results = items.map(({ id, data }) => {
                    const hasEnc = !!data.streamKeyEnc;
                    const dec = hasEnc ? (0, crypto_1.decryptStreamKey)(data.streamKeyEnc) : null;
                    const { status, statusReason } = deriveStatus(hasEnc, dec, !!data.enabled);
                    return {
                        id,
                        platform: String(data.platform || ""),
                        status,
                        statusReason: statusReason ?? null,
                    };
                });
                return res.json({ ok: true, allowed: true, destinations: results });
            }
            else {
                const snap = await q.get();
                const set = new Set(destinationIds);
                const filtered = snap.docs.filter(d => set.has(d.id));
                if (filtered.length === 0) {
                    return res.status(404).json({ error: "destination_not_found" });
                }
                const results = filtered.map(d => {
                    const data = d.data();
                    const hasEnc = !!data.streamKeyEnc;
                    const dec = hasEnc ? (0, crypto_1.decryptStreamKey)(data.streamKeyEnc) : null;
                    const { status, statusReason } = deriveStatus(hasEnc, dec, !!data.enabled);
                    return {
                        id: d.id,
                        platform: String(data.platform || ""),
                        status,
                        statusReason: statusReason ?? null,
                    };
                });
                return res.json({ ok: true, allowed: true, destinations: results });
            }
        }
        else {
            // Use enabled destinations
            q = q.where("enabled", "==", true);
            const snap = await q.get();
            const results = snap.docs.map(d => {
                const data = d.data();
                const hasEnc = !!data.streamKeyEnc;
                const dec = hasEnc ? (0, crypto_1.decryptStreamKey)(data.streamKeyEnc) : null;
                const { status, statusReason } = deriveStatus(hasEnc, dec, true);
                return {
                    id: d.id,
                    platform: String(data.platform || ""),
                    status,
                    statusReason: statusReason ?? null,
                };
            });
            return res.json({ ok: true, allowed: true, destinations: results });
        }
    }
    catch (err) {
        console.error("POST /api/live/preflight error:", err);
        return res.status(500).json({ error: "server_error", details: err?.message || String(err) });
    }
});
exports.default = router;
