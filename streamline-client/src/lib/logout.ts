import { clearEduLane } from "../edu/state/eduMode";
import { apiFetch, clearAuthStorage } from "../lib/api";

export async function logout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" }, { allowNonOk: true });
  } catch {
    // ignore network errors; we'll still clear client state
  }
  try {
    clearAuthStorage();
    clearEduLane();
  } catch {
    // best-effort
  }
}
