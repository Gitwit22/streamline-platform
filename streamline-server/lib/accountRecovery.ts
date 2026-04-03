import bcrypt from "bcryptjs";

export const PASSWORD_MIN_LENGTH = 6;
export const ADMIN_PASSWORD_RESET_TTL_MS = 24 * 60 * 60 * 1000;
export const EMERGENCY_CODE_LENGTH = 6;
export const RECOVERY_MAX_FAILED_ATTEMPTS = 5;
export const RECOVERY_LOCK_DURATION_MS = 15 * 60 * 1000;

export const SECURITY_QUESTIONS = [
  { id: "first_pet", text: "What was the name of your first pet?" },
  { id: "first_car", text: "What was the make of your first car?" },
  { id: "birth_city", text: "What city were you born in?" },
  { id: "elementary_school", text: "What was the name of your elementary school?" },
  { id: "childhood_nickname", text: "What was your childhood nickname?" },
  { id: "childhood_street", text: "What street did you grow up on?" },
  { id: "first_concert", text: "What was the first concert you attended?" },
  { id: "favorite_teacher", text: "What is the name of your favorite teacher from school?" },
  { id: "dream_job", text: "What was your dream job as a child?" },
  { id: "oldest_sibling_middle_name", text: "What is the middle name of your oldest sibling?" },
] as const;

export type SecurityQuestionId = (typeof SECURITY_QUESTIONS)[number]["id"];

export type PasswordResetState = {
  adminAllowed: boolean;
  requestedAt: number | null;
  requestedBy: string | null;
  expiresAt: number | null;
  usedAt: number | null;
};

export type RecoveryState = {
  configured: boolean;
  questionId: SecurityQuestionId | null;
  answerHash: string | null;
  emergencyCodeHash: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  failedQuestionAttempts: number;
  failedCodeAttempts: number;
  questionLockedUntil: number | null;
  codeLockedUntil: number | null;
  lastRecoveryMethodUsed: "question" | "code" | "admin" | null;
};

export type PublicPasswordResetState = PasswordResetState & {
  active: boolean;
};

export type PublicRecoveryState = {
  configured: boolean;
  questionId: SecurityQuestionId | null;
  createdAt: number | null;
  updatedAt: number | null;
  failedQuestionAttempts: number;
  failedCodeAttempts: number;
  questionLockedUntil: number | null;
  codeLockedUntil: number | null;
  lastRecoveryMethodUsed: "question" | "code" | "admin" | null;
};

export type RecoveryMethod = "admin" | "question" | "code";

const SECURITY_QUESTION_ID_SET = new Set<string>(SECURITY_QUESTIONS.map((question) => question.id));

export function isApprovedSecurityQuestionId(value: unknown): value is SecurityQuestionId {
  return typeof value === "string" && SECURITY_QUESTION_ID_SET.has(value);
}

export function createEmptyPasswordResetState(): PasswordResetState {
  return {
    adminAllowed: false,
    requestedAt: null,
    requestedBy: null,
    expiresAt: null,
    usedAt: null,
  };
}

export function createEmptyRecoveryState(): RecoveryState {
  return {
    configured: false,
    questionId: null,
    answerHash: null,
    emergencyCodeHash: null,
    createdAt: null,
    updatedAt: null,
    failedQuestionAttempts: 0,
    failedCodeAttempts: 0,
    questionLockedUntil: null,
    codeLockedUntil: null,
    lastRecoveryMethodUsed: null,
  };
}

export function normalizePasswordResetState(raw: any): PasswordResetState {
  return {
    adminAllowed: raw?.adminAllowed === true,
    requestedAt: asNullableNumber(raw?.requestedAt),
    requestedBy: asNullableString(raw?.requestedBy),
    expiresAt: asNullableNumber(raw?.expiresAt),
    usedAt: asNullableNumber(raw?.usedAt),
  };
}

export function normalizeRecoveryState(raw: any): RecoveryState {
  return {
    configured: raw?.configured === true,
    questionId: isApprovedSecurityQuestionId(raw?.questionId) ? raw.questionId : null,
    answerHash: asNullableString(raw?.answerHash),
    emergencyCodeHash: asNullableString(raw?.emergencyCodeHash),
    createdAt: asNullableNumber(raw?.createdAt),
    updatedAt: asNullableNumber(raw?.updatedAt),
    failedQuestionAttempts: asNonNegativeNumber(raw?.failedQuestionAttempts),
    failedCodeAttempts: asNonNegativeNumber(raw?.failedCodeAttempts),
    questionLockedUntil: asNullableNumber(raw?.questionLockedUntil),
    codeLockedUntil: asNullableNumber(raw?.codeLockedUntil),
    lastRecoveryMethodUsed:
      raw?.lastRecoveryMethodUsed === "question" ||
      raw?.lastRecoveryMethodUsed === "code" ||
      raw?.lastRecoveryMethodUsed === "admin"
        ? raw.lastRecoveryMethodUsed
        : null,
  };
}

