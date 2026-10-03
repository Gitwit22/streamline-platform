import { apiFetch, clearAuthStorage } from "../lib/api";
import { firebaseSignOut } from "./firebaseClient";
import { clearMeCache } from "./meCache";

export async function logout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" }, { allowNonOk: true });
  } catch {
    // ignore network errors; we'll still clear client state
  }
  // Firebase persists the signed-in user in IndexedDB; without this the next
  // apiFetchAuth call would still send a valid ID token for this account.
  await firebaseSignOut();
  try {
    clearMeCache();
    clearAuthStorage();
  } catch {
    // best-effort
  }
}
