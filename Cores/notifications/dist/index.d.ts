export type { EmailAddress, EmailMessage, EmailResult, IEmailProvider, IEmailLogger } from "./domain/Notification";
export { isValidEmail, normalizeEmail } from "./helpers/validateEmail";
export type { NotificationConfig, EmailLogLevel, EmailProvider } from "./config/loadNotificationConfig";
export { loadNotificationConfig } from "./config/loadNotificationConfig";
export { ConsoleEmailLogger } from "./infrastructure/ConsoleEmailLogger";
export { ConsoleEmailProvider } from "./infrastructure/ConsoleEmailProvider";
export type { ResendClient } from "./infrastructure/ResendEmailProvider";
export { ResendEmailProvider } from "./infrastructure/ResendEmailProvider";
export { SendEmailUseCase } from "./application/SendEmailUseCase";
