import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";

export type RoomAccessClaims = {
  roomId: string;
  // Optional human/display label for the room.
  roomName?: string;
  // Canonical LiveKit room name used for RoomService/egress calls.
  // This must always match the actual LiveKit room key, even if
  // roomName is repurposed as a human display label.
  livekitRoomName: string;
  role: "host" | "participant" | "cohost" | "viewer";
  permissions?: Record<string, boolean>;
  // LiveKit identity for the caller inside the room. Used to
  // bind room-level permissions to per-participant controls docs.
  identity: string;
  // True when the caller was elevated to host due to internal-admin override.
  // Useful for client UX decisions (e.g., avoid ending the room when an admin leaves).
  adminOverride?: boolean;
};

function getRoomAccessSecret(): string {
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  const explicit = process.env.ROOM_ACCESS_TOKEN_SECRET;
  const fallback = process.env.JWT_SECRET;
  const raw = String(explicit || fallback || "").trim();

  // In production/staging we require a real secret, but we allow falling back to
  // JWT_SECRET for backwards compatibility with older deployments.
  if (env === "production" || env === "staging") {
    if (!raw || raw === "dev-secret") {
      throw new Error("ROOM_ACCESS_TOKEN_SECRET (or JWT_SECRET) must be set (no dev-secret in production)");
    }
    if (!explicit && process.env.AUTH_DEBUG === "1") {
      console.warn("[roomAccessToken] Using JWT_SECRET fallback for ROOM_ACCESS_TOKEN_SECRET");
    }
  }

  return raw || "dev-secret";
}

export function verifyRoomAccessToken(rawToken: string): RoomAccessClaims {
  const decoded = jwt.verify(rawToken, getRoomAccessSecret());
  return decoded as RoomAccessClaims;
}

export function getRoomAccess(req: any): { access: RoomAccessClaims; roomId: string; livekitRoomName: string } {
  const access = (req as any)?.roomAccess as RoomAccessClaims | undefined;
  if (!access || !access.roomId) {
    throw new Error(PERMISSION_ERRORS.ROOM_TOKEN_REQUIRED);
  }

  const roomId = String(access.roomId || "").trim();
  const livekitRoomName = String(access.livekitRoomName || "").trim();

  if (!roomId) {
    throw new Error(PERMISSION_ERRORS.ROOM_TOKEN_REQUIRED);
  }
  if (!livekitRoomName) {
    throw new Error(PERMISSION_ERRORS.LIVEKIT_ROOM_MISSING);
  }

  if (process.env.AUTH_DEBUG === "1") {
    console.log("[roomAccess-debug] getRoomAccess", {
      roomId,
      livekitRoomName,
      identity: access.identity,
      role: access.role,
    });
  }

  return { access, roomId, livekitRoomName };
}

export function extractRoomAccessToken(req: Request): string | null {
  // 1) Explicit room-access header wins.
  const explicit = (req.headers as any)["x-room-access-token"] ?? (req.headers as any)["X-Room-Access-Token"];
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }

  // 2) Legacy query param fallback (primarily for SSE/EventSource where
  // attaching headers is awkward). Safe because this is always scoped
  // to a single room access token.
  const fromQuery = (req.query as any)?.t as string | undefined;
  if (typeof fromQuery === "string" && fromQuery.trim()) {
    return fromQuery.trim();
  }

  // 3) Legacy Authorization: Bearer <token> fallback. Only used when
  // neither the explicit header nor query param are present so that
  // user auth headers never override a dedicated room access header.
  const auth = (req.headers as any).authorization as string | undefined;
  if (typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) return m[1].trim();
  }

  return null;
}

export function requireRoomAccessToken(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = extractRoomAccessToken(req);
    if (!raw) {
      return res.status(401).json({ error: PERMISSION_ERRORS.ROOM_TOKEN_REQUIRED });
    }

    const claims = verifyRoomAccessToken(raw);
    if (!claims || !claims.roomId) {
      return res.status(401).json({ error: PERMISSION_ERRORS.INVALID_ROOM_TOKEN });
    }

    (req as any).roomAccess = claims;
    return next();
  } catch (err) {
    return res.status(401).json({ error: PERMISSION_ERRORS.INVALID_ROOM_TOKEN });
  }
}
