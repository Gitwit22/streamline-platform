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
export declare class SendEmailUseCase {
    private readonly provider;
    private readonly logger;
    constructor(provider: IEmailProvider, logger: IEmailLogger);
    execute(message: EmailMessage): Promise<EmailResult>;
}
