"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsoleEmailProvider = void 0;
/**
 * Development / test email provider that prints the message to stdout
 * instead of actually delivering it. Safe to use in any environment when
 * a real provider API key is not available.
 */
class ConsoleEmailProvider {
    async send(message) {
        process.stdout.write(JSON.stringify({
            type: "email:console",
            to: message.to,
            from: message.from,
            subject: message.subject,
            htmlLength: message.html.length,
        }) + "\n");
        return { ok: true, messageId: "console-noop" };
    }
}
exports.ConsoleEmailProvider = ConsoleEmailProvider;
