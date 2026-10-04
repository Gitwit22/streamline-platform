/**
 * Account deletion workflow (pure orchestration + shaping; I/O is injected).
 * Shared by admin deletion (DELETE /api/admin/users/:id) and self-service
 * close (POST /api/account/close { mode: "delete" }). Wiring: lib/accountDeletion.ts.
 *
 *   1. Cancel Stripe subscription  (optional for admins; always for self-service)
 *   2. Revoke sessions             (authRevokedAtMs + Firebase refresh tokens)
 *   3. Disable account             (soft delete: accountStatus "deleted" + Firebase disabled)
 *   4. Queue data cleanup          (deleteAfterMs = now + window; the maintenance purge
 *                                   deletes media + the user doc after that)
 *   5. Audit event
 *
 * Billing must never outlive a deletion silently: if Stripe cancellation was
 * requested and FAILS, the workflow stops before touching the account and
 * reports `failed` (the account stays active and billable, and the admin sees
 * why). To delete anyway the admin must retry with cancelStripe unchecked,
 * which is recorded in the audit event.
 */

export const DELETION_PURGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type DeletionOptions = {
  cancelStripe: boolean;
  revokeSessions: boolean;
  scheduleMediaDeletion: boolean;
};

export type DeletionActor = { type: "admin" | "self"; uid: string };

export type StripeCancelStatus =
  | "canceled"
  | "already_canceled"
  | "not_found"
  | "no_subscription"
  | "skipped"
  | "failed";

export type StripeCancelResult = {
  status: StripeCancelStatus;
  subscriptionId: string | null;
  error?: string;
};

export type StepStatus = "ok" | "skipped" | "failed";
export type StepResult = { status: StepStatus; error?: string; detail?: string };

export type DeletionOutcome = "completed" | "partial" | "failed";

export type DeletionResult = {
  uid: string;
  outcome: DeletionOutcome;
  /** Suggested HTTP status: 200 completed, 207 partial, 502 Stripe failure, 500 other failure, 404 missing user. */
  httpStatus: number;
  error?: string;
  message: string;
  options: DeletionOptions;
  steps: {
    stripe: StripeCancelResult;
    sessions: StepResult;
    disable: StepResult;
    cleanup: StepResult & { deleteAfterMs?: number | null };
    audit: StepResult;
  };
  deletedAtMs: number | null;
  deleteAfterMs: number | null;
};

export type DeletionDeps = {
  now: () => number;
  loadUser: (uid: string) => Promise<any | null>;
  cancelSubscription: (subscriptionId: string) => Promise<StripeCancelResult>;
  /** Firestore user doc merge-patch. */
  patchUser: (uid: string, patch: Record<string, any>) => Promise<void>;
  /** Firebase Auth: revoke refresh tokens (user-not-found should resolve). */
  revokeAuthTokens: (uid: string) => Promise<void>;
  /** Firebase Auth: disable the identity (user-not-found should resolve). */
  disableAuthUser: (uid: string) => Promise<void>;
  audit: (event: Record<string, any>) => Promise<void>;
};

function errMsg(e: any): string {
  return String(e?.message || e?.code || e || "error");
}

