"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const firebaseAdmin_1 = require("../firebaseAdmin");
const requireAuth_1 = require("../middleware/requireAuth");
const featureAccess_1 = require("./featureAccess");
const router = (0, express_1.Router)();
router.post("/start", requireAuth_1.requireAuth, async (req, res) => {
    try {
        const uid = req.user.id;
        // Feature access gate
        const access = await (0, featureAccess_1.canAccessFeature)(uid, "recording");
        if (!access.allowed) {
            return res.status(403).json({ success: false, error: access.reason || "Recording requires upgrade" });
        }
        // ...existing code for starting recording...
        // Load user
        const userSnap = await firebaseAdmin_1.firestore.collection("users").doc(uid).get();
        if (!userSnap.exists) {
            return res.status(401).json({ error: "User not found" });
        }
        const user = userSnap.data();
        const planId = user.planId || "free";
        // Load plan
        const planSnap = await firebaseAdmin_1.firestore.collection("plans").doc(planId).get();
        if (!planSnap.exists) {
            return res.status(403).json({ error: "Invalid plan" });
        }
        const plan = planSnap.data();
        // ...existing code for plan logic if needed...
        // ✅ Start recording (pass watermark flag into your pipeline)
        // await startRecording({ watermark: watermarkRequired });
        return res.json({
            success: true,
            // Optionally include watermark or other info if needed
        });
    }
    catch (err) {
        console.error("recording error:", err);
        return res.status(500).json({ error: "Failed to start recording" });
    }
});
exports.default = router;
