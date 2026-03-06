import { clearEduLane } from "../edu/state/eduMode";
import { apiFetch, clearAuthStorage } from "../lib/api";
import { getFirebaseAuth } from "./firebaseClient";

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
  // Sign out of Firebase so firebaseAuthed flips to false and
  // protected-route guards redirect to the login screen.
  try {
    const auth = getFirebaseAuth();
    await auth.signOut();
  } catch {
    // Firebase may not be configured — ignore.
  }
}
