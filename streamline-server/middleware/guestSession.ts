import type { Request, Response } from "express";
import jwt from "jsonwebtoken";

export type GuestSessionClaims = {
  inviteId: string;
  roomId: string;
  role: "guest" | "participant"; // guest = invite-based, participant = authenticated
  /** Display name persisted in the session so token refresh can recover it. */
  displayName?: string;
  /**
   * Stable LiveKit identity assigned when the session was created, so token
   * refreshes reconnect as the same participant instead of a new one.
   * Absent on sessions minted before this field existed.
   */
  identity?: string;
  iat?: number;
  exp?: number;
};

/** Guest sessions last this long; /token re-signs them on every refresh. */
export const GUEST_SESSION_TTL = "2h";
export const GUEST_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function getGuestSessionSecret(): string {
  const raw = String(process.env.GUEST_SESSION_SECRET || process.env.JWT_SECRET || "").trim();
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  if ((env === "production" || env === "staging") && (!raw || raw === "dev-secret")) {
    throw new Error("GUEST_SESSION_SECRET (or JWT_SECRET) must be set (no dev-secret in production)");
  }
  return raw || "dev-secret";
}

export function signGuestSession(
  claims: Omit<GuestSessionClaims, "iat" | "exp">,
  expiresIn: jwt.SignOptions["expiresIn"]
): string {
  // Drop undefined optional fields so they don't end up as nulls in the JWT.
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(claims)) {
    if (v !== undefined && v !== null && v !== "") payload[k] = v;
  }
  return jwt.sign(payload, getGuestSessionSecret(), { expiresIn });
}

/** Sets the HttpOnly sl_guest cookie with the same attributes everywhere. */
export function setGuestSessionCookie(res: Response, token: string): void {
  // SameSite=None in production for cross-site compatibility (FB/IG in-app
  // browsers); requires Secure. Local dev uses Lax since localhost is same-site.
  const isProduction = String(process.env.NODE_ENV || "development").toLowerCase() === "production";
  res.cookie("sl_guest", token, {
    httpOnly: true,
    sameSite: isProduction ? "none" : "lax",
    secure: isProduction,
    path: "/",
    maxAge: GUEST_SESSION_TTL_MS,
  });
}

function nonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Guest session token candidates in preference order: explicit header, body,
 * query (`gst` shorthand for invite links), then the sl_guest cookie. The
 * deprecated Authorization fallback is only consulted when nothing else is
 * present.
 */
function collectGuestSessionTokens(req: Request): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    const t = nonEmpty(v);
    if (t && !out.includes(t)) out.push(t);
  };

  const hdr = (req.headers as any) || {};
  push(hdr["x-guest-session"] ?? hdr["x-guest-session-token"]);
  push((req as any)?.body?.guestSessionToken);
  push((req as any)?.query?.guestSessionToken || (req as any)?.query?.gst);
  push((req as any)?.cookies?.sl_guest);

  if (out.length === 0) {
    // Deprecated fallback: Authorization: Bearer <guestSessionToken>.
    // Authorization is reserved for *user* auth; keep only for legacy clients.
    const allowDeprecated = process.env.ALLOW_DEPRECATED_AUTHZ_TOKENS !== "0";
    if (allowDeprecated) {
      const authHeader = req.headers.authorization || (req.headers as any).Authorization;
      if (typeof authHeader === "string") {
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        const token = match?.[1]?.trim();
        if (token) {
          const parsed = parseGuestSessionToken(token);
          if (parsed) {
            console.warn(
              "[deprecation] guest session provided via Authorization header; send x-guest-session or use sl_guest cookie instead"
            );
            out.push(token);
          }
        }
      }
    }
  }

  return out;
}

/** Verifies and normalizes one guest session JWT. Returns null when invalid. */
export function parseGuestSessionToken(token: string): GuestSessionClaims | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, getGuestSessionSecret()) as any;
    const inviteId = typeof decoded?.inviteId === "string" ? decoded.inviteId : "";
    const roomId = typeof decoded?.roomId === "string" ? decoded.roomId : "";
    // Backward compatibility: treat old "viewer" role as "guest" for /room flows
    const decodedRole = String(decoded?.role ?? "").trim().toLowerCase();
    let role: "guest" | "participant" | null = null;
    if (decodedRole === "guest" || decodedRole === "participant") {
      role = decodedRole as any;
    } else if (decodedRole === "viewer") {
      role = "guest";
    }
    if (!inviteId || !roomId || !role) return null;
    const displayName = typeof decoded?.displayName === "string" ? decoded.displayName.trim() : undefined;
    const identity = typeof decoded?.identity === "string" ? decoded.identity.trim() : undefined;
    return {
      inviteId,
      roomId,
      role,
      displayName: displayName || undefined,
      identity: identity || undefined,
      iat: typeof decoded?.iat === "number" ? decoded.iat : undefined,
      exp: typeof decoded?.exp === "number" ? decoded.exp : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Picks the session to use among valid candidates (already in preference
 * order). With a roomId, the first session scoped to that room wins, so a
 * stale cookie for another room can't shadow a valid header (or vice versa).
 * Without a match, the first valid session is returned and callers compare
 * roomId themselves.
 */
export function selectGuestSession(
  candidates: Array<GuestSessionClaims | null | undefined>,
  roomId?: string | null,
): GuestSessionClaims | null {
  const valid = candidates.filter((c): c is GuestSessionClaims => !!c);
  if (valid.length === 0) return null;
  const wanted = String(roomId || "").trim();
  if (wanted) {
    const match = valid.find((c) => c.roomId === wanted);
    if (match) return match;
  }
  return valid[0];
}

export function tryGetGuestSession(req: Request, roomId?: string | null): GuestSessionClaims | null {
  const tokens = collectGuestSessionTokens(req);
  if (tokens.length === 0) return null;
  return selectGuestSession(tokens.map(parseGuestSessionToken), roomId);
}
