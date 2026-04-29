import type { IEmailLogger } from "../domain/Notification";

const LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
type Level = (typeof LEVELS)[number];

function levelIndex(l: Level): number {
  return LEVELS.indexOf(l);
}

/**
 * Simple structured logger that writes to stdout/stderr.
 * Used as the default logger in all environments where a custom
 * structured logger has not been injected.
 */
export class ConsoleEmailLogger implements IEmailLogger {
  private readonly minLevel: Level;

  constructor(level: string = "info") {
    const l = String(level).toLowerCase() as Level;
    this.minLevel = LEVELS.includes(l) ? l : "info";
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (this.allowed("info")) {
      console.log("[email:info]", message, meta !== undefined ? meta : "");
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.allowed("warn")) {
      console.warn("[email:warn]", message, meta !== undefined ? meta : "");
    }
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (this.allowed("error")) {
      console.error("[email:error]", message, meta !== undefined ? meta : "");
    }
  }

  private allowed(level: Level): boolean {
    if (this.minLevel === "silent") return false;
    return levelIndex(level) >= levelIndex(this.minLevel);
  }
}
