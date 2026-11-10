/**
 * PPV access-code email content + retry policy (pure; unit-tested).
 */

export function escapeHtml(v: string): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Shown exactly as the redeem form expects it (no separators: redeem hashes the raw string). */
export function formatCodeForDisplay(code: string): string {
  return String(code || "").toUpperCase();
}

export function buildAccessCodeEmail(input: {
  eventName: string;
  code: string;
  watchUrl: string | null;
  kind: "purchase" | "recovery";
}): { subject: string; html: string; text: string } {
  const name = String(input.eventName || "your event").slice(0, 200);
  const code = formatCodeForDisplay(input.code);
  const subject = input.kind === "recovery" ? `Your access code for ${name}` : `Your ticket for ${name}`;
  const intro =
    input.kind === "recovery"
      ? "Here is a new access code for your ticket. Any code we sent you before for this ticket no longer works."
      : "Thanks for your purchase. This device already has access. To watch on another device, enter this code on the event page.";
  const link = input.watchUrl;

  const text = [
    intro,
    "",
    `Event: ${name}`,
    `Access code: ${code}`,
    link ? `Watch: ${link}` : "",
    "",
    "Keep this code private: anyone with it can use your ticket.",
  ]
    .filter((l) => l !== null)
    .join("\n");

  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 12px">${escapeHtml(subject)}</h2>
<p>${escapeHtml(intro)}</p>
<p style="margin:16px 0 4px;color:#555">Access code</p>
<p style="font-size:24px;font-weight:bold;letter-spacing:3px;font-family:monospace;margin:0 0 16px">${escapeHtml(code)}</p>
${link ? `<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#dc2626;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Go to the event</a></p>` : ""}
<p style="color:#666;font-size:13px">Keep this code private: anyone with it can use your ticket.</p>
</body></html>`;

  return { subject, html, text };
}

export const CODE_EMAIL_MAX_ATTEMPTS = 6;

/** Backoff before the next attempt: 1, 5, 15, 30, 60 min. */
export function nextAttemptDelayMs(attempts: number): number {
  const steps = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];
  return steps[Math.min(Math.max(attempts, 1) - 1, steps.length - 1)];
}

export function isValidEmail(v: unknown): v is string {
  return typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
