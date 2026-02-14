import { Request, Response, NextFunction } from "express";
import { firestore } from "../firebaseAdmin";

/**
 * Admin authentication middleware
 * Checks if the requesting user has admin privileges
 * 
 * Usage:
 *   router.get('/admin/users', requireAdmin, async (req, res) => { ... })
 */

// Extend Express Request type to include admin info
declare global {
  namespace Express {
    interface Request {
      adminUser?: {
        uid: string;
        email: string;
        isAdmin: boolean;
      };
    }
  }
}

/**
 * Check if user is an admin.
 *
 * New canonical source of truth is the user document:
 *   users/{uid}.admin.isAdmin === true OR users/{uid}.isAdmin === true
 * We still support the legacy /admins/{uid} collection as a fallback so
 * existing environments keep working.
 */
export async function isAdmin(uid: string): Promise<boolean> {
  try {
    console.log("[isAdmin] checking users/%s and admins/%s", uid, uid);
    const userDoc = await firestore.collection("users").doc(uid).get();
    const userData = userDoc.data() || {};

    const fromUserDoc = userData?.admin?.isAdmin === true || userData?.isAdmin === true;
    if (fromUserDoc) {
      // Minimal, non-sensitive signal that admin was resolved from user doc
      console.log("[isAdmin] resolved from user document");
      return true;
    }

    const adminDoc = await firestore.collection("admins").doc(uid).get();
    const fromLegacyAdmins = adminDoc.exists && adminDoc.data()?.isAdmin === true;
    if (fromLegacyAdmins) {
      console.log("[isAdmin] resolved from legacy admins collection");
    }
    return fromLegacyAdmins;
  } catch (error) {
    console.error("[isAdmin] firestore error", error);
    return false;
  }
}

/**
 * Middleware to require admin authentication
 * Expects JWT token in Authorization header or userId in request body
 */
import jwt from "jsonwebtoken";

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    let userId: string | null = null;
    let jwtSource = null;

    // 1. Try JWT in httpOnly cookie ('token')
    if (req.cookies && req.cookies.token) {
      try {
        const user = jwt.verify(req.cookies.token, process.env.JWT_SECRET || "dev-secret") as any;
        userId = user.uid || user.id || null;
        jwtSource = 'cookie';
      } catch (err) {
        console.warn('[requireAdmin] Invalid JWT in cookie:', err?.message || err);
      }
    }

    // 2. Try JWT in Authorization header
    if (!userId) {
      const authHeader = req.headers["authorization"] || req.headers["Authorization"];
      if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        try {
          const user = jwt.verify(token, process.env.JWT_SECRET || "dev-secret") as any;
          userId = user.uid || user.id || null;
          jwtSource = 'header';
        } catch (err) {
          console.warn('[requireAdmin] Invalid JWT in Authorization header:', err?.message || err);
        }
      }
    }

    // 3. Fallback: adminUserId in body or query
    if (!userId) {
      userId = (req.body && req.body.adminUserId) || (req.query && req.query.adminUserId) || null;
      if (userId) jwtSource = 'body/query';
    }

    // Minimal debug for tracing auth source without exposing user data
    console.log(`[requireAdmin] auth source: ${jwtSource || "none"}, path: ${req.path}`);

    if (!userId) {
      res.status(401).json({ error: "Missing admin user ID or valid token" });
      return;
    }

    console.log("[requireAdmin] resolved userId:", userId);

    const isAdminUser = await isAdmin(userId);
    if (!isAdminUser) {
      console.warn("[requireAdmin] admin privileges required");
      res.status(403).json({ error: "Admin privileges required" });
      return;
    }

    // Get admin user details
    let userData: any = {};
    try {
      const userDoc = await firestore.collection("users").doc(userId).get();
      userData = userDoc.data() || {};
    } catch {}

    req.adminUser = {
      uid: userId,
      email: userData.email || "unknown",
      isAdmin: true,
    };

    console.log(`[requireAdmin] admin access ok: ${req.method} ${req.path}`);

    next();
  } catch (error) {
    console.error("Admin middleware error:", error);
    res.status(500).json({ 
      error: "Internal server error",
      message: "Failed to verify admin status" 
    });
  }
}

/**
 * Helper function to grant admin privileges to a user
 * This should only be called by system administrators
 */
export async function grantAdminPrivileges(
  userId: string,
  grantedBy: string
): Promise<void> {
  await firestore.collection("admins").doc(userId).set({
    isAdmin: true,
    grantedBy,
    grantedAt: new Date(),
  });

  console.log(`Admin privileges granted to ${userId} by ${grantedBy}`);
}

/**
 * Helper function to revoke admin privileges
 */
export async function revokeAdminPrivileges(
  userId: string,
  revokedBy: string
): Promise<void> {
  await firestore.collection("admins").doc(userId).delete();

  console.log(`Admin privileges revoked from ${userId} by ${revokedBy}`);
}

/**
 * Middleware to log admin actions
 */
export async function logAdminAction(
  adminId: string,
  action: string,
  details: Record<string, any>
): Promise<void> {
  try {
    const safeDetails = Object.fromEntries(
      Object.entries(details || {}).filter(([, v]) => v !== undefined)
    );
    const ip = safeDetails.ip || "unknown";
    await firestore.collection("adminLogs").add({
      adminId,
      action,
      details: safeDetails,
      timestamp: new Date(),
      ip,
    });
  } catch (error) {
    console.error("Failed to log admin action:", error);
    // Don't throw - logging failure shouldn't break the operation
  }
}