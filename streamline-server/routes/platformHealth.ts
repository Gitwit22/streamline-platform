/**
 * Platform Health routes — admin-only platform health overview.
 *
 * requireAdmin is applied at the mount point in index.ts.
 */
import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    ts: new Date().toISOString(),
  });
});

export default router;
