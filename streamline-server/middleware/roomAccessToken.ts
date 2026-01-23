import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

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
};

function getRoomAccessSecret(): string {
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  const raw = process.env.ROOM_ACCESS_TOKEN_SECRET || process.env.JWT_SECRET || "";
  if ((env === "production" || env === "staging") && (!process.env.ROOM_ACCESS_TOKEN_SECRET || raw === "dev-secret")) {
    throw new Error("ROOM_ACCESS_TOKEN_SECRET must be set (no dev-secret in production)");
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
    throw new Error("room_token_required");
  }

  const roomId = String(access.roomId || "").trim();
  const livekitRoomName = String(access.livekitRoomName || "").trim();

  if (!roomId) {
    throw new Error("room_token_required");
  }
  if (!livekitRoomName) {
    throw new Error("livekit_room_missing");
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
      return res.status(401).json({ error: "room_token_required" });
    }

    const claims = verifyRoomAccessToken(raw);
    if (!claims || !claims.roomId) {
      return res.status(401).json({ error: "invalid_room_token" });
    }

    (req as any).roomAccess = claims;
    return next();
  } catch (err) {
    return res.status(401).json({ error: "invalid_room_token" });
  }
}
