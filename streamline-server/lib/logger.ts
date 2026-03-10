/**
 * Structured logger for StreamLine server.
 *
 * Provides JSON-formatted log output with timestamps, log levels, and
 * optional context fields.  In production the output is machine-parseable;
 * in development it stays human-readable via `JSON.stringify`.
 *
 * Usage:
 *   import { logger } from "../lib/logger";
 *   logger.info("server started", { port: 3000 });
 *   logger.error("webhook failed", { eventId, error: err });
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const envLevel = (String(process.env.LOG_LEVEL || "info").toLowerCase()) as LogLevel;
const minLevel = LOG_LEVELS[envLevel] ?? LOG_LEVELS.info;

function shouldLog(level: LogLevel): boolean {
  return (LOG_LEVELS[level] ?? 0) >= minLevel;
}

function formatEntry(level: LogLevel, msg: string, data?: Record<string, unknown>) {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    msg,
  };
  if (data) {
    // Flatten serialisable error fields so they are searchable in log tools.
    if (data.error instanceof Error) {
      entry.errorMessage = data.error.message;
      entry.errorStack = data.error.stack;
      const rest = { ...data };
      delete rest.error;
      Object.assign(entry, rest);
    } else {
      Object.assign(entry, data);
    }
  }
  return JSON.stringify(entry);
}

function log(level: LogLevel, msg: string, data?: Record<string, unknown>) {
  if (!shouldLog(level)) return;
  const line = formatEntry(level, msg, data);
  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    default:
      console.log(line);
  }
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
  info:  (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
  warn:  (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
};
