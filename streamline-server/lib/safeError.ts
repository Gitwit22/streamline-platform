import type { Response } from "express";

/**
 * Return a generic 500 JSON response **without** leaking internal error
 * details (message, stack, etc.) to the client.  The full error is logged
 * server-side so it remains available for debugging.
 *
 * Usage:
 *   catch (err) { return safeError(res, err, "POST /api/foo"); }
 */
export function safeError(
  res: Response,
  err: unknown,
  label?: string,
): void {
  const prefix = label ? `[${label}]` : "[safeError]";
  console.error(prefix, err);
  if (!res.headersSent) {
    res.status(500).json({ error: "internal_error" });
  }
}
