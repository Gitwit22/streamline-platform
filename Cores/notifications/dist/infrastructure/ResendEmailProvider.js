"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResendEmailProvider = void 0;
/**
 * Email provider backed by Resend (https://resend.com).
 *
 * Usage:
 *   import { Resend } from "resend";
 *   const provider = new ResendEmailProvider(new Resend(apiKey));
 */
class ResendEmailProvider {
    client;
    constructor(client) {
        this.client = client;
    }
    async send(message) {
        const params = {
            from: message.from,
            to: message.to,
            subject: message.subject,
            html: message.html,
        };
        if (message.replyTo) {
            params.replyTo = message.replyTo;
        }
        const res = await this.client.emails.send(params);
        if (res.error) {
            return { ok: false, error: res.error.message };
        }
        return { ok: true, messageId: res.data?.id ?? undefined };
    }
}
exports.ResendEmailProvider = ResendEmailProvider;
