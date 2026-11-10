/**
 * Transactional email (security-sensitive mail sent directly by StreamLine,
 * e.g. PPV access codes). Everything else goes through the commerce event
 * hooks → n8n.
 *
 * Provider: Resend REST API (no SDK dependency). Env (same names as the
 * corporate branch):
 *   EMAIL_PROVIDER       "resend" to send; anything else = stub (no send)
 *   EMAIL_SEND_ENABLED   "true" to send
 *   RESEND_API_KEY       Resend key (sending access)
 *   EMAIL_FROM           full "Name <addr>"  — or —
 *   EMAIL_FROM_NAME + EMAIL_FROM_ADDRESS
 *   EMAIL_REPLY_TO       optional
 *
 * Never logs message bodies or subjects (they can contain access codes);
 * recipients are masked in logs.
 */

export type EmailConfig = {
  enabled: boolean;
  provider: "resend" | "stub";
  apiKey: string | null;
  from: string | null;
  replyTo: string | null;
};

export function emailConfig(env: Record<string, string | undefined> = process.env): EmailConfig {
  const provider = String(env.EMAIL_PROVIDER || "").trim().toLowerCase() === "resend" ? "resend" : "stub";
  const sendFlag = String(env.EMAIL_SEND_ENABLED || "").trim().toLowerCase();
  const apiKey = String(env.RESEND_API_KEY || "").trim() || null;
  const explicitFrom = String(env.EMAIL_FROM || "").trim();
  const name = String(env.EMAIL_FROM_NAME || "").trim();
  const addr = String(env.EMAIL_FROM_ADDRESS || "").trim();
  const from = explicitFrom || (addr ? (name ? `${name} <${addr}>` : addr) : "") || null;
  const replyTo = String(env.EMAIL_REPLY_TO || "").trim() || null;
  const enabled = provider === "resend" && (sendFlag === "true" || sendFlag === "1") && !!apiKey && !!from;
  return { enabled, provider, apiKey, from, replyTo };
}

export function maskEmail(email: string): string {
  const [user, domain] = String(email || "").split("@");
  if (!domain) return "***";
  return `${(user || "").slice(0, 1)}***@${domain}`;
}

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; retryable: boolean; error: string };

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend dedupes sends with the same key for 24h. */
  idempotencyKey: string;
  /** Short label for logs (never the subject). */
  tag: string;
};

type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export async function sendTransactionalEmail(
  msg: EmailMessage,
  opts: { env?: Record<string, string | undefined>; fetchImpl?: FetchLike; timeoutMs?: number } = {}
): Promise<SendResult> {
  const cfg = emailConfig(opts.env);
  if (!cfg.enabled) return { ok: false, retryable: true, error: "email_disabled" };

  const doFetch: FetchLike = opts.fetchImpl || (fetch as any);
  try {
    const resp = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": msg.idempotencyKey,
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    let body: any = null;
    try {
      body = await resp.json();
    } catch {
      body = null;
    }
    if (resp.ok) {
      console.log("[email] sent", { tag: msg.tag, to: maskEmail(msg.to), id: body?.id ?? null });
      return { ok: true, id: typeof body?.id === "string" ? body.id : null };
    }
    // 4xx (except 409 idempotency-in-flight / 429) are permanent: bad address, unverified domain, bad key.
    const retryable = resp.status === 409 || resp.status === 429 || resp.status >= 500;
    const error = `resend_${resp.status}${body?.name ? `_${String(body.name).slice(0, 60)}` : ""}`;
    console.warn("[email] send failed", { tag: msg.tag, to: maskEmail(msg.to), status: resp.status, error });
    return { ok: false, retryable, error };
  } catch (err: any) {
    const error = err?.name === "TimeoutError" ? "timeout" : "network_error";
    console.warn("[email] send failed", { tag: msg.tag, to: maskEmail(msg.to), error });
    return { ok: false, retryable: true, error };
  }
}
