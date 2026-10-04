/**
 * users/{uid}.lastActiveAt writer (throttled; see lib/activityThrottle.ts).
 *
 * Fire-and-forget: never throws, never blocks the request. Read by
 * GET /api/admin/stats (count() where lastActiveAt >= X) and the admin
 * user detail view.
 */
import { firestore } from "../firebaseAdmin";
import { buildActivityPatch, createActivityThrottle } from "./activityThrottle";

const throttle = createActivityThrottle();

export function touchUserActivity(uid: string, userDoc: any, nowMs: number = Date.now()): void {
  try {
    if (!uid || !throttle.shouldWrite(uid, nowMs)) return;
    const patch = buildActivityPatch(userDoc, nowMs);
    void firestore
      .collection("users")
      .doc(uid)
      .set(patch, { merge: true })
      .catch((err: any) => {
        throttle.forget(uid);
        console.warn("[activity] lastActiveAt write failed:", err?.message || err);
      });
  } catch (err: any) {
    console.warn("[activity] touch failed:", err?.message || err);
  }
}
