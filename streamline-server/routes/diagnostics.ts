/**
 * Diagnostics routes — admin-only runtime diagnostics.
 *
 * requireAdmin is applied at the mount point in index.ts.
 */
import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    ok: true,
    nodeVersion: process.version,
    env: String(process.env.NODE_ENV || "development"),
    ts: new Date().toISOString(),
  });
});

export default router;
