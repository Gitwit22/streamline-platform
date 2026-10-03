/**
 * Global Express error handler.
 *
 * - Logs structured error with requestId via pino.
 * - Returns sanitized JSON (no stack traces in production).
 * - Preserves HTTP status if already set.
 * - Safe, additive — does not require an AppError migration.
 */
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

// Fail closed: only expose error messages/stacks when explicitly running in
// development or test. An unset NODE_ENV (e.g. a misconfigured deploy) must
// not leak internals to clients.
const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase();
const isProduction = !(nodeEnv === "development" || nodeEnv === "test");

export function globalErrorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status =
    typeof err?.status === "number" && err.status >= 400 && err.status < 600
      ? err.status
      : typeof err?.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;

  const requestId = (req as any).id || res.getHeader("X-Request-Id") || undefined;

  logger.error(
    {
      err,
      requestId,
      method: req.method,
      url: req.originalUrl,
      status,
    },
    err?.message || "Unhandled error"
  );

  // Avoid double-sending if headers already flushed.
  if (res.headersSent) return;

  const body: Record<string, unknown> = {
    error: isProduction ? "Internal server error" : (err?.message || "Internal server error"),
    ...(requestId ? { requestId } : {}),
  };

  if (!isProduction && err?.stack) {
    body.stack = err.stack;
  }

  res.status(status).json(body);
}
