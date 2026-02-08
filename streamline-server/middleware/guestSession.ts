import type { Request } from "express";
import jwt from "jsonwebtoken";

export type GuestSessionClaims = {
  inviteId: string;
  roomId: string;
  role: "viewer" | "participant";
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
  const hdr = (req.headers as any) || {};
  const fromHeader = hdr["x-guest-session"] ?? hdr["x-guest-session-token"];
  if (typeof fromHeader === "string" && fromHeader.trim()) return fromHeader.trim();

  const fromBody = (req as any)?.body?.guestSessionToken;
  if (typeof fromBody === "string" && fromBody.trim()) return fromBody.trim();

  const fromQuery = (req as any)?.query?.guestSessionToken;
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
    const role = decoded?.role === "viewer" || decoded?.role === "participant" ? (decoded.role as any) : null;
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
