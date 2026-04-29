/**
 * Skills Integration routes — admin-only skills management.
 *
 * requireAdmin is applied at the mount point in index.ts.
 */
import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ ok: true, integrations: [] });
});

export default router;
