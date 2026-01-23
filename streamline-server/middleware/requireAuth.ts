// StreamLine uses custom auth UID (JWT) as canonical user identity.
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getUserAccount } from "../lib/userAccount";

type AuthUser = { uid: string };

export type InviteClaims = {
  roomId?: string;
  roomName?: string;
  room?: string;
  identity?: string;
  uid?: string;
  sub?: string;
  role?: string;
  createdByUid?: string;
};

function getJwtSecret() {
  return process.env.JWT_SECRET || "dev-secret";
}

// Server-side auth debug gate.
//
// AUTH_DEBUG=1 enables additional auth logging on the server.
// For extra safety, detailed per-request auth debug should also
// require a header like `x-debug-auth: 1`.
//
// By default (prod), this remains off.
const AUTH_DEBUG_ENABLED = process.env.AUTH_DEBUG === "1";

function shouldLogAuthDebug(req: Request): boolean {
  if (!AUTH_DEBUG_ENABLED) return false;
  const header = String(req.headers["x-debug-auth"] || "").toLowerCase();
  return header === "1" || header === "true" || header === "yes";
}

export function tryGetAuthUser(req: Request): AuthUser | null {
  const headerAuth = req.headers.authorization;
  const headerToken =
    typeof headerAuth === "string"
      ? headerAuth.replace(/^Bearer\s+/i, "")
      : undefined;
  const cookieToken = (req as any).cookies?.token;

  // Track auth decisions for downstream middleware/routes.
  // This enables the server to tell the client when a stale header
  // token was ignored and the cookie session was used instead.
  (req as any)._authUsed = undefined;
  (req as any)._authHeaderInvalid = false;

  // Prefer Authorization header, but only if it verifies.
  // If a client accidentally sends a stale/invalid header token,
  // fall back to the cookie token so valid sessions don't get rejected.
  if (headerToken) {
    try {
      const decoded = jwt.verify(headerToken, getJwtSecret()) as any;
      const uid = typeof decoded?.uid === "string" ? decoded.uid : "";
      if (uid) {
        if (shouldLogAuthDebug(req)) {
          console.log("[auth-debug] Verified header JWT for uid", uid);
        }
        (req as any)._authUsed = "header";
        return { uid };
      }
      if (shouldLogAuthDebug(req)) {
        console.warn("[auth-debug] Header JWT verified but missing uid; falling back to cookie");
      }
      (req as any)._authHeaderInvalid = true;
    } catch (err: any) {
      if (shouldLogAuthDebug(req)) {
        console.warn("[auth-debug] Header JWT invalid, falling back to cookie:", err?.message || err);
      }
      (req as any)._authHeaderInvalid = true;
    }
  }

  if (cookieToken) {
    try {
      const decoded = jwt.verify(cookieToken, getJwtSecret()) as any;
      const uid = typeof decoded?.uid === "string" ? decoded.uid : "";
      if (uid) {
        if (shouldLogAuthDebug(req)) {
          console.log("[auth-debug] Verified cookie JWT for uid", uid);
        }
        (req as any)._authUsed = "cookie";
        return { uid };
      }
      if (shouldLogAuthDebug(req)) {
        console.warn("[auth-debug] Cookie JWT verified but missing uid");
      }
    } catch (err: any) {
      if (shouldLogAuthDebug(req)) {
        console.warn("[auth-debug] Cookie JWT invalid:", err?.message || err);
      }
    }
  }

  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = tryGetAuthUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    // If the request included a bad/stale Authorization header but a valid
    // cookie session exists, tell the client so it can clear its cached token.
    // Note: this header must be exposed via CORS for cross-origin clients.
    if ((req as any)._authUsed === "cookie" && (req as any)._authHeaderInvalid) {
      res.setHeader("x-sl-auth-fallback", "cookie");
      res.setHeader("x-sl-auth-header-invalid", "1");
    }

    if (shouldLogAuthDebug(req)) {
      console.log("[auth-debug] requireAuth ok", { uid: user.uid, path: req.path, method: req.method });
    }
    (req as any).user = user;

    // Attach normalized account to the request so downstream routes and
    // feature checks can reuse it instead of calling getUserAccount(uid)
    // multiple times per request.
    try {
      const account = await getUserAccount(user.uid);
      (req as any).account = account;
    } catch (err) {
      console.error("[requireAuth] getUserAccount failed:", (err as any)?.message || err);
      // Continue without req.account; callers can still compute it on demand.
    }

    return next();
  } catch (err) {
    console.error("[requireAuth] Unauthorized:", (err as any)?.message || err);
    return res.status(401).json({ error: "Unauthorized" });
  }
}

export function verifyInviteToken(rawInviteToken: string): InviteClaims {
  const secret = process.env.INVITE_TOKEN_SECRET || getJwtSecret();
  if (!secret) {
    throw new Error("Invite token secret not configured");
  }
  const decoded = jwt.verify(rawInviteToken, secret) as InviteClaims;
  return decoded;
}

export function requireAuthOrInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const user = tryGetAuthUser(req);
    if (user) {
      (req as any).user = user;
      // If caller also provided an invite token, validate it and attach claims.
      // This enables authenticated cohost/mod flows to be authorized by invite.
      const inviteToken =
        (req.headers["x-invite-token"] as string | undefined) ||
        (req.body as any)?.inviteToken ||
        (req.query as any)?.inviteToken;

      if (inviteToken) {
        try {
          const claims = verifyInviteToken(inviteToken);
          (req as any).invite = claims;
        } catch (err) {
          console.warn("[requireAuthOrInvite] Provided invite token invalid for authed request");
          // ignore invalid invite token when user is authenticated
        }
      }

      return next();
    }
  } catch (err) {
    // continue to invite token validation
    console.warn("[requireAuthOrInvite] Auth token invalid, checking invite token");
  }

  const inviteToken =
    (req.headers["x-invite-token"] as string | undefined) ||
    (req.body as any)?.inviteToken ||
    (req.query as any)?.inviteToken;

  if (!inviteToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const claims = verifyInviteToken(inviteToken);
    (req as any).invite = claims;
    return next();
  } catch (err) {
    console.error("[requireAuthOrInvite] Invite token invalid:", (err as any)?.message || err);
    return res.status(401).json({ error: "Unauthorized" });
  }
}
