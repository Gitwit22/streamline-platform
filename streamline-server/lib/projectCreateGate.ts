/**
 * Project-creation limit decision (pure). Used by assertCanCreateProject
 * (routes/editing.ts), which gates POST /api/projects, POST
 * /api/editing/projects and project duplication.
 *
 * limits.projects: null = unlimited, 0 = none, n = cap on existing projects.
 */
import { hasRoomFor } from "./entitlements/types";
import { LIMIT_ERRORS } from "./limitErrors";

export type ProjectCreateDecision = { allowed: boolean; status?: 403 | 409; body?: Record<string, unknown> };

/** Whether the existing-project count is needed (skip the query when unlimited / none). */
export function projectCountNeeded(limit: number | null): boolean {
  return limit !== null && limit > 0;
}

export function decideProjectCreate(input: {
  planHasProjects: boolean;
  planId: string;
  limit: number | null;
  existingCount: number;
}): ProjectCreateDecision {
  if (!input.planHasProjects) {
    return {
      allowed: false,
      status: 403,
      body: { error: LIMIT_ERRORS.FEATURE_NOT_ENTITLED, reason: "Projects are not available on your plan", planId: input.planId },
    };
  }
  const limit = input.limit;
  if (limit === null) return { allowed: true };
  const count = limit === 0 ? 0 : Math.max(0, Number(input.existingCount) || 0);
  if (hasRoomFor(count, limit)) return { allowed: true };
  return {
    allowed: false,
    status: 409,
    body: {
      error: LIMIT_ERRORS.LIMIT_EXCEEDED,
      reason: limit === 0 ? "Projects are not included in your plan" : "Max projects limit reached",
      limit,
    },
  };
}
