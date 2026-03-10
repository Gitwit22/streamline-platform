/**
 * Small helper for producing safe 500 responses.
 *
 * In production the response body only contains a generic error code so
 * internal implementation details (stack traces, Stripe messages, etc.)
 * are never leaked to clients.  The raw error is still logged server-side.
 */

import type { Request, Response } from "express";
import { logger } from "./logger";

const IS_PRODUCTION = String(process.env.NODE_ENV || "").toLowerCase() === "production";

/**
 * Respond with a 500 (or provided status) while keeping error details
 * out of the response body in production.
 *
 * @param tag   Log prefix for searchability, e.g. "[billing]"
 * @param req   Express request (used for request-id correlation)
 * @param res   Express response
 * @param err   The caught error value
 * @param opts  Optional overrides: status code and public error code string
 */
export function safeError(
  tag: string,
  req: Request,
  res: Response,
  err: unknown,
  opts?: { status?: number; code?: string },
) {
  const status = opts?.status ?? 500;
  const code = opts?.code ?? "server_error";
  const reqId = (req as any).id as string | undefined;
  const message = err instanceof Error ? err.message : String(err);

  logger.error(`${tag} ${code}`, {
    requestId: reqId,
    method: req.method,
    path: req.originalUrl,
    errorMessage: message,
  });

  if (res.headersSent) return;
  res.status(status).json({
    error: code,
    ...(IS_PRODUCTION ? {} : { details: message }),
    ...(reqId ? { requestId: reqId } : {}),
  });
}
