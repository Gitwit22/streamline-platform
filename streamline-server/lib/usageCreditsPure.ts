/**
 * Usage credits (bonus streaming minutes) - pure rules, no I/O.
 *
 * A credit is a CONSUMABLE balance, not a monthly top-up:
 *
 *   users/{uid}/usageCredits/{id}
 *     { id, amount, remaining, type: "one_time" | "recurring", recurrence?,
 *       expiresAt? (epoch ms), source, reason, createdBy, createdAt (epoch ms),
 *       consumedMinutes, lastConsumedAt?, revokedAt?, revokedBy?, revokeReason? }
 *
 * Monthly allowance = plan monthlyStreamingMinutes (null = unlimited)
 *                   + credit minutes consumed this month
 *                   + remaining of active credits.
 *
 * When the meter bills streaming minutes and the month's usage goes past the
 * plan allowance, the excess is taken from active credits in the SAME
 * transaction (FIFO: earliest expiresAt first, never-expiring last, then
 * oldest createdAt), and usageMonthly.usage.creditMinutesConsumed records how
 * much of this month was paid by credits. Next month the plan allowance resets
 * but whatever is left in `remaining` carries over.
 *
 *   plan 2000, credit 500, usage 2200
 *     -> plan covers 2000, credit covers 200, credit remaining 300
 *     -> next month allowance = 2000 + 300
 *
 * The consumption math is self-healing: each bill takes
 *   max(0, (used - plan) - creditMinutesConsumedThisMonth)
 * so a bill that skipped consumption (entitlements read failed) is caught up
 * by the next one.
 *
 * Only "one_time" credits are implemented. "recurring" is modeled for later
 * and rejected by the admin API.
 */

export type UsageCreditType = "one_time" | "recurring";
export type UsageCreditSource = "admin_grant" | "promo" | "legacy_bonus" | "support" | "other";

export type UsageCredit = {
  id: string;
  amount: number;
  remaining: number;
  type: UsageCreditType;
  recurrence?: "monthly" | null;
  /** epoch ms; null/undefined = never expires */
  expiresAt?: number | null;
  source: UsageCreditSource | string;
  reason: string;
  createdBy: string;
  /** epoch ms */
  createdAt: number;
  consumedMinutes?: number;
  lastConsumedAt?: number | null;
  revokedAt?: number | null;
  revokedBy?: string | null;
  revokeReason?: string | null;
};

/** Deterministic id for the credit created from legacy users.bonusMinutes (idempotent migration). */
export const LEGACY_BONUS_CREDIT_ID = "legacy_bonus_minutes";

