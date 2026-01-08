// StreamLine uses custom auth UID (JWT) as canonical user identity.
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token =
      (req as any).cookies?.token ||
      req.headers.authorization?.replace("Bearer ", "");

    if (!token) return res.status(401).json({ error: "Unauthorized" });

    // ✅ read env at runtime
    const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

    const decoded = jwt.verify(token, JWT_SECRET) as { uid: string };

    (req as any).user = { uid: decoded.uid };
    return next();
  } catch (err) {
    console.error("[requireAuth] Unauthorized:", (err as any)?.message || err);
    return res.status(401).json({ error: "Unauthorized" });
  }
}
