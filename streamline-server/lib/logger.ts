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
      // Room-access (?t=) and guest-session (?gst=) tokens ride in the query
      // string for SSE; keep them out of request logs.
      "req.url",
      "req.query.t",
      "req.query.gst",
    ],
    censor: (value: unknown, path: string[]) => {
      if (path[path.length - 1] === "url" && typeof value === "string") {
        return value.replace(/([?&](?:t|gst|token)=)[^&#]*/gi, "$1[REDACTED]");
      }
      return "[REDACTED]";
    },
  },
});
