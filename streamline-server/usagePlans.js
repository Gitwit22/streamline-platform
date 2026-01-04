"use strict";
// src/server/usagePlan.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAN_LIMITS = void 0;
exports.getPlanMaxHours = getPlanMaxHours;
exports.PLAN_LIMITS = {
    free: 3, // 3 hours per month
    starter: 10, // 10 hours per month
    pro: 40 // 40 hours per month
};
function getPlanMaxHours(plan, existingMaxHours) {
    // If the user has a custom maxHours set in their Firestore doc, use that
    if (existingMaxHours && existingMaxHours > 0) {
        return existingMaxHours;
    }
    // Otherwise fallback to the defaults
    return exports.PLAN_LIMITS[plan] ?? 0;
}
