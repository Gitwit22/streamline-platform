/**
 * Horizon Admin API — aggregated admin/monitoring endpoints.
 *
 * All routes are admin-only (requireAdmin applied at mount in index.ts).
 * Skeleton routes are stubbed here; real implementations will follow.
 */
import { Router } from "express";

const router = Router();

/** Basic Horizon heartbeat. */
router.get("/status", (_req, res) => {
  res.json({ ok: true, service: "horizon", ts: new Date().toISOString() });
});

export default router;
