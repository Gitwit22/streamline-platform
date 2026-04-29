/**
 * Request / Correlation ID middleware.
 *
 * - Accepts an incoming X-Request-Id header if present.
 * - Otherwise generates a new UUID via crypto.randomUUID().
 * - Stores the id on `req.id` for downstream consumers.
 * - Sets the X-Request-Id response header.
 */
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

// Augment Express Request so TypeScript knows about req.id.
declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers["x-request-id"];
  const id =
    typeof incoming === "string" && incoming.length > 0 && incoming.length <= 128
      ? incoming
      : crypto.randomUUID();

  req.id = id;
  res.setHeader("X-Request-Id", id);
  next();
}
