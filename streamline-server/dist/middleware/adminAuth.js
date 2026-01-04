"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdmin = requireAdmin;
exports.grantAdminPrivileges = grantAdminPrivileges;
exports.revokeAdminPrivileges = revokeAdminPrivileges;
exports.logAdminAction = logAdminAction;
const firebaseAdmin_1 = require("../firebaseAdmin");
/**
 * Check if user is an admin
 * Admin status is stored in Firestore under /admins/{uid}
 */
async function isAdmin(uid) {
    try {
        const adminDoc = await firebaseAdmin_1.firestore.collection("admins").doc(uid).get();
        return adminDoc.exists && adminDoc.data()?.isAdmin === true;
    }
    catch (error) {
        console.error("Error checking admin status:", error);
        return false;
    }
}
/**
 * Middleware to require admin authentication
 * Expects JWT token in Authorization header or userId in request body
 */
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
async function requireAdmin(req, res, next) {
    try {
        let userId = null;
        let jwtSource = null;
        // 1. Try JWT in httpOnly cookie ('token')
        if (req.cookies && req.cookies.token) {
            try {
                const user = jsonwebtoken_1.default.verify(req.cookies.token, process.env.JWT_SECRET || "dev-secret");
                userId = user.uid || user.id || null;
                jwtSource = 'cookie';
            }
            catch (err) {
                console.warn('[requireAdmin] Invalid JWT in cookie:', err?.message || err);
            }
        }
        // 2. Try JWT in Authorization header
        if (!userId) {
            const authHeader = req.headers["authorization"] || req.headers["Authorization"];
            if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
                const token = authHeader.substring(7);
                try {
                    const user = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET || "dev-secret");
                    userId = user.uid || user.id || null;
                    jwtSource = 'header';
                }
                catch (err) {
                    console.warn('[requireAdmin] Invalid JWT in Authorization header:', err?.message || err);
                }
            }
        }
        // 3. Fallback: adminUserId in body or query
        if (!userId) {
            userId = (req.body && req.body.adminUserId) || (req.query && req.query.adminUserId) || null;
            if (userId)
                jwtSource = 'body/query';
        }
        console.log(`[requireAdmin] userId: ${userId}, jwtSource: ${jwtSource}, path: ${req.path}`);
        if (!userId) {
            res.status(401).json({ error: "Missing admin user ID or valid token" });
            return;
        }
        const isAdminUser = await isAdmin(userId);
        if (!isAdminUser) {
            res.status(403).json({ error: "Admin privileges required" });
            return;
        }
        // Get admin user details
        let userData = {};
        try {
            const userDoc = await firebaseAdmin_1.firestore.collection("users").doc(userId).get();
            userData = userDoc.data() || {};
        }
        catch { }
        req.adminUser = {
            uid: userId,
            email: userData.email || "unknown",
            isAdmin: true,
        };
        console.log(`Admin ${req.adminUser.email} accessing: ${req.method} ${req.path}`);
        next();
    }
    catch (error) {
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
async function grantAdminPrivileges(userId, grantedBy) {
    await firebaseAdmin_1.firestore.collection("admins").doc(userId).set({
        isAdmin: true,
        grantedBy,
        grantedAt: new Date(),
    });
    console.log(`Admin privileges granted to ${userId} by ${grantedBy}`);
}
/**
 * Helper function to revoke admin privileges
 */
async function revokeAdminPrivileges(userId, revokedBy) {
    await firebaseAdmin_1.firestore.collection("admins").doc(userId).delete();
    console.log(`Admin privileges revoked from ${userId} by ${revokedBy}`);
}
/**
 * Middleware to log admin actions
 */
async function logAdminAction(adminId, action, details) {
    try {
        await firebaseAdmin_1.firestore.collection("adminLogs").add({
            adminId,
            action,
            details,
            timestamp: new Date(),
            ip: details.ip || "unknown",
        });
    }
    catch (error) {
        console.error("Failed to log admin action:", error);
        // Don't throw - logging failure shouldn't break the operation
    }
}
