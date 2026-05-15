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

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function ensureEmailEnvDefaults() {
  if (!process.env.EMAIL_SEND_ENABLED) {
    process.env.EMAIL_SEND_ENABLED = "false";
  }

  if (!process.env.EMAIL_PROVIDER) {
    process.env.EMAIL_PROVIDER = "stub";
  }

  if (!process.env.EMAIL_FROM) {
    const fromName = String(process.env.EMAIL_FROM_NAME || "StreamLine").trim() || "StreamLine";
    const fromAddress =
      String(process.env.EMAIL_FROM_ADDRESS || "no-reply@nxtlvlts.com").trim() ||
      "no-reply@nxtlvlts.com";
    process.env.EMAIL_FROM = `${fromName} <${fromAddress}>`;
  }
}

function shouldSendEmails(): boolean {
  ensureEmailEnvDefaults();
  return String(process.env.EMAIL_SEND_ENABLED || "false").trim().toLowerCase() === "true";
}

function getEmailProvider(): string {
  ensureEmailEnvDefaults();
  return String(process.env.EMAIL_PROVIDER || "stub").trim().toLowerCase();
}

function getEmailFrom(): string {
  ensureEmailEnvDefaults();
  return String(process.env.EMAIL_FROM || "StreamLine <no-reply@nxtlvlts.com>").trim();
}

function getReplyTo(): string | undefined {
  const value = String(process.env.EMAIL_REPLY_TO || "").trim();
  return value || undefined;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildInviteHtml(input: InviteEmailInput): string {
  return `
  <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5;">
    <p>Hello,</p>
    <p>You have been invited to join <strong>${escapeHtml(input.orgName)}</strong> on StreamLine Corporate.</p>
    <p>Role: <strong>${escapeHtml(input.role)}</strong></p>
    <p>
      <a href="${escapeHtml(input.inviteLink)}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;">
        Accept Invite
      </a>
    </p>
    <p>This invite expires on ${escapeHtml(input.expiresAtIso)}.</p>
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

async function sendViaResend(input: InviteEmailInput): Promise<InviteEmailResult> {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) {
    return { ok: false, skipped: false, reason: "missing_resend_api_key" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: getEmailFrom(),
      to: [input.to],
      reply_to: getReplyTo(),
      subject: "You're invited to join StreamLine Corporate",
      html: buildInviteHtml(input),
      text: buildInviteText(input),
      tags: [
        { name: "type", value: "corporate_invite" },
        { name: "role", value: input.role },
      ],
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String((body as any)?.message || (body as any)?.error || "resend_request_failed");
    return { ok: false, skipped: false, reason: message };
  }

  return {
    ok: true,
    skipped: false,
    messageId: String((body as any)?.id || ""),
  };
}

export async function sendCorporateInviteEmail(input: InviteEmailInput): Promise<InviteEmailResult> {
  if (!isValidEmail(input.to)) {
    return { ok: false, skipped: true, reason: "invalid_email" };
  }

  if (!shouldSendEmails() || getEmailProvider() === "stub") {
    console.info("[corporate-invite-email] skipped", {
      to: input.to,
      reason: shouldSendEmails() ? "stub_provider" : "email_send_disabled",
      payload: {
        subject: "You're invited to join StreamLine Corporate",
        orgName: input.orgName,
        role: input.role,
        inviteLink: input.inviteLink,
        expiresAtIso: input.expiresAtIso,
      },
    });
    return { ok: true, skipped: true, reason: shouldSendEmails() ? "stub_provider" : "email_send_disabled" };
  }

  if (getEmailProvider() !== "resend") {
    return { ok: false, skipped: false, reason: `unsupported_email_provider:${getEmailProvider()}` };
  }

  const result = await sendViaResend(input);
  if (result.ok) {
    console.info("[corporate-invite-email] sent", {
      to: input.to,
      messageId: result.messageId,
    });
    return result;
  }

  if (result.reason) {
    console.error("[corporate-invite-email] failed", {
      to: input.to,
      reason: result.reason,
    });
  }

  return result.ok ? result : { ok: false, skipped: false, reason: result.reason || "unknown_error" };
}
