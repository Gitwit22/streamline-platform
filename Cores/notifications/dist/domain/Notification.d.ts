/**
 * Core notification domain types.
 * These are the canonical contracts for the email layer.
 */
export type EmailAddress = string;
export interface EmailMessage {
    to: EmailAddress;
    from: EmailAddress;
    subject: string;
    html: string;
    replyTo?: EmailAddress;
}
export interface EmailResult {
    ok: boolean;
    messageId?: string;
    error?: string;
}
/**
 * Minimal interface for an email sending provider (e.g. Resend, SMTP, console).
 * Accepts a pre-built client so that the provider stays dependency-free at the
 * package level — the consumer creates and injects the client.
 */
export interface IEmailProvider {
    send(message: EmailMessage): Promise<EmailResult>;
}
export interface IEmailLogger {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
}
