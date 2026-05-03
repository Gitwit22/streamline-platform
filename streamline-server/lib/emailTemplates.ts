/**
 * StreamLine branded email templates.
 *
 * Each function returns the HTML body for a specific product event.
 * Template functions are pure — they take data and return a string.
 * They are consumed by emailService.sendEmail().
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const APP_NAME = "StreamLine";

function appUrl(): string {
  return (process.env.STREAMLINE_APP_URL || process.env.CLIENT_URL || "").replace(/\/$/, "");
}

function loginUrl(): string {
  const base = appUrl();
  return base ? `${base}/login` : "/login";
}

function baseHtml(content: string): string {
  return baseHtmlWithFooter(
    content,
    `You received this email because an account was created on ${APP_NAME}.<br />
    If you did not sign up, you can safely ignore this message.`,
  );
}

function baseHtmlWithFooter(content: string, footerText: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${APP_NAME}</title>
  <style>
    body { margin: 0; padding: 0; background: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .wrapper { max-width: 580px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; }
    .header { background: #111827; padding: 24px 32px; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -0.3px; }
    .body { padding: 32px; color: #374151; font-size: 15px; line-height: 1.6; }
    .body p { margin: 0 0 16px; }
    .cta { display: inline-block; margin: 8px 0 24px; padding: 12px 24px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px; }
    .divider { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    .footer { padding: 0 32px 32px; color: #9ca3af; font-size: 13px; }
    .footer a { color: #6b7280; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header"><h1>${APP_NAME}</h1></div>
    <div class="body">${content}</div>
    <hr class="divider" />
    <div class="footer">
      <p>${footerText}</p>
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Welcome email — self-service signup
// ---------------------------------------------------------------------------

export interface WelcomeEmailData {
  displayName?: string;
  email: string;
}

export function buildWelcomeEmail(data: WelcomeEmailData): { subject: string; html: string } {
  const name = data.displayName ? data.displayName.split(" ")[0] : data.email;
  const url = loginUrl();

  const content = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Welcome to ${APP_NAME}! Your account is ready.</p>
    <p>Sign in anytime at:</p>
    <a class="cta" href="${url}">Go to ${APP_NAME}</a>
    <p style="color:#6b7280;font-size:13px;">Signing in with: <strong>${escapeHtml(data.email)}</strong></p>
    <p>If you have any questions, reply to this email and we'll be happy to help.</p>
  `;

  return {
    subject: `Welcome to ${APP_NAME}`,
    html: baseHtml(content),
  };
}

// ---------------------------------------------------------------------------
// EDU welcome email — organisation top-admin creation
// ---------------------------------------------------------------------------

export interface EduWelcomeEmailData {
  displayName?: string;
  email: string;
  orgName: string;
}

export function buildEduWelcomeEmail(data: EduWelcomeEmailData): { subject: string; html: string } {
  const name = data.displayName ? data.displayName.split(" ")[0] : data.email;
  const url = loginUrl();

  const content = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your ${APP_NAME} administrator account for <strong>${escapeHtml(data.orgName)}</strong> has been created.</p>
    <p>Sign in to complete your organisation setup:</p>
    <a class="cta" href="${url}">Sign in to ${APP_NAME}</a>
    <p style="color:#6b7280;font-size:13px;">Signing in with: <strong>${escapeHtml(data.email)}</strong></p>
    <p>If you did not request this account, please contact support immediately.</p>
  `;

  return {
    subject: `Your ${APP_NAME} administrator account is ready`,
    html: baseHtml(content),
  };
}

// ---------------------------------------------------------------------------
// Password reset confirmation — sent after a successful self-service reset
// ---------------------------------------------------------------------------

export interface PasswordResetConfirmationEmailData {
  email: string;
  displayName?: string;
}

export function buildPasswordResetConfirmationEmail(
  data: PasswordResetConfirmationEmailData,
): { subject: string; html: string } {
  const name = data.displayName ? data.displayName.split(" ")[0] : data.email;
  const url = loginUrl();

  const content = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your ${APP_NAME} password was successfully changed.</p>
    <p>You can sign in with your new password at any time:</p>
    <a class="cta" href="${url}">Sign in to ${APP_NAME}</a>
    <p>If you did not make this change, please contact support immediately — someone may have access to your account.</p>
  `;

  return {
    subject: `Your ${APP_NAME} password has been changed`,
    html: baseHtmlWithFooter(
      content,
      "You received this security notice because a password change was completed on your account.",
    ),
  };
}

// ---------------------------------------------------------------------------
// Admin-enabled reset notification — sent when an admin unlocks password reset
// ---------------------------------------------------------------------------

export interface AdminResetNotificationEmailData {
  email: string;
  displayName?: string;
}

export function buildAdminResetNotificationEmail(
  data: AdminResetNotificationEmailData,
): { subject: string; html: string } {
  const name = data.displayName ? data.displayName.split(" ")[0] : data.email;
  const url = loginUrl();

  const content = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>An administrator has enabled a one-time password reset for your ${APP_NAME} account.</p>
    <p>Visit the sign-in page and use the <strong>Forgot password</strong> option to choose a new password:</p>
    <a class="cta" href="${url}">Go to sign-in</a>
    <p>This reset link will expire shortly. If you did not request this, please contact your administrator.</p>
  `;

  return {
    subject: `Action needed: reset your ${APP_NAME} password`,
    html: baseHtmlWithFooter(
      content,
      "You received this email because an administrator enabled a password reset for your account.",
    ),
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
