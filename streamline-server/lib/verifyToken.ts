/**
 * Shared JWT verification helper.
 *
 * Reusable across Express middleware AND WebSocket upgrade handlers
 * without duplicating the secret / decode logic.
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
 * Verify a JWT string and return the decoded payload with a uid.
 * Throws if the token is invalid / expired / missing uid.
 */
export function verifyToken(raw: string): TokenPayload {
  if (!raw) throw new Error("empty_token");

  const decoded = jwt.verify(raw, getJwtSecret()) as Record<string, unknown>;
  const uid =
    typeof decoded?.uid === "string"
      ? decoded.uid
      : typeof decoded?.id === "string"
        ? decoded.id
        : "";

  if (!uid) throw new Error("token_missing_uid");

  return { ...decoded, uid };
}
