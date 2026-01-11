"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// server/routes/adminStatus.ts
const express_1 = require("express");
const requireAuth_1 = require("../middleware/requireAuth");
const adminAuth_1 = require("../middleware/adminAuth");
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
        const isAdminUser = await (0, adminAuth_1.isAdmin)(uid);
        res.json({ isAdmin: isAdminUser });
    }
    catch (err) {
        console.error("[adminStatus] Unexpected error:", err?.message, err?.stack || err);
        res.status(500).json({ error: "Internal server error", message: "Failed to verify admin status" });
    }
});
exports.default = router;
