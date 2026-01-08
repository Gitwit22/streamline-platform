import { Router } from "express";
import { firestore } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { canAccessFeature } from "./featureAccess";

const router = Router();

router.post("/start", requireAuth, async (req, res) => {
  try {
    const uid = req.user.id;

    // Feature access gate
    const access = await canAccessFeature(uid, "recording");
    if (!access.allowed) {
      return res.status(403).json({ success: false, error: access.reason || "Recording requires upgrade" });
    }

    // ...existing code for starting recording...
    // Load user
    const userSnap = await firestore.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      return res.status(401).json({ error: "User not found" });
    }

    const user = userSnap.data()!;
    const planId = user.planId || "free";

    // Load plan
    const planSnap = await firestore.collection("plans").doc(planId).get();
    if (!planSnap.exists) {
      return res.status(403).json({ error: "Invalid plan" });
    }

    const plan = planSnap.data()!;
    // ...existing code for plan logic if needed...

    // ✅ Start recording (pass watermark flag into your pipeline)
    // await startRecording({ watermark: watermarkRequired });

    return res.json({
      success: true,
      // Optionally include watermark or other info if needed
    });
  } catch (err) {
    console.error("recording error:", err);
    return res.status(500).json({ error: "Failed to start recording" });
  }
});

export default router;
