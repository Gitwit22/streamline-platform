// Centralized canonical error codes for plan/usage enforcement
// Update this file whenever new limit-related errors are introduced

export const LIMIT_ERRORS = {
  LIMIT_EXCEEDED: 'limit_exceeded',
  USAGE_EXHAUSTED: 'usage_exhausted',
  FEATURE_NOT_ENTITLED: 'feature_not_entitled',
  FEATURE_DISABLED: 'feature_disabled',
} as const;

export type LimitErrorCode = typeof LIMIT_ERRORS[keyof typeof LIMIT_ERRORS];
3