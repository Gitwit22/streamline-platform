// server/routes/adminStatus.ts
import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { isAdmin } from "../middleware/adminAuth";


const router = Router();

router.get("/", requireAuth, async (req, res) => {
  console.log("[adminStatus] /api/admin/status route hit");
  try {
    // Add no-cache headers
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.set("Surrogate-Control", "no-store");

    const uid = (req as any).user?.uid;
    if (!uid) {
      console.error("[adminStatus] Missing uid in request. user:", (req as any).user);
      return res.status(401).json({ error: "Unauthorized: missing uid" });
    }

    console.log("[adminStatus] Checking admin for UID:", uid);

    const isAdminUser = await isAdmin(uid);
    res.json({ isAdmin: isAdminUser });
  } catch (err) {
    console.error("[adminStatus] Unexpected error:", err?.message, err?.stack || err);
    res.status(500).json({ error: "Internal server error", message: "Failed to verify admin status" });
  }
});

export default router;
