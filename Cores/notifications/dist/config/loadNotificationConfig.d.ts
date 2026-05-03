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
export declare function loadNotificationConfig(): NotificationConfig;
