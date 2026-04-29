/**
 * Alert routes — admin-only alert management.
 *
 * requireAdmin is applied at the mount point in index.ts.
 * Placeholder — Firestore persistence will be added in a future pass.
 */
import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ ok: true, alerts: [] });
});

export default router;
