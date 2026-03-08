/**
 * Minimal structured logger.
 *
 * Wraps console.{log,warn,error,info} with a leading JSON context
 * object so log lines are grep-friendly in Render / CloudWatch.
 */

function fmt(level: string, ctx: Record<string, unknown>, msg: string): string {
  const ts = new Date().toISOString();
  return JSON.stringify({ ts, level, ...ctx, msg });
}

export const logger = {
  info(ctx: Record<string, unknown>, msg: string): void {
    console.log(fmt("info", ctx, msg));
  },
  warn(ctx: Record<string, unknown>, msg: string): void {
    console.warn(fmt("warn", ctx, msg));
  },
  error(ctx: Record<string, unknown>, msg: string): void {
    console.error(fmt("error", ctx, msg));
  },
  debug(ctx: Record<string, unknown>, msg: string): void {
    if (process.env.LOG_LEVEL === "debug") {
      console.log(fmt("debug", ctx, msg));
    }
  },
};
