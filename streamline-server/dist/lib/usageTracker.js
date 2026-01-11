"use strict";
/**
 * Usage tracking and enforcement utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentMonthKey = getCurrentMonthKey;
exports.canStartStream = canStartStream;
exports.calculateNextResetDate = calculateNextResetDate;
exports.formatDuration = formatDuration;
const planLimits_1 = require("./planLimits");
/**
 * Get current month key in YYYY-MM format
 */
function getCurrentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
/**
 * Check if user can start a stream based on plan limits and current usage
 */
function canStartStream(params) {
    const { uid, plan, userOverages, selectedDestinationsCount, wantsRecording, wantsRTMP, currentUsage, } = params;
    const maxDestinations = (0, planLimits_1.resolveMaxDestinations)(plan.limits || {});
    // 1) Check if plan allows RTMP multistream
    if (wantsRTMP && !plan.features.rtmpMultistream) {
        return {
            allowed: false,
            reason: "Your plan does not include RTMP multistreaming",
            requiresUpgrade: true,
        };
    }
    // 2) Check if destinations count exceeds plan limit (only if a hard cap is configured)
    if (maxDestinations > 0 && selectedDestinationsCount > maxDestinations) {
        return {
            allowed: false,
            reason: `Your plan allows ${maxDestinations} destination(s), but you selected ${selectedDestinationsCount}`,
            requiresUpgrade: true,
        };
    }
    // 3) Check if plan allows recording
    if (wantsRecording && !plan.features.recording) {
        return {
            allowed: false,
            reason: "Your plan does not include recording",
            requiresUpgrade: true,
        };
    }
    // 4) Check participant minutes usage
    const participantLimit = plan.limits.participantMinutes;
    if (currentUsage.participantMinutes >= participantLimit) {
        // Check if overages are allowed
        if (plan.features.overagesAllowed && userOverages.overagesEnabled) {
            // Allow with overage billing
            console.log(`⚠️ User ${uid} starting stream with overages enabled`);
            return { allowed: true };
        }
        else if (plan.features.overagesAllowed && !userOverages.overagesEnabled) {
            return {
                allowed: false,
                reason: `You've used ${currentUsage.participantMinutes}/${participantLimit} participant minutes. Enable overages to continue.`,
                requiresOveragesEnabled: true,
            };
        }
        else {
            return {
                allowed: false,
                reason: `You've used ${currentUsage.participantMinutes}/${participantLimit} participant minutes. Upgrade your plan to continue.`,
                requiresUpgrade: true,
            };
        }
    }
    // 5) Check transcode minutes usage
    const transcodeLimit = plan.limits.transcodeMinutes;
    if (currentUsage.transcodeMinutes >= transcodeLimit) {
        if (plan.features.overagesAllowed && userOverages.overagesEnabled) {
            console.log(`⚠️ User ${uid} starting stream with transcode overages`);
            return { allowed: true };
        }
        else if (plan.features.overagesAllowed && !userOverages.overagesEnabled) {
            return {
                allowed: false,
                reason: `You've used ${currentUsage.transcodeMinutes}/${transcodeLimit} transcode minutes. Enable overages to continue.`,
                requiresOveragesEnabled: true,
            };
        }
        else {
            return {
                allowed: false,
                reason: `You've used ${currentUsage.transcodeMinutes}/${transcodeLimit} transcode minutes. Upgrade your plan to continue.`,
                requiresUpgrade: true,
            };
        }
    }
    // All checks passed
    return { allowed: true };
}
/**
 * Calculate next reset date based on anniversary day
 */
function calculateNextResetDate(anniversaryDay) {
    const now = new Date();
    const currentDay = now.getDate();
    // If we haven't reached this month's anniversary day yet
    if (currentDay < anniversaryDay) {
        return new Date(now.getFullYear(), now.getMonth(), anniversaryDay);
    }
    // Otherwise, next reset is next month's anniversary day
    return new Date(now.getFullYear(), now.getMonth() + 1, anniversaryDay);
}
/**
 * Format minutes into human-readable duration
 */
function formatDuration(minutes) {
    if (minutes < 60) {
        return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) {
        return `${hours}h`;
    }
    return `${hours}h ${mins}m`;
}
