/**
 * Lightweight JWT verification helper.
 *
 * Re-uses the same JWT_SECRET logic as requireAdmin, exposed as a
 * standalone function so non-Express callers (e.g. WebSocket upgrade
 * handlers) can verify tokens without pulling in Express types.
 */
import jwt from "jsonwebtoken";

function getJwtSecret(): string {
  const raw = String(process.env.JWT_SECRET || "").trim();
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  if ((env === "production" || env === "staging") && (!raw || raw === "dev-secret")) {
    throw new Error("Missing JWT_SECRET (no dev-secret in production)");
  }
  return raw || "dev-secret";
}

export interface TokenPayload {
  uid: string;
  [key: string]: unknown;
}

/**
 * Verify a JWT and return the decoded payload.
 * Throws if the token is invalid or expired.
 */
export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, getJwtSecret()) as Record<string, unknown>;
  const uid = (decoded.uid ?? decoded.id ?? decoded.sub) as string | undefined;
  if (!uid) throw new Error("Token missing uid");
  return { ...decoded, uid } as TokenPayload;
}
