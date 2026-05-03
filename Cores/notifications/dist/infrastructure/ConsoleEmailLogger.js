"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsoleEmailLogger = void 0;
const LEVELS = ["debug", "info", "warn", "error", "silent"];
function levelIndex(l) {
    return LEVELS.indexOf(l);
}
/**
 * Simple structured logger that writes to stdout/stderr.
 * Used as the default logger in all environments where a custom
 * structured logger has not been injected.
 */
class ConsoleEmailLogger {
    minLevel;
    constructor(level = "info") {
        const l = String(level).toLowerCase();
        this.minLevel = LEVELS.includes(l) ? l : "info";
    }
    info(message, meta) {
        if (this.allowed("info")) {
            console.log("[email:info]", message, meta !== undefined ? meta : "");
        }
    }
    warn(message, meta) {
        if (this.allowed("warn")) {
            console.warn("[email:warn]", message, meta !== undefined ? meta : "");
        }
    }
    error(message, meta) {
        if (this.allowed("error")) {
            console.error("[email:error]", message, meta !== undefined ? meta : "");
        }
    }
    allowed(level) {
        if (this.minLevel === "silent")
            return false;
        return levelIndex(level) >= levelIndex(this.minLevel);
    }
}
exports.ConsoleEmailLogger = ConsoleEmailLogger;
