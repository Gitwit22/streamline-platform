import type { IEmailProvider, IEmailLogger, EmailMessage, EmailResult } from "../domain/Notification";

/**
 * Orchestrates a single email send operation.
 *
 * Responsibilities:
 *   - Delegates delivery to the injected IEmailProvider
 *   - Logs send attempts, results, and errors via IEmailLogger
 *   - Wraps the provider call in a try/catch so errors always return
 *     a structured result rather than throwing
 *
 * This use case does NOT validate the email address — callers must
 * validate before invoking (use `isValidEmail` from the helpers module).
 */
export class SendEmailUseCase {
  constructor(
    private readonly provider: IEmailProvider,
    private readonly logger: IEmailLogger,
  ) {}

  async execute(message: EmailMessage): Promise<EmailResult> {
    try {
      this.logger.info("Sending email", { to: message.to, subject: message.subject });

      const result = await this.provider.send(message);

      if (result.ok) {
        this.logger.info("Email sent", { to: message.to, messageId: result.messageId ?? "unknown" });
      } else {
        this.logger.warn("Email send failed", { to: message.to, error: result.error ?? "unknown" });
      }

      return result;
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error("Email send threw unexpected error", { to: message.to, error });
      return { ok: false, error };
    }
  }
}
