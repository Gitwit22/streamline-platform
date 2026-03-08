const viteEnv = (import.meta as any)?.env as any | undefined;
const envBase =
  viteEnv?.VITE_API_BASE ||
  (typeof process !== "undefined" ? (process as any)?.env?.VITE_API_BASE : undefined) ||
  "https://streamline-backend2test.onrender.com";

export const API_BASE = String(envBase).replace(/\/$/, "");