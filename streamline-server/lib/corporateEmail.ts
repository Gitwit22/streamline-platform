import {
  ConsoleEmailLogger,
  ResendEmailProvider,
  SendEmailUseCase,
  loadNotificationConfig,
} from "@nxtlvl/notification-core";

type InviteEmailInput = {
  to: string;
  inviteLink: string;
  role: string;
  orgName: string;
  expiresAtIso: string;
};

type InviteEmailResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  messageId?: string;
};

let emailUseCase: SendEmailUseCase | null = null;

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function ensureNotificationEnvDefaults() {
  if (!process.env.EMAIL_SEND_ENABLED) {
    process.env.EMAIL_SEND_ENABLED = "false";
  }

  if (!process.env.EMAIL_PROVIDER) {
    process.env.EMAIL_PROVIDER = "resend";
  }

  if (!process.env.EMAIL_FROM) {
    const fromName = String(process.env.EMAIL_FROM_NAME || "StreamLine").trim() || "StreamLine";
    const fromAddress =
      String(process.env.EMAIL_FROM_ADDRESS || "no-reply@nxtlvlts.com").trim() ||
      "no-reply@nxtlvlts.com";
    process.env.EMAIL_FROM = `${fromName} <${fromAddress}>`;
  }
}

function getEmailUseCase(): SendEmailUseCase {
  if (emailUseCase) return emailUseCase;

  ensureNotificationEnvDefaults();

  const provider = String(process.env.EMAIL_PROVIDER || "resend").trim().toLowerCase();
  if (provider !== "resend") {
    throw new Error(`Unsupported EMAIL_PROVIDER: ${provider}`);
  }

  const config = loadNotificationConfig();
  const logger = new ConsoleEmailLogger(config.logLevel);
  const resendProvider = new ResendEmailProvider(config);

  emailUseCase = new SendEmailUseCase({
    provider: resendProvider,
    config,
    logger,
  });

  return emailUseCase;
}

function buildInviteHtml(input: InviteEmailInput): string {
  return `
  <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5;">
    <p>Hello,</p>
    <p>You have been invited to join <strong>${input.orgName}</strong> on StreamLine Corporate.</p>
    <p>Role: <strong>${input.role}</strong></p>
    <p>
      <a href="${input.inviteLink}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;">
        Accept Invite
      </a>
    </p>
    <p>This invite expires on ${input.expiresAtIso}.</p>
    <p>If you did not expect this invite, you can safely ignore this message.</p>
    <p>StreamLine Team</p>
  </div>
  `;
}

function buildInviteText(input: InviteEmailInput): string {
  return [
    "Hello,",
    "",
    `You are invited to join ${input.orgName} on StreamLine Corporate.`,
    `Role: ${input.role}`,
    "",
    `Accept invite: ${input.inviteLink}`,
    `Invite expires on: ${input.expiresAtIso}`,
    "",
    "If you did not expect this invite, you can ignore this message.",
    "StreamLine Team",
  ].join("\n");
}

export async function sendCorporateInviteEmail(input: InviteEmailInput): Promise<InviteEmailResult> {
  if (!isValidEmail(input.to)) {
    return { ok: false, skipped: true, reason: "invalid_email" };
  }

  const emailSender = getEmailUseCase();
  const result = await emailSender.execute({
    to: input.to,
    subject: "You're invited to join StreamLine Corporate",
    html: buildInviteHtml(input),
    text: buildInviteText(input),
    programDomain: "streamline-corporate",
    organizationId: input.orgName,
    metadata: {
      type: "corporate_invite",
      role: input.role,
    },
  });

  if (result.success) {
    console.info("[corporate-invite-email] sent", {
      to: input.to,
      messageId: result.messageId,
    });
    return { ok: true, skipped: false, messageId: result.messageId };
  }

  if ("skipped" in result && result.skipped) {
    console.info("[corporate-invite-email] skipped", {
      to: input.to,
      reason: result.reason,
      payload: {
        subject: "You're invited to join StreamLine Corporate",
        orgName: input.orgName,
        role: input.role,
        inviteLink: input.inviteLink,
        expiresAtIso: input.expiresAtIso,
      },
    });
    return { ok: true, skipped: true, reason: result.reason };
  }

  if ("error" in result) {
    console.error("[corporate-invite-email] failed", {
      to: input.to,
      code: result.error.code,
      message: result.error.message,
    });

    return { ok: false, skipped: false, reason: result.error.code };
  }

  return { ok: false, skipped: false, reason: "unknown_error" };
}
