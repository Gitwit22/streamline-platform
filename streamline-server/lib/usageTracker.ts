/**
 * Usage month window helpers.
 *
 * Usage is metered per UTC calendar month: usageMonthly docs are keyed
 * `${uid}_${YYYY-MM}` and "reset" simply by the month key changing on the
 * 1st at 00:00 UTC. Nothing zeroes a month doc in place (no Stripe-driven or
 * lazy resets).
 */
import { monthKeyUTC, nextMonthlyResetUTC } from "./streamingMeterPure";

/** Current usage month key in YYYY-MM format (UTC). */
export function getCurrentMonthKey(now: Date = new Date()): string {
  return monthKeyUTC(now);
}

/** Next usage reset (1st of next month, 00:00 UTC). */
export function getNextUsageResetDate(now: Date = new Date()): Date {
  return nextMonthlyResetUTC(now);
}
