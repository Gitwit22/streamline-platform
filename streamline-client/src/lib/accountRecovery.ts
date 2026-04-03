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
export type RecoveryMethod = "admin" | "question" | "code";

const SECURITY_QUESTION_ID_SET = new Set<string>(SECURITY_QUESTIONS.map((question) => question.id));

export function normalizeEmergencyCode(code: unknown) {
  return String(code || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\D/g, "");
}

export function needsAccountRecoverySetup(user: any) {
  if (!user) return false;
  if (user.recoveryRequired === true) return true;
  if (user.recoveryConfigured === false) return true;
  if (user.recovery?.configured === false) return true;
  return false;
}

export function isValidSecurityQuestionId(value: unknown): value is SecurityQuestionId {
  return typeof value === "string" && SECURITY_QUESTION_ID_SET.has(value);
}