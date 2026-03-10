/**
 * Global Express error-handling middleware.
 *
 * Catches any error thrown (or passed via `next(err)`) that route handlers
 * did not handle.  In production the response body is sanitised so internal
 * implementation details are never leaked to clients.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

const IS_PRODUCTION = String(process.env.NODE_ENV || "").toLowerCase() === "production";

export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const reqId = (req as any).id as string | undefined;
  const message = err instanceof Error ? err.message : String(err);

  logger.error("unhandled error", {
    requestId: reqId,
    method: req.method,
    path: req.originalUrl,
    errorMessage: message,
    ...(IS_PRODUCTION ? {} : { stack: err instanceof Error ? err.stack : undefined }),
  });

  if (res.headersSent) return;

  res.status(500).json({
    error: "internal_server_error",
    ...(reqId ? { requestId: reqId } : {}),
  });
}
