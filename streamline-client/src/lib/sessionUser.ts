import { apiFetchAuth } from "./api";

export function persistSessionUser(user: any) {
  if (typeof window === "undefined" || !user) return;
  try {
    window.localStorage.setItem("sl_user", JSON.stringify(user));
    const userId = String(user.id || user.uid || "").trim();
    if (userId) {
      window.localStorage.setItem("sl_userId", userId);
    }
    if (typeof user.displayName === "string") {
      window.localStorage.setItem("sl_displayName", user.displayName);
    }
  } catch {
    // ignore storage errors
  }
}

export async function refreshAndPersistAccountMe() {
  const res = await apiFetchAuth("/api/account/me", { cache: "no-store" });
  const data = await res.json();
  persistSessionUser(data);
  return data;
}