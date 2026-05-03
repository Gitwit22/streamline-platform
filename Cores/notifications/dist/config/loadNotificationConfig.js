"use strict";
/**
 * Reads email configuration from environment variables.
 *
 * Variables consumed:
 *   RESEND_API_KEY        — Resend.com API key. When absent the console provider is used.
 *   EMAIL_FROM            — Sender address, e.g. "StreamLine <noreply@example.com>"
 *   EMAIL_REPLY_TO        — Optional reply-to address
 *   EMAIL_SEND_ENABLED    — Set to "false" to disable all outbound email (default: true)
 *   EMAIL_LOG_LEVEL       — One of: debug | info | warn | error | silent (default: info)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadNotificationConfig = loadNotificationConfig;
const VALID_LOG_LEVELS = new Set(["debug", "info", "warn", "error", "silent"]);
function toLogLevel(raw) {
    const val = String(raw || "").toLowerCase();
    return VALID_LOG_LEVELS.has(val) ? val : "info";
}
function loadNotificationConfig() {
    const resendApiKey = process.env.RESEND_API_KEY?.trim() || undefined;
    const from = process.env.EMAIL_FROM?.trim() || "noreply@example.com";
    const replyTo = process.env.EMAIL_REPLY_TO?.trim() || undefined;
    const logLevel = toLogLevel(process.env.EMAIL_LOG_LEVEL);
    const rawEnabled = String(process.env.EMAIL_SEND_ENABLED ?? "true").trim().toLowerCase();
    const enabled = rawEnabled !== "false";
    const provider = resendApiKey ? "resend" : "console";
    return { provider, resendApiKey, from, replyTo, enabled, logLevel };
}
