export const APP_BASE = (
  (import.meta.env.VITE_APP_BASE as string | undefined) ||
  (typeof window !== "undefined" ? window.location.origin : "") ||
  ""
).replace(/\/$/, "");
