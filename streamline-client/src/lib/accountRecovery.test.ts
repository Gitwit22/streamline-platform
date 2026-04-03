import { describe, expect, it } from "vitest";
import {
  SECURITY_QUESTIONS,
  generateEmergencyRecoveryCode,
  isValidSecurityQuestionId,
  needsAccountRecoverySetup,
  normalizeEmergencyCode,
} from "./accountRecovery";

describe("accountRecovery helpers", () => {
  it("keeps the controlled list at exactly 10 questions", () => {
    expect(SECURITY_QUESTIONS).toHaveLength(10);
  });

  it("normalizes emergency recovery codes to digits only", () => {
    expect(normalizeEmergencyCode(" 12 34 56 ")).toBe("123456");
    expect(normalizeEmergencyCode("12a-34b")).toBe("1234");
  });

  it("generates a 6-digit emergency recovery code", () => {
    expect(generateEmergencyRecoveryCode()).toMatch(/^\d{6}$/);
  });

  it("recognizes approved question ids only", () => {
    expect(isValidSecurityQuestionId("first_pet")).toBe(true);
    expect(isValidSecurityQuestionId("not_real")).toBe(false);
  });

  it("forces recovery setup when the user payload marks it required or not configured", () => {
    expect(needsAccountRecoverySetup({ recoveryRequired: true })).toBe(true);
    expect(needsAccountRecoverySetup({ recoveryConfigured: false })).toBe(true);
    expect(needsAccountRecoverySetup({ recovery: { configured: false } })).toBe(true);
    expect(needsAccountRecoverySetup({ recoveryConfigured: true })).toBe(false);
  });
});