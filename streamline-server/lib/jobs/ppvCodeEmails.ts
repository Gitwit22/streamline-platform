/**
 * Retries guest PPV access-code emails that could not be sent at checkout
 * time (provider down, email not configured yet). Outbox: lib/ppvCodeEmail.ts.
 */
import { defineJob } from "./framework";
import { retryDueCodeEmails } from "../ppvCodeEmail";

export const ppvCodeEmailsJob = defineJob({
  name: "ppv-code-emails",
  title: "PPV Access-Code Emails",
  description: "Retries pending guest access-code emails (ppvCodeEmails outbox) with backoff; gives up after 6 attempts.",
  intervalMs: 5 * 60_000,
  highlight: "sent",
  async run(ctx) {
    const r = await retryDueCodeEmails(ctx.now.getTime());
    return { processed: r.attempted, details: { sent: r.sent, failed: r.failed, attempted: r.attempted } };
  },
});
