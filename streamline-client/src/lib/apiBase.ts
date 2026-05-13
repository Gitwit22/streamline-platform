const viteEnv = (import.meta as any)?.env as any | undefined;
const isProd = !!(viteEnv?.PROD);
const rawBase =
  viteEnv?.VITE_API_BASE ||
  (typeof process !== "undefined" ? (process as any)?.env?.VITE_API_BASE : undefined);

if (!rawBase && isProd) {
  // Surface the misconfiguration loudly so it isn't silently swallowed.
  // This is a console error rather than a throw so the rest of the page can
  // still render the error boundary / login screen instead of going blank.
  console.error(
    "[StreamLine] VITE_API_BASE is not set. " +
      "API calls will fail. Set the environment variable before deploying.",
  );
}

const envBase = rawBase || "https://streamline-backend2test.onrender.com";

export const API_BASE = String(envBase).replace(/\/$/, "");