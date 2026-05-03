import type { IEmailProvider, EmailMessage, EmailResult } from "../domain/Notification";
/**
 * Minimal interface describing the parts of the Resend client we need.
 * The actual `Resend` class from the `resend` npm package satisfies this
 * interface — the consumer creates the client and injects it here so that
 * this Core package has zero runtime dependencies of its own.
 */
export interface ResendClient {
    emails: {
        send(params: {
            from: string;
            to: string;
            subject: string;
            html: string;
            replyTo?: string;
        }): Promise<{
            data?: {
                id?: string;
            } | null;
            error?: {
                message: string;
            } | null;
        }>;
    };
}
/**
 * Email provider backed by Resend (https://resend.com).
 *
 * Usage:
 *   import { Resend } from "resend";
 *   const provider = new ResendEmailProvider(new Resend(apiKey));
 */
export declare class ResendEmailProvider implements IEmailProvider {
    private readonly client;
    constructor(client: ResendClient);
    send(message: EmailMessage): Promise<EmailResult>;
}
