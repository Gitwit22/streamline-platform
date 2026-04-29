/**
 * Support Tickets routes — admin-only ticket management.
 *
 * requireAdmin is applied at the mount point in index.ts.
 */
import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ ok: true, tickets: [] });
});

export default router;