export function normalizeSecurityAnswer(answer: unknown): string {
  return String(answer || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function normalizeEmergencyCode(code: unknown): string {
  return String(code || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\D/g, "");
}

export function validatePassword(value: unknown): string | null {
  const password = String(value || "");
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
}

export function validateRecoverySetupInput(input: {
  questionId: unknown;
  answer: unknown;
  emergencyCode: unknown;
  confirmEmergencyCode?: unknown;
}): string | null {
  if (!isApprovedSecurityQuestionId(input.questionId)) {
    return "Select a valid security question.";
  }

  if (!normalizeSecurityAnswer(input.answer)) {
    return "Security answer is required.";
  }

  const emergencyCode = normalizeEmergencyCode(input.emergencyCode);
  if (!/^\d{6}$/.test(emergencyCode)) {
    return "Emergency recovery code must be 6 digits.";
  }

  const confirmCode = normalizeEmergencyCode(input.confirmEmergencyCode);
  if (confirmCode && emergencyCode !== confirmCode) {
    return "Emergency recovery code confirmation does not match.";
  }

  return null;
}

export function isAdminPasswordResetActive(raw: any, now = Date.now()): boolean {
  const state = normalizePasswordResetState(raw);
  if (!state.adminAllowed) return false;
  if (!state.expiresAt || state.expiresAt <= now) return false;
  if (state.usedAt) return false;
  return true;
}

export function buildAdminPasswordResetState(adminUserId: string, now = Date.now()): PasswordResetState {
  return {
    adminAllowed: true,
    requestedAt: now,
    requestedBy: String(adminUserId),
    expiresAt: now + ADMIN_PASSWORD_RESET_TTL_MS,
    usedAt: null,
  };
}

export function buildConsumedPasswordResetState(raw: any, now = Date.now()): PasswordResetState {
  const state = normalizePasswordResetState(raw);
  return {
    ...state,
    adminAllowed: false,
    usedAt: now,
  };
}

export function buildPublicPasswordResetState(raw: any, now = Date.now()): PublicPasswordResetState {
  const state = normalizePasswordResetState(raw);
  return {
    ...state,
    active: isAdminPasswordResetActive(state, now),
  };
}

export function buildPublicRecoveryState(raw: any): PublicRecoveryState {
  const state = normalizeRecoveryState(raw);
  return {
    configured: state.configured,
    questionId: state.questionId,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    failedQuestionAttempts: state.failedQuestionAttempts,
    failedCodeAttempts: state.failedCodeAttempts,
    questionLockedUntil: state.questionLockedUntil,
    codeLockedUntil: state.codeLockedUntil,
    lastRecoveryMethodUsed: state.lastRecoveryMethodUsed,
  };
}

export function buildRecoverySetupState(
  input: {
    questionId: SecurityQuestionId;
    answerHash: string;
    emergencyCodeHash: string;
  },
  existingRaw: any,
  now = Date.now()
): RecoveryState {
  const existing = normalizeRecoveryState(existingRaw);
  return {
    configured: true,
    questionId: input.questionId,
    answerHash: input.answerHash,
    emergencyCodeHash: input.emergencyCodeHash,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    failedQuestionAttempts: 0,
    failedCodeAttempts: 0,
    questionLockedUntil: null,
    codeLockedUntil: null,
    lastRecoveryMethodUsed: existing.lastRecoveryMethodUsed,
  };
}

export function buildRecoveryVerifiedState(existingRaw: any, method: "question" | "code", now = Date.now()): RecoveryState {
  const existing = normalizeRecoveryState(existingRaw);
  return {
    ...existing,
    configured: true,
    failedQuestionAttempts: 0,
    failedCodeAttempts: 0,
    questionLockedUntil: null,
    codeLockedUntil: null,
    lastRecoveryMethodUsed: method,
    updatedAt: now,
  };
}

export function buildRecoveryFailureState(existingRaw: any, method: "question" | "code", now = Date.now()): RecoveryState {
  const existing = normalizeRecoveryState(existingRaw);

  if (method === "question") {
    const nextAttempts = existing.failedQuestionAttempts + 1;
    return {
      ...existing,
      failedQuestionAttempts: nextAttempts,
      questionLockedUntil:
        nextAttempts >= RECOVERY_MAX_FAILED_ATTEMPTS ? now + RECOVERY_LOCK_DURATION_MS : existing.questionLockedUntil,
      updatedAt: now,
    };
  }

  const nextAttempts = existing.failedCodeAttempts + 1;
  return {
    ...existing,
    failedCodeAttempts: nextAttempts,
    codeLockedUntil: nextAttempts >= RECOVERY_MAX_FAILED_ATTEMPTS ? now + RECOVERY_LOCK_DURATION_MS : existing.codeLockedUntil,
    updatedAt: now,
  };
}

export function buildRecoveryResetState(existingRaw: any, now = Date.now()): RecoveryState {
  const existing = normalizeRecoveryState(existingRaw);
  return {
    ...createEmptyRecoveryState(),
    createdAt: existing.createdAt,
    updatedAt: now,
    lastRecoveryMethodUsed: "admin",
  };
}

export function canAdminManagePasswordReset(actorUserId: string, targetUserId: string, targetUser: any): boolean {
  if (!actorUserId || !targetUserId) return false;
  if (actorUserId === targetUserId) return false;
  return !isUserAdminLike(targetUser);
}

export function needsRecoverySetup(userLike: any): boolean {
  return normalizeRecoveryState(userLike?.recovery).configured !== true;
}

export function getSecurityQuestionById(questionId: unknown) {
  if (!isApprovedSecurityQuestionId(questionId)) return null;
  return SECURITY_QUESTIONS.find((question) => question.id === questionId) || null;
}

export function isRecoveryMethodLocked(existingRaw: any, method: "question" | "code", now = Date.now()) {
  const existing = normalizeRecoveryState(existingRaw);
  const lockedUntil = method === "question" ? existing.questionLockedUntil : existing.codeLockedUntil;
  return typeof lockedUntil === "number" && lockedUntil > now;
}

export function isQuestionRecoveryAvailable(existingRaw: any, now = Date.now()) {
  const existing = normalizeRecoveryState(existingRaw);
  if (!existing.configured) return false;
  if (!existing.questionId || !existing.answerHash) return false;
  return !isRecoveryMethodLocked(existing, "question", now);
}

export function isEmergencyCodeRecoveryAvailable(existingRaw: any, now = Date.now()) {
  const existing = normalizeRecoveryState(existingRaw);
  if (!existing.configured) return false;
  if (!existing.emergencyCodeHash) return false;
  return !isRecoveryMethodLocked(existing, "code", now);
}

export function stripSensitiveRecoveryFields(user: any, now = Date.now()) {
  if (!user) return user;
  const { passwordHash, recovery, passwordReset, ...safe } = user;
  return {
    ...safe,
    passwordReset: buildPublicPasswordResetState(passwordReset, now),
    recovery: buildPublicRecoveryState(recovery),
    recoveryConfigured: normalizeRecoveryState(recovery).configured,
    recoveryRequired: needsRecoverySetup({ recovery }),
  };
}

export async function hashSecurityAnswer(answer: unknown): Promise<string> {
  return bcrypt.hash(normalizeSecurityAnswer(answer), 10);
}

export async function hashEmergencyCode(code: unknown): Promise<string> {
  return bcrypt.hash(normalizeEmergencyCode(code), 10);
}

export async function verifySecurityAnswer(answer: unknown, hash: unknown): Promise<boolean> {
  const hashValue = asNullableString(hash);
  if (!hashValue) return false;
  return bcrypt.compare(normalizeSecurityAnswer(answer), hashValue);
}

export async function verifyEmergencyCode(code: unknown, hash: unknown): Promise<boolean> {
  const hashValue = asNullableString(hash);
  if (!hashValue) return false;
  return bcrypt.compare(normalizeEmergencyCode(code), hashValue);
}

export function buildForgotPasswordStatus(userLike: any, now = Date.now()) {
  const recovery = normalizeRecoveryState(userLike?.recovery);
  const adminResetActive = isAdminPasswordResetActive(userLike?.passwordReset, now);
  const questionAvailable = isQuestionRecoveryAvailable(recovery, now);
  const codeAvailable = isEmergencyCodeRecoveryAvailable(recovery, now);
  const availableMethods: RecoveryMethod[] = [];

  if (adminResetActive) availableMethods.push("admin");
  if (questionAvailable) availableMethods.push("question");
  if (codeAvailable) availableMethods.push("code");

  return {
    recoveryConfigured: recovery.configured,
    availableMethods,
    adminResetActive,
    questionLocked: isRecoveryMethodLocked(recovery, "question", now),
    codeLocked: isRecoveryMethodLocked(recovery, "code", now),
    recoveryQuestion: questionAvailable ? getSecurityQuestionById(recovery.questionId) : null,
  };
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNonNegativeNumber(value: unknown): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return num > 0 ? Math.floor(num) : 0;
}

function isUserAdminLike(user: any): boolean {
  return user?.admin?.isAdmin === true || user?.isAdmin === true;
}