export const DAY_MS = 24 * 60 * 60 * 1000;
export const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export type BillingGuards = {
  changeWindowStartMs: number;
  changeCountInWindow: number;
  lastDowngradeAtMs: number | null;
  lastPlanChangeAtMs: number | null;
};

export function normalizeBillingGuards(raw: any, nowMs: number = Date.now()): BillingGuards {
  const changeWindowStartMs = Number(raw?.changeWindowStartMs);
  const changeCountInWindow = Number(raw?.changeCountInWindow);
  const lastDowngradeAtMs = raw?.lastDowngradeAtMs === null ? null : Number(raw?.lastDowngradeAtMs);
  const lastPlanChangeAtMs = raw?.lastPlanChangeAtMs === null ? null : Number(raw?.lastPlanChangeAtMs);

  return {
    changeWindowStartMs: Number.isFinite(changeWindowStartMs) && changeWindowStartMs > 0 ? changeWindowStartMs : nowMs,
    changeCountInWindow: Number.isFinite(changeCountInWindow) && changeCountInWindow >= 0 ? changeCountInWindow : 0,
    lastDowngradeAtMs: Number.isFinite(lastDowngradeAtMs) && lastDowngradeAtMs > 0 ? lastDowngradeAtMs : null,
    lastPlanChangeAtMs: Number.isFinite(lastPlanChangeAtMs) && lastPlanChangeAtMs > 0 ? lastPlanChangeAtMs : null,
  };
}

export function assertDailyPlanLimit(guards: BillingGuards, nowMs: number = Date.now()) {
  const start = guards.changeWindowStartMs ?? nowMs;

  if (nowMs - start > DAY_MS) {
    return { ok: true as const, reset: true as const };
  }

  if ((guards.changeCountInWindow ?? 0) >= 3) {
    return {
      ok: false as const,
      error: "plan_change_limit_daily" as const,
      retryAfterMs: DAY_MS - (nowMs - start),
    };
  }

  return { ok: true as const };
}

export function assertMonthlyDowngradeLimit(guards: BillingGuards, nowMs: number = Date.now()) {
  const last = guards.lastDowngradeAtMs ?? 0;

  if (last && nowMs - last < MONTH_MS) {
    return {
      ok: false as const,
      error: "downgrade_limit_monthly" as const,
      retryAfterMs: MONTH_MS - (nowMs - last),
    };
  }

  return { ok: true as const };
}

export function applyDailyWindowReset(guards: BillingGuards, nowMs: number): BillingGuards {
  return {
    ...guards,
    changeWindowStartMs: nowMs,
    changeCountInWindow: 0,
  };
}

export function applySuccessfulPlanChange(params: {
  guards: BillingGuards;
  nowMs: number;
  isDowngrade: boolean;
}): BillingGuards {
  const { guards, nowMs, isDowngrade } = params;
  const daily = assertDailyPlanLimit(guards, nowMs);
  const base = daily.ok && (daily as any).reset ? applyDailyWindowReset(guards, nowMs) : guards;

  return {
    ...base,
    changeCountInWindow: (base.changeCountInWindow ?? 0) + 1,
    lastPlanChangeAtMs: nowMs,
    lastDowngradeAtMs: isDowngrade ? nowMs : base.lastDowngradeAtMs,
  };
}
