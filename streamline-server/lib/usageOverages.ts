import { LIMIT_ERRORS, type LimitErrorCode } from "./limitErrors";

export type UsageOverageTotals = {
  participantMinutes: number;
  transcodeMinutes: number;
};

export type UsageGateDecision = {
  allowed: boolean;
  reason?: LimitErrorCode;
  requiresUpgrade?: boolean;
  shouldLogOverages?: boolean;
  overageTotals?: UsageOverageTotals;
  isOverParticipant?: boolean;
  isOverTranscode?: boolean;
};

function toFiniteNumber(value: any, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function computeOverage(includedMinutes: number, usedMinutes: number): number {
  const included = toFiniteNumber(includedMinutes, 0);
  const used = toFiniteNumber(usedMinutes, 0);
  if (included <= 0) return 0; // 0/unset => unlimited
  return Math.max(0, used - included);
}

export function evaluateUsageGate(params: {
  allowsOverages: boolean;
  limits: {
    participantMinutes: number;
    transcodeMinutes: number;
  };
  usage: {
    participantMinutes: number;
    transcodeMinutes: number;
  };
  checkParticipant?: boolean;
  checkTranscode?: boolean;
}): UsageGateDecision {
  const checkParticipant = params.checkParticipant !== false;
  const checkTranscode = params.checkTranscode !== false;

  const participantLimit = toFiniteNumber(params.limits.participantMinutes, 0);
  const transcodeLimit = toFiniteNumber(params.limits.transcodeMinutes, 0);

  const participantUsed = toFiniteNumber(params.usage.participantMinutes, 0);
  const transcodeUsed = toFiniteNumber(params.usage.transcodeMinutes, 0);

  const isOverParticipant =
    checkParticipant && participantLimit > 0 ? participantUsed >= participantLimit : false;
  const isOverTranscode =
    checkTranscode && transcodeLimit > 0 ? transcodeUsed >= transcodeLimit : false;

  const isOverLimit = isOverParticipant || isOverTranscode;
  if (!isOverLimit) {
    return { allowed: true, isOverParticipant: false, isOverTranscode: false };
  }

  const overageTotals: UsageOverageTotals = {
    participantMinutes: computeOverage(participantLimit, participantUsed),
    transcodeMinutes: computeOverage(transcodeLimit, transcodeUsed),
  };

  const shouldLogOverages =
    overageTotals.participantMinutes > 0 || overageTotals.transcodeMinutes > 0;

  if (params.allowsOverages) {
    return {
      allowed: true,
      shouldLogOverages,
      overageTotals,
      isOverParticipant,
      isOverTranscode,
    };
  }

  return {
    allowed: false,
    reason: LIMIT_ERRORS.USAGE_EXHAUSTED,
    requiresUpgrade: true,
    isOverParticipant,
    isOverTranscode,
  };
}