/** Upper bound for a single grant (minutes). Guards against typos like 1e9. */
export const MAX_CREDIT_GRANT_MINUTES = 1_000_000;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Firestore Timestamp | Date | number | ISO string -> epoch ms (null when absent/invalid). */
export function toMs(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? (value > 1e12 ? value : value * 1000) : null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const v: any = value;
  if (typeof v?.toMillis === "function") {
    const ms = v.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "string") {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Normalize a stored credit document (tolerates missing / malformed fields). */
export function normalizeCredit(id: string, raw: any): UsageCredit {
  const amount = Math.max(0, Math.floor(num(raw?.amount)));
  const remainingRaw = raw?.remaining === undefined ? amount : num(raw?.remaining);
  return {
    id,
    amount,
    remaining: Math.max(0, Math.floor(remainingRaw)),
    type: raw?.type === "recurring" ? "recurring" : "one_time",
    recurrence: raw?.recurrence === "monthly" ? "monthly" : null,
    expiresAt: toMs(raw?.expiresAt),
    source: typeof raw?.source === "string" && raw.source ? raw.source : "admin_grant",
    reason: typeof raw?.reason === "string" ? raw.reason : "",
    createdBy: typeof raw?.createdBy === "string" ? raw.createdBy : "",
    createdAt: toMs(raw?.createdAt) ?? 0,
    consumedMinutes: Math.max(0, num(raw?.consumedMinutes)),
    lastConsumedAt: toMs(raw?.lastConsumedAt),
    revokedAt: toMs(raw?.revokedAt),
    revokedBy: typeof raw?.revokedBy === "string" ? raw.revokedBy : null,
    revokeReason: typeof raw?.revokeReason === "string" ? raw.revokeReason : null,
  };
}

/** A credit counts toward the allowance (and can be consumed) only when this is true. */
export function isCreditActive(credit: UsageCredit, nowMs: number): boolean {
  if (credit.type !== "one_time") return false; // recurring: modeled, not implemented
  if (credit.revokedAt) return false;
  if (!(credit.remaining > 0)) return false;
  if (credit.expiresAt !== null && credit.expiresAt !== undefined && credit.expiresAt <= nowMs) return false;
  return true;
}

export type CreditStatus = "active" | "depleted" | "expired" | "revoked" | "unsupported";

export function creditStatus(credit: UsageCredit, nowMs: number): CreditStatus {
  if (credit.type !== "one_time") return "unsupported";
  if (credit.revokedAt) return "revoked";
  if (credit.expiresAt !== null && credit.expiresAt !== undefined && credit.expiresAt <= nowMs && credit.remaining > 0) {
    return "expired";
  }
  if (!(credit.remaining > 0)) return "depleted";
  return "active";
}

/** FIFO consumption order: earliest expiry first (never-expiring last), then oldest, then id. */
export function sortCreditsFifo(credits: UsageCredit[]): UsageCredit[] {
  return credits.slice().sort((a, b) => {
    const ea = a.expiresAt ?? Number.POSITIVE_INFINITY;
    const eb = b.expiresAt ?? Number.POSITIVE_INFINITY;
    if (ea !== eb) return ea < eb ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Sum of `remaining` across active credits. */
export function activeCreditRemaining(credits: UsageCredit[], nowMs: number): number {
  return credits.reduce((sum, c) => (isCreditActive(c, nowMs) ? sum + c.remaining : sum), 0);
}

/** usageMonthly.usage.creditMinutesConsumed (minutes of this month paid by credits). */
export function readCreditMinutesConsumed(usageDoc: any): number {
  return Math.max(0, num(usageDoc?.usage?.creditMinutesConsumed));
}

export type CreditAllocation = { creditId: string; minutes: number; remainingAfter: number };

export type CreditConsumptionPlan = {
  /** Minutes over the plan allowance after this bill. */
  excessOverPlan: number;
  /** Minutes this bill needs from credits (before availability). */
  needed: number;
  /** Minutes actually taken from credits by this bill. */
  consumed: number;
  /** Minutes still over plan + credits (overage / blocked territory). */
  uncovered: number;
  allocations: CreditAllocation[];
};

/**
 * How many minutes to take from which credits for one meter bill.
 *
 * usedAfter: month streaming minutes INCLUDING this bill's delta.
 * includedMinutes: plan monthlyStreamingMinutes (null = unlimited -> never consumes).
 * consumedThisMonth: usage.creditMinutesConsumed before this bill.
 */
export function planCreditConsumption(input: {
  usedAfter: number;
  includedMinutes: number | null;
  consumedThisMonth: number;
  credits: UsageCredit[];
  nowMs: number;
}): CreditConsumptionPlan {
  const empty: CreditConsumptionPlan = { excessOverPlan: 0, needed: 0, consumed: 0, uncovered: 0, allocations: [] };
  if (input.includedMinutes === null || input.includedMinutes === undefined) return empty;
  const included = Math.max(0, num(input.includedMinutes));
  const used = Math.max(0, num(input.usedAfter));
  const excessOverPlan = Math.max(0, used - included);
  const needed = Math.max(0, Math.ceil(excessOverPlan - Math.max(0, num(input.consumedThisMonth))));
  if (needed === 0) return { ...empty, excessOverPlan };

  let left = needed;
  const allocations: CreditAllocation[] = [];
  for (const credit of sortCreditsFifo(input.credits.filter((c) => isCreditActive(c, input.nowMs)))) {
    if (left <= 0) break;
    const take = Math.min(left, credit.remaining);
    if (take <= 0) continue;
    allocations.push({ creditId: credit.id, minutes: take, remainingAfter: credit.remaining - take });
    left -= take;
  }
  const consumed = needed - left;
  return { excessOverPlan, needed, consumed, uncovered: left, allocations };
}

/**
 * Minutes credits add to THIS month's allowance: what credits already paid
 * this month (capped at the current excess over the plan, so a mid-month plan
 * upgrade does not turn already-consumed credit into extra allowance) plus
 * what is still available.
 */
export function creditAllowanceMinutes(params: {
  usedMinutes: number;
  includedMinutes: number | null;
  consumedThisMonth: number;
  credits: UsageCredit[];
  nowMs: number;
}): number {
  const remaining = activeCreditRemaining(params.credits, params.nowMs);
  if (params.includedMinutes === null || params.includedMinutes === undefined) return remaining;
  const excess = Math.max(0, num(params.usedMinutes) - Math.max(0, num(params.includedMinutes)));
  return Math.min(Math.max(0, num(params.consumedThisMonth)), excess) + remaining;
}

// ---------------------------------------------------------------------------
// Legacy users.bonusMinutes migration
// ---------------------------------------------------------------------------

/** True when the user doc still carries un-migrated legacy bonus minutes. */
export function needsLegacyBonusMigration(userDoc: any): boolean {
  if (!userDoc) return false;
  if (userDoc.bonusMinutesMigratedAt) return false;
  return Math.floor(num(userDoc.bonusMinutes)) > 0;
}

/**
 * The one_time credit that replaces legacy users.bonusMinutes (null when there
 * is nothing to migrate). Caller writes it at LEGACY_BONUS_CREDIT_ID together
 * with { bonusMinutes: 0, bonusMinutesMigratedAt } in one transaction.
 */
export function buildLegacyBonusCredit(userDoc: any, nowMs: number): UsageCredit | null {
  if (!needsLegacyBonusMigration(userDoc)) return null;
  const minutes = Math.floor(num(userDoc.bonusMinutes));
  return {
    id: LEGACY_BONUS_CREDIT_ID,
    amount: minutes,
    remaining: minutes,
    type: "one_time",
    recurrence: null,
    expiresAt: null,
    source: "legacy_bonus",
    reason: "Migrated from legacy monthly bonus minutes",
    createdBy: "system:migration",
    createdAt: nowMs,
    consumedMinutes: 0,
    lastConsumedAt: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  };
}

/** Firestore doc body for a credit (dates stored as epoch ms numbers). */
export function creditToDoc(credit: UsageCredit): Record<string, any> {
  return {
    id: credit.id,
    amount: credit.amount,
    remaining: credit.remaining,
    type: credit.type,
    recurrence: credit.recurrence ?? null,
    expiresAt: credit.expiresAt ?? null,
    source: credit.source,
    reason: credit.reason,
    createdBy: credit.createdBy,
    createdAt: credit.createdAt,
    consumedMinutes: credit.consumedMinutes ?? 0,
    lastConsumedAt: credit.lastConsumedAt ?? null,
    revokedAt: credit.revokedAt ?? null,
    revokedBy: credit.revokedBy ?? null,
    revokeReason: credit.revokeReason ?? null,
  };
}

/**
 * Writes for the legacy bonus migration, given the user doc and whether the
 * deterministic legacy credit doc already exists (both read in the same
 * transaction). Already migrated -> no writes. Credit doc already present
 * (e.g. a half-applied manual fix) -> only the user patch, never a second
 * credit. Running it twice is therefore a no-op the second time.
 */
export function planLegacyBonusMigration(
  userDoc: any,
  legacyExists: boolean,
  nowMs: number
): { credit: UsageCredit | null; creditDoc: Record<string, any> | null; userPatch: Record<string, any> | null } {
  const credit = buildLegacyBonusCredit(userDoc, nowMs);
  if (!credit) return { credit: null, creditDoc: null, userPatch: null };
  return {
    credit,
    creditDoc: legacyExists ? null : creditToDoc(credit),
    userPatch: { bonusMinutes: 0, bonusMinutesMigratedAt: nowMs, bonusMinutesMigratedAmount: credit.amount },
  };
}

/**
 * Credits as the gate should see them for a read-only view: stored credits
 * plus a virtual legacy credit while users.bonusMinutes is not migrated yet.
 */
export function withPendingLegacyCredit(credits: UsageCredit[], userDoc: any, nowMs: number): UsageCredit[] {
  const legacy = buildLegacyBonusCredit(userDoc, nowMs);
  if (!legacy) return credits;
  if (credits.some((c) => c.id === LEGACY_BONUS_CREDIT_ID)) return credits;
  return [...credits, legacy];
}

// ---------------------------------------------------------------------------
// Admin grant validation
// ---------------------------------------------------------------------------

// Flat shape (the server compiles with strict: false, where boolean
// discriminants do not narrow unions).
export type GrantValidation = {
  ok: boolean;
  value?: { amount: number; reason: string; expiresAt: number | null; type: "one_time"; source: string };
  error?: string;
  details?: string;
};

const ALLOWED_GRANT_SOURCES = new Set(["admin_grant", "promo", "support", "other"]);

/** Validates POST /api/admin/users/:id/grant-minutes (and /credits) bodies. */
export function validateCreditGrant(body: any, nowMs: number): GrantValidation {
  const b = body || {};
  const rawAmount = b.minutes ?? b.amount;
  const amount =
    typeof rawAmount === "number"
      ? rawAmount
      : typeof rawAmount === "string" && /^\s*\d+\s*$/.test(rawAmount)
        ? Number(rawAmount)
        : NaN;
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: "invalid_minutes", details: "minutes must be a positive whole number" };
  }
  if (amount > MAX_CREDIT_GRANT_MINUTES) {
    return { ok: false, error: "invalid_minutes", details: `minutes must be at most ${MAX_CREDIT_GRANT_MINUTES}` };
  }

  const type = b.type === undefined || b.type === null || b.type === "" ? "one_time" : b.type;
  if (type === "recurring") {
    return { ok: false, error: "recurring_credits_not_supported", details: "Only one_time credits are supported" };
  }
  if (type !== "one_time") {
    return { ok: false, error: "invalid_type", details: "type must be one_time" };
  }

  const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 500) : "";
  if (!reason) {
    return { ok: false, error: "reason_required", details: "A reason is required" };
  }

  let expiresAt: number | null = null;
  if (b.expiresAt !== undefined && b.expiresAt !== null && b.expiresAt !== "") {
    const ms = toMs(b.expiresAt);
    if (ms === null) return { ok: false, error: "invalid_expiry", details: "expiresAt must be a date" };
    if (ms <= nowMs) return { ok: false, error: "invalid_expiry", details: "expiresAt must be in the future" };
    expiresAt = ms;
  }

  const source = typeof b.source === "string" && ALLOWED_GRANT_SOURCES.has(b.source) ? b.source : "admin_grant";
  return { ok: true, value: { amount, reason, expiresAt, type: "one_time", source } };
}

/** API shape of a credit (dates as ISO, plus derived status). */
export function serializeCredit(credit: UsageCredit, nowMs: number) {
  const iso = (ms: number | null | undefined) => (typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null);
  return {
    id: credit.id,
    amount: credit.amount,
    remaining: credit.remaining,
    consumedMinutes: credit.consumedMinutes ?? Math.max(0, credit.amount - credit.remaining),
    type: credit.type,
    recurrence: credit.recurrence ?? null,
    expiresAt: iso(credit.expiresAt),
    source: credit.source,
    reason: credit.reason,
    createdBy: credit.createdBy,
    createdAt: iso(credit.createdAt),
    lastConsumedAt: iso(credit.lastConsumedAt),
    revokedAt: iso(credit.revokedAt),
    revokedBy: credit.revokedBy ?? null,
    revokeReason: credit.revokeReason ?? null,
    status: creditStatus(credit, nowMs),
  };
}
