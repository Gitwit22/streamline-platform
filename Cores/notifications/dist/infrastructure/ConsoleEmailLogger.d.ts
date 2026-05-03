import type { IEmailLogger } from "../domain/Notification";
/**
 * Simple structured logger that writes to stdout/stderr.
 * Used as the default logger in all environments where a custom
 * structured logger has not been injected.
 */
export declare class ConsoleEmailLogger implements IEmailLogger {
    private readonly minLevel;
    constructor(level?: string);
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
    private allowed;
}
