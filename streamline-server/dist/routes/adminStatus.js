"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// server/routes/adminStatus.ts
const express_1 = require("express");
const firebaseAdmin_1 = require("../firebaseAdmin");
const requireAuth_1 = require("../middleware/requireAuth");
const router = (0, express_1.Router)();
router.get("/", requireAuth_1.requireAuth, async (req, res) => {
    console.log("[adminStatus] /api/admin/status route hit");
    try {
        // Add no-cache headers
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.set("Pragma", "no-cache");
        res.set("Expires", "0");
        res.set("Surrogate-Control", "no-store");
        const uid = req.user?.uid;
        if (!uid) {
            console.error("[adminStatus] Missing uid in request. user:", req.user);
            return res.status(401).json({ error: "Unauthorized: missing uid" });
        }
        console.log("[adminStatus] Checking admin for UID:", uid);
        let snap;
        try {
            snap = await firebaseAdmin_1.firestore.collection("admins").doc(uid).get();
            console.log("[adminStatus] Admin doc exists:", snap.exists, "Data:", snap.data());
        }
        catch (firestoreErr) {
            console.error("[adminStatus] Firestore error:", firestoreErr);
            return res.status(500).json({ error: "Firestore error", details: firestoreErr?.message });
        }
        res.json({ isAdmin: snap.exists });
    }
    catch (err) {
        console.error("[adminStatus] Unexpected error:", err?.message, err?.stack || err);
        res.status(500).json({ error: "Internal server error", message: "Failed to verify admin status" });
    }
});
exports.default = router;
