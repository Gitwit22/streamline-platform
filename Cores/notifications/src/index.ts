// Domain
export type { EmailAddress, EmailMessage, EmailResult, IEmailProvider, IEmailLogger } from "./domain/Notification";

// Helpers
export { isValidEmail, normalizeEmail } from "./helpers/validateEmail";

// Config
export type { NotificationConfig, EmailLogLevel, EmailProvider } from "./config/loadNotificationConfig";
export { loadNotificationConfig } from "./config/loadNotificationConfig";

// Infrastructure
export { ConsoleEmailLogger } from "./infrastructure/ConsoleEmailLogger";
export { ConsoleEmailProvider } from "./infrastructure/ConsoleEmailProvider";
export type { ResendClient } from "./infrastructure/ResendEmailProvider";
export { ResendEmailProvider } from "./infrastructure/ResendEmailProvider";

// Application
export { SendEmailUseCase } from "./application/SendEmailUseCase";
