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

export type EmailLogLevel = "debug" | "info" | "warn" | "error" | "silent";
export type EmailProvider = "resend" | "console";

export interface NotificationConfig {
  /** Which provider to use. Falls back to "console" when no API key is present. */
  provider: EmailProvider;
  /** Resend.com API key. Only present when provider === "resend". */
  resendApiKey?: string;
  /** Sender address used for all outgoing messages. */
  from: string;
  /** Optional reply-to address. */
  replyTo?: string;
  /** When false, no emails are dispatched (safe default for local dev). */
  enabled: boolean;
  /** Controls verbosity of the built-in console logger. */
  logLevel: EmailLogLevel;
}

const VALID_LOG_LEVELS = new Set<EmailLogLevel>(["debug", "info", "warn", "error", "silent"]);

function toLogLevel(raw: string | undefined): EmailLogLevel {
  const val = String(raw || "").toLowerCase() as EmailLogLevel;
  return VALID_LOG_LEVELS.has(val) ? val : "info";
}

export function loadNotificationConfig(): NotificationConfig {
  const resendApiKey = process.env.RESEND_API_KEY?.trim() || undefined;
  const from = process.env.EMAIL_FROM?.trim() || "noreply@example.com";
  const replyTo = process.env.EMAIL_REPLY_TO?.trim() || undefined;
  const logLevel = toLogLevel(process.env.EMAIL_LOG_LEVEL);

  const rawEnabled = String(process.env.EMAIL_SEND_ENABLED ?? "true").trim().toLowerCase();
  const enabled = rawEnabled !== "false";

  const provider: EmailProvider = resendApiKey ? "resend" : "console";

  return { provider, resendApiKey, from, replyTo, enabled, logLevel };
}
