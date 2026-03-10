/**
 * Attaches a unique request ID to every incoming request.
 *
 * If the caller already supplies an `x-request-id` header it is reused;
 * otherwise a new pseudo-random ID is generated.  The ID is also set as
 * a response header so clients can correlate errors with server logs.
 */

import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

export function requestId(req: Request, res: Response, next: NextFunction) {
  const existing = req.headers["x-request-id"];
  const id = typeof existing === "string" && existing.length > 0
    ? existing
    : crypto.randomUUID();

  (req as any).id = id;
  res.setHeader("x-request-id", id);
  next();
}
