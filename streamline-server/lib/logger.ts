/**
 * Structured JSON logger (pino).
 *
 * Usage:
 *   import { logger } from "../lib/logger";
 *   logger.info({ requestId }, "something happened");
 */
import pino from "pino";

const isProduction = String(process.env.NODE_ENV || "development").toLowerCase() === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  // Redact sensitive fields that may appear in serialized request objects.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-room-access-token"]',
    ],
    censor: "[REDACTED]",
  },
});
