/**
 * StreamLine email service.
 *
 * This module is the single point of integration between StreamLine and
 * the shared @cores/notifications email layer.
 *
 * Responsibilities of THIS file:
 *   - Read configuration via loadNotificationConfig()
 *   - Construct the correct provider (Resend or console) and inject the
 *     Resend client so that @cores/notifications stays dependency-free
 *   - Expose a sendEmail() function that StreamLine routes call
 *   - Validate the recipient address before attempting a send
 *   - Never throw — always return a structured EmailResult
 *   - Never log passwords, tokens, or full auth credentials
 *
 * What this file does NOT do:
 *   - Build email templates (see emailTemplates.ts)
 *   - Duplicate provider / Resend / validation logic from @cores/notifications
 *   - Expose any email secrets to the client
 */

import {
  loadNotificationConfig,
  SendEmailUseCase,
  ResendEmailProvider,
  ConsoleEmailProvider,
  ConsoleEmailLogger,
  isValidEmail,
  normalizeEmail,
  type EmailMessage,
  type EmailResult,
} from "@cores/notifications";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Lazy-initialised singleton use-case instance
// ---------------------------------------------------------------------------

let _useCase: SendEmailUseCase | null = null;

function buildUseCase(): SendEmailUseCase {
  const config = loadNotificationConfig();
  const emailLogger = new ConsoleEmailLogger(config.logLevel);

  let provider;
  if (config.provider === "resend" && config.resendApiKey) {
    // Resend client is created here in the server so @cores/notifications
    // has no runtime dependency on the resend npm package.
    const { Resend } = require("resend") as typeof import("resend");
    provider = new ResendEmailProvider(new Resend(config.resendApiKey));
  } else {
    provider = new ConsoleEmailProvider();
  }

  return new SendEmailUseCase(provider, emailLogger);
}

function getUseCase(): SendEmailUseCase {
  if (!_useCase) {
    _useCase = buildUseCase();
  }
  return _useCase;
}

// Exported only for tests so they can reset the singleton.
export function _resetEmailServiceForTests(): void {
  _useCase = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send a StreamLine email.
 *
 * - Validates and normalises the recipient address.
 * - Respects EMAIL_SEND_ENABLED=false without hitting the provider.
 * - Always resolves; never throws.
 * - Logs failures server-side but returns a clean result to callers.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<EmailResult> {
  const { to, subject, html } = opts;

  // Validate before doing anything else
  if (!isValidEmail(to)) {
    logger.warn({ to }, "emailService: skipping send — invalid recipient address");
    return { ok: false, error: "invalid_recipient" };
  }

  const config = loadNotificationConfig();

  // Feature-flag: EMAIL_SEND_ENABLED=false disables all sending
  if (!config.enabled) {
    logger.info({ to }, "emailService: email sending is disabled (EMAIL_SEND_ENABLED=false)");
    return { ok: true, messageId: "disabled" };
  }

  const normalised = normalizeEmail(to);

  const message: EmailMessage = {
    to: normalised,
    from: config.from,
    subject,
    html,
    ...(config.replyTo ? { replyTo: config.replyTo } : {}),
  };

  try {
    const result = await getUseCase().execute(message);
    if (!result.ok) {
      // Log structured error server-side; do not expose provider details to callers
      logger.error({ to: normalised, subject }, "emailService: send failed — " + (result.error ?? "unknown"));
    }
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ to: normalised }, "emailService: unexpected error — " + msg);
    return { ok: false, error: "internal_error" };
  }
}
