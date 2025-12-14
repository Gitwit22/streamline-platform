import { Router, Request, Response } from "express";

const router = Router();

// All editing routes are disabled - return HTTP 410 (Gone) for all requests
router.use((req: Request, res: Response) => {
  console.log(`🚫 Editing route blocked: ${req.method} ${req.originalUrl}`);
  res.status(410).json({ error: "Editing routes are disabled" });
});

export default router;
