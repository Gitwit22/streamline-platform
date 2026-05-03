import type { IEmailProvider, EmailMessage, EmailResult } from "../domain/Notification";
/**
 * Development / test email provider that prints the message to stdout
 * instead of actually delivering it. Safe to use in any environment when
 * a real provider API key is not available.
 */
export declare class ConsoleEmailProvider implements IEmailProvider {
    send(message: EmailMessage): Promise<EmailResult>;
}
