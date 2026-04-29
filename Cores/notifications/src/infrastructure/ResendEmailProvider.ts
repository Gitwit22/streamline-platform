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
      data?: { id?: string } | null;
      error?: { message: string } | null;
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
export class ResendEmailProvider implements IEmailProvider {
  constructor(private readonly client: ResendClient) {}

  async send(message: EmailMessage): Promise<EmailResult> {
    const params: Parameters<ResendClient["emails"]["send"]>[0] = {
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
    };
    if (message.replyTo) {
      params.replyTo = message.replyTo;
    }

    const res = await this.client.emails.send(params);

    if (res.error) {
      return { ok: false, error: res.error.message };
    }

    return { ok: true, messageId: res.data?.id ?? undefined };
  }
}