/** Stripe subscription id stored on the user doc (billing.subscriptionId / stripeSubscriptionId). */
export function readSubscriptionId(user: any): string | null {
  const v = user?.billingTruth?.subscriptionId ?? user?.billing?.subscriptionId ?? user?.stripeSubscriptionId;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Parse admin DELETE body. Every checkbox defaults to ON (safe default:
 * billing stops); `confirm` must be exactly "DELETE".
 */
export function parseDeletionRequest(
  body: any
): { ok: boolean; options?: DeletionOptions; error?: string; details?: string } {
  const b = body || {};
  if (String(b.confirm ?? "").trim() !== "DELETE") {
    return { ok: false, error: "confirmation_required", details: 'Type DELETE to confirm (body.confirm = "DELETE")' };
  }
  const flag = (v: unknown) => (v === undefined || v === null ? true : v === true || v === "true");
  for (const key of ["cancelStripe", "revokeSessions", "scheduleMediaDeletion"]) {
    const v = b[key];
    if (v !== undefined && v !== null && typeof v !== "boolean" && v !== "true" && v !== "false") {
      return { ok: false, error: "invalid_option", details: `${key} must be a boolean` };
    }
  }
  return {
    ok: true,
    options: {
      cancelStripe: flag(b.cancelStripe),
      revokeSessions: flag(b.revokeSessions),
      scheduleMediaDeletion: flag(b.scheduleMediaDeletion),
    },
  };
}

/** Outcome from step results (exported for tests). */
export function summarizeDeletionOutcome(steps: DeletionResult["steps"]): { outcome: DeletionOutcome; httpStatus: number } {
  if (steps.stripe.status === "failed") return { outcome: "failed", httpStatus: 502 };
  if (steps.disable.status === "failed") return { outcome: "failed", httpStatus: 500 };
  const partial =
    [steps.sessions, steps.cleanup, steps.audit].some((s) => s.status === "failed") || Boolean(steps.disable.error);
  return partial ? { outcome: "partial", httpStatus: 207 } : { outcome: "completed", httpStatus: 200 };
}

export async function runAccountDeletion(
  deps: DeletionDeps,
  req: { uid: string; actor: DeletionActor; options: DeletionOptions; reason: string }
): Promise<DeletionResult> {
  const { uid, actor, options } = req;
  const nowMs = deps.now();
  const steps: DeletionResult["steps"] = {
    stripe: { status: "skipped", subscriptionId: null },
    sessions: { status: "skipped" },
    disable: { status: "skipped" },
    cleanup: { status: "skipped", deleteAfterMs: null },
    audit: { status: "skipped" },
  };

  const user = await deps.loadUser(uid);
  if (!user) {
    return {
      uid,
      outcome: "failed",
      httpStatus: 404,
      error: "user_not_found",
      message: "User not found",
      options,
      steps,
      deletedAtMs: null,
      deleteAfterMs: null,
    };
  }

  const finish = async (): Promise<DeletionResult> => {
    // 5. Audit (always, including failed attempts).
    try {
      await deps.audit({
        uid,
        actor,
        reason: req.reason,
        options,
        steps: {
          stripe: steps.stripe,
          sessions: steps.sessions,
          disable: steps.disable,
          cleanup: steps.cleanup,
        },
        outcome: summarizeDeletionOutcome({ ...steps, audit: { status: "ok" } }).outcome,
        atMs: nowMs,
      });
      steps.audit = { status: "ok" };
    } catch (e) {
      steps.audit = { status: "failed", error: errMsg(e) };
    }
    const { outcome, httpStatus } = summarizeDeletionOutcome(steps);
    const deletedAtMs = steps.disable.status === "ok" ? existingDeletedAtMs ?? nowMs : null;
    const message =
      outcome === "completed"
        ? "Account deleted"
        : outcome === "partial"
          ? "Account disabled, but some steps failed (see steps)"
          : steps.stripe.status === "failed"
            ? "Stripe subscription could not be canceled; the account was NOT deleted. Retry, or uncheck \"Cancel Stripe subscription\" to delete while leaving billing active."
            : "Account could not be disabled";
    return {
      uid,
      outcome,
      httpStatus,
      ...(outcome === "failed" ? { error: steps.stripe.status === "failed" ? "stripe_cancel_failed" : "disable_failed" } : {}),
      message,
      options,
      steps,
      deletedAtMs,
      deleteAfterMs: steps.cleanup.status === "ok" ? steps.cleanup.deleteAfterMs ?? null : null,
    };
  };

  const existingDeletedAtMs = typeof user.deletedAtMs === "number" && user.deletedAtMs > 0 ? user.deletedAtMs : null;

  // 1. Stripe
  const subscriptionId = readSubscriptionId(user);
  if (!options.cancelStripe) {
    steps.stripe = { status: "skipped", subscriptionId };
  } else if (!subscriptionId) {
    steps.stripe = { status: "no_subscription", subscriptionId: null };
  } else {
    try {
      steps.stripe = await deps.cancelSubscription(subscriptionId);
    } catch (e) {
      steps.stripe = { status: "failed", subscriptionId, error: errMsg(e) };
    }
    if (steps.stripe.status === "failed") {
      // Do not pretend: nothing else runs, the account stays as it was.
      return finish();
    }
  }

  // 2. Revoke sessions
  if (options.revokeSessions) {
    const errors: string[] = [];
    try {
      await deps.patchUser(uid, { authRevokedAtMs: nowMs, updatedAt: nowMs });
    } catch (e) {
      errors.push(`firestore: ${errMsg(e)}`);
    }
    try {
      await deps.revokeAuthTokens(uid);
    } catch (e) {
      errors.push(`firebase: ${errMsg(e)}`);
    }
    steps.sessions = errors.length ? { status: "failed", error: errors.join("; ") } : { status: "ok" };
  }

  // 3. Disable account (soft delete)
  try {
    await deps.patchUser(uid, {
      accountStatus: "deleted",
      deletedAtMs: existingDeletedAtMs ?? nowMs,
      deletionRequestedAtMs: nowMs,
      deletionReason: req.reason,
      deletedBy: actor.uid,
      deletion: {
        requestedAtMs: nowMs,
        actor,
        options,
        stripe: { status: steps.stripe.status, subscriptionId: steps.stripe.subscriptionId },
      },
      ...(steps.stripe.status === "canceled" || steps.stripe.status === "already_canceled"
        ? { subscriptionCanceledOnDeletionAtMs: nowMs }
        : {}),
      updatedAt: nowMs,
    });
    steps.disable = { status: "ok" };
  } catch (e) {
    steps.disable = { status: "failed", error: errMsg(e) };
    return finish();
  }
  try {
    await deps.disableAuthUser(uid);
  } catch (e) {
    // The Firestore soft delete already locks requireAuth / login, so the
    // account IS disabled; report the Firebase failure as a partial result.
    steps.disable = { status: "ok", detail: "firebase_disable_failed", error: errMsg(e) };
  }

  // 4. Queue data cleanup
  try {
    if (options.scheduleMediaDeletion) {
      const deleteAfterMs = nowMs + DELETION_PURGE_WINDOW_MS;
      await deps.patchUser(uid, { deleteAfterMs, dataCleanup: { scheduled: true, scheduledAtMs: nowMs, deleteAfterMs } });
      steps.cleanup = { status: "ok", deleteAfterMs };
    } else {
      // No deleteAfterMs => the maintenance purge never picks this account up.
      await deps.patchUser(uid, { deleteAfterMs: null, dataCleanup: { scheduled: false, decidedAtMs: nowMs } });
      steps.cleanup = { status: "skipped", deleteAfterMs: null, detail: "media_retained" };
    }
  } catch (e) {
    steps.cleanup = { status: "failed", error: errMsg(e), deleteAfterMs: null };
  }

  return finish();
}
