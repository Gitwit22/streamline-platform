/**
 * ARCHITECTURAL RULE: cleanup is never blocked by entitlement.
 *
 *   CREATE / USE              -> requires entitlement (plan feature + platform switch + limit)
 *   READ / EXPORT OWN DATA    -> normally allowed
 *   DELETE / CLEANUP          -> ALWAYS allowed, regardless of plan, feature
 *                                flags, kill switches or PLATFORM_TRANSCODE_ENABLED
 *                                (delete recording / project / asset / stream key /
 *                                destination, revoke collaborator, download owned data)
 *
 * Small pure helpers for routes whose cleanup paths share a router-level gate.
 */

/** Collaborator routes that must work even when collaboratorDelegationEnabled is off. */
export function isCollaboratorCleanupRoute(method: string, path: string): boolean {
  const m = String(method || "").toUpperCase();
  const p = String(path || "").replace(/\/+$/, "");
  if (m === "GET" && p === "/me") return true; // read own relationships
  if (m === "POST" && /^\/[^/]+\/(decline|revoke)$/.test(p)) return true; // decline / leave / revoke
  return false;
}

/**
 * A destination update that only turns it off and/or clears its stored stream
 * key (`{ enabled: false }`, `{ streamKeyPlain: "" }`, `{ streamKeyEnc: null }`)
 * is cleanup. Anything else (enable, rename, new key) is use.
 */
export function isDisableOnlyUpdate(updates: Record<string, unknown> | null | undefined): boolean {
  const u = updates && typeof updates === "object" ? updates : {};
  const keys = Object.keys(u).filter((k) => u[k] !== undefined);
  if (keys.length === 0) return false;
  return keys.every(
    (k) =>
      (k === "enabled" && u.enabled === false) ||
      (k === "streamKeyPlain" && u.streamKeyPlain === "") ||
      (k === "streamKeyEnc" && u.streamKeyEnc === null)
  );
}
