/**
 * Support Actions routes — admin-only support action endpoints.
 *
 * requireAdmin is applied at the mount point in index.ts.
 */
import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ ok: true, actions: [] });
});

export default router;
