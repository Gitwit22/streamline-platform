import type { IEmailProvider, EmailMessage, EmailResult } from "../domain/Notification";

/**
 * Development / test email provider that prints the message to stdout
 * instead of actually delivering it. Safe to use in any environment when
 * a real provider API key is not available.
 */
export class ConsoleEmailProvider implements IEmailProvider {
  async send(message: EmailMessage): Promise<EmailResult> {
    process.stdout.write(
      JSON.stringify({
        type: "email:console",
        to: message.to,
        from: message.from,
        subject: message.subject,
        htmlLength: message.html.length,
      }) + "\n",
    );
    return { ok: true, messageId: "console-noop" };
  }
}
