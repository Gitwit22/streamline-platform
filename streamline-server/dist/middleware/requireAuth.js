"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function requireAuth(req, res, next) {
    try {
        const token = req.cookies?.token ||
            req.headers.authorization?.replace("Bearer ", "");
        if (!token)
            return res.status(401).json({ error: "Unauthorized" });
        // ✅ read env at runtime
        const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = { uid: decoded.uid };
        return next();
    }
    catch (err) {
        console.error("[requireAuth] Unauthorized:", err?.message || err);
        return res.status(401).json({ error: "Unauthorized" });
    }
}
