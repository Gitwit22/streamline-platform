import type { Request } from "express";
import jwt from "jsonwebtoken";

export type GuestSessionClaims = {
  inviteId: string;
  roomId: string;
  role: "guest" | "participant"; // guest = invite-based, participant = authenticated
  iat?: number;
  exp?: number;
};

function getGuestSessionSecret(): string {
  return process.env.GUEST_SESSION_SECRET || process.env.JWT_SECRET || "dev-secret";
}

export function signGuestSession(
  claims: Omit<GuestSessionClaims, "iat" | "exp">,
  expiresIn: jwt.SignOptions["expiresIn"]
): string {
  return jwt.sign(claims, getGuestSessionSecret(), { expiresIn });
}

function extractGuestSessionToken(req: Request): string | null {
  // 1. Check Authorization: Bearer header first (most secure, works everywhere)
  const authHeader = req.headers.authorization || (req.headers as any).Authorization;
  if (typeof authHeader === "string") {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }

  // 2. Check custom headers
  const hdr = (req.headers as any) || {};
  const fromHeader = hdr["x-guest-session"] ?? hdr["x-guest-session-token"];
  if (typeof fromHeader === "string" && fromHeader.trim()) return fromHeader.trim();

  // 3. Check request body
  const fromBody = (req as any)?.body?.guestSessionToken;
  if (typeof fromBody === "string" && fromBody.trim()) return fromBody.trim();

  // 4. Check query params (including 'gst' shorthand for invite links)
  const fromQuery = (req as any)?.query?.guestSessionToken || (req as any)?.query?.gst;
  if (typeof fromQuery === "string" && fromQuery.trim()) return fromQuery.trim();

  return null;
}

export function tryGetGuestSession(req: Request): GuestSessionClaims | null {
  const cookieToken = (req as any).cookies?.sl_guest;
  const token =
    typeof cookieToken === "string" && cookieToken.trim()
      ? cookieToken.trim()
      : extractGuestSessionToken(req);
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, getGuestSessionSecret()) as any;
    const inviteId = typeof decoded?.inviteId === "string" ? decoded.inviteId : "";
    const roomId = typeof decoded?.roomId === "string" ? decoded.roomId : "";
    // Backward compatibility: treat old "viewer" role as "guest" for /room flows
    // Normalize role: defensive parse, trim whitespace, lowercase
    const decodedRole = String(decoded?.role ?? "").trim().toLowerCase();
    let role: "guest" | "participant" | null = null;
    if (decodedRole === "guest" || decodedRole === "participant") {
      role = decodedRole as any;
    } else if (decodedRole === "viewer") {
      role = "guest"; // Map legacy "viewer" to "guest" for RTC participants
    }
    if (!inviteId || !roomId || !role) return null;
    return {
      inviteId,
      roomId,
      role,
      iat: typeof decoded?.iat === "number" ? decoded.iat : undefined,
      exp: typeof decoded?.exp === "number" ? decoded.exp : undefined,
    };
  } catch {
    return null;
  }
}
