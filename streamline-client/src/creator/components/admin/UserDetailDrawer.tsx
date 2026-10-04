import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ResetCodeDialog, type IssuedResetCode } from "../ResetCodeDialog";
import { PlanOverridePanel, type AdminPlanOverrideView } from "./PlanOverridePanel";
import { UsageCreditsPanel } from "./UsageCreditsPanel";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { adminRequest, badgeStyle, formatAgo, formatBytes, formatDateTime, formatLimitMinutes, humanize, ui } from "./adminUi";

export type UserDetail = {
  profile: {
    uid: string;
    email: string | null;
    displayName: string | null;
    createdAt: number | null;
    lastActiveAt: number | null;
    accountStatus: string;
    deleted: boolean;
    deletedAtMs: number | null;
    deleteAfterMs: number | null;
    isAdmin: boolean;
    authRevokedAtMs: number | null;
    passwordReset?: { active?: boolean; expiresAt?: number | null } | null;
    recoveryConfigured?: boolean;
    canEnablePasswordReset?: boolean;
  };
  plan: {
    basePlanId: string;
    stripePlanId: string | null;
    effectivePlanId: string;
    effectivePlanName?: string;
    decidedBy: string;
    subscriptionBlockedReason: string | null;
    planOverride: AdminPlanOverrideView;
  };
  usage: {
    monthKey: string;
    streamingMinutes: number;
    destinationMinutes: number;
    recordingMinutes: number;
    hlsMinutes?: number;
    limitMinutes: number | null;
    planAllowanceMinutes: number | null;
    creditRemainingMinutes: number | null;
    isBlocked: boolean;
    storageUsedBytes: number;
    storageLimitBytes: number | null;
  };
  rooms: { count: number | null; recent: Array<{ roomId: string; name: string | null; status: string | null; access: string | null; createdAt: number | null }> };
  recordings: {
    count: number | null;
    recent: Array<{ id: string; title: string | null; status: string | null; startedAt: number | null; billedMinutes: number | null }>;
  };
  billing: {
    status: string;
    stripeCustomerId: string | null;
    subscriptionId: string | null;
    billingEnabled: boolean;
    platformBillingEnabled: boolean;
    pendingPlan?: unknown;
  };
  auditLog: Array<{ id: string; action: string | null; adminId: string | null; timestampMs: number | null; details: Record<string, unknown> }>;
};

export type UserDetailDrawerProps = {
  userId: string;
  planOptions: Array<{ id: string; name?: string }>;
  onClose: () => void;
  onMessage?: (msg: string) => void;
  /** Called after any change (plan, credits, delete, restore, revoke). */
  onChanged?: () => void | Promise<void>;
};

const overlay: CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 250, display: "flex", justifyContent: "flex-end" };
const drawer: CSSProperties = {
  width: "min(760px, 100vw)",
  height: "100%",
  overflowY: "auto",
  background: "#0b1120",
  borderLeft: "1px solid #1f2937",
  padding: 20,
  boxSizing: "border-box",
  color: "#e5e7eb",
};
const row: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, padding: "4px 0" };

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={row}>
      <span style={{ color: "#9ca3af" }}>{label}</span>
      <span style={{ textAlign: "right", wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

/**
 * Admin user detail: profile, plan sources (base / Stripe / override /
 * effective), usage this month, credits, rooms, recordings, billing state,
 * recent admin audit entries, and actions (revoke sessions, password reset
 * code, delete, restore). Backed by GET /api/admin/users/:id/detail.
 */
export function UserDetailDrawer({ userId, planOptions, onClose, onMessage, onChanged }: UserDetailDrawerProps) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedResetCode | null>(null);
  const [deleting, setDeleting] = useState(false);

  const notify = (msg: string) => (onMessage ? onMessage(msg) : undefined);

  const load = useCallback(async () => {
    const res = await adminRequest<UserDetail>(`/api/admin/users/${encodeURIComponent(userId)}/detail`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setDetail(res.data);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = async () => {
    await load();
    await onChanged?.();
  };

  const revokeSessions = async () => {
    if (!detail) return;
    const reason = window.prompt(
      `Sign ${detail.profile.email || userId} out of every device? Existing sessions stop working immediately. Reason (optional):`,
      ""
    );
    if (reason === null) return;
    setBusy("revoke");
    try {
      const res = await adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, { method: "POST", json: { reason } });
      notify(res.ok ? "Sessions revoked" : `Revoke failed: ${res.error}`);
      if (res.ok) await changed();
    } finally {
      setBusy(null);
    }
  };

  const issueResetCode = async () => {
    if (!detail) return;
    if (detail.profile.passwordReset?.active && !window.confirm("Issue a new reset code? The previous code will stop working.")) return;
    setBusy("reset");
    try {
      const res = await adminRequest<{ resetSecret?: string; passwordReset?: { expiresAt?: number | null } }>(
        `/api/admin/users/${encodeURIComponent(userId)}/enable-password-reset`,
        { method: "POST" }
      );
      if (!res.ok) {
        notify(`Enable reset failed: ${res.error}`);
        return;
      }
      if (res.data.resetSecret) {
        setIssued({ email: detail.profile.email || userId, code: res.data.resetSecret, expiresAt: res.data.passwordReset?.expiresAt ?? null });
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!window.confirm("Restore this account? A Stripe subscription canceled by the deletion is NOT restored.")) return;
    setBusy("restore");
    try {
      const res = await adminRequest<{ stripeWasCanceled?: boolean }>(`/api/admin/users/${encodeURIComponent(userId)}/restore`, { method: "POST" });
      notify(res.ok ? (res.data.stripeWasCanceled ? "Account restored (Stripe subscription stays canceled)" : "Account restored") : `Restore failed: ${res.error}`);
      if (res.ok) await changed();
    } finally {
      setBusy(null);
    }
  };

  const p = detail?.profile;
  return (
    <div style={overlay} onClick={onClose} role="presentation">
      <aside style={drawer} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="User detail">
        {issued && <ResetCodeDialog issued={issued} onClose={() => setIssued(null)} />}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{p?.displayName || p?.email || userId}</h2>
            <div style={ui.muted}>{p?.email || ""}</div>
          </div>
          <button type="button" style={ui.ghostButton} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error && (
          <div role="alert" style={{ color: "#fca5a5", marginBottom: 12 }}>
            Failed to load user: {error}
          </div>
        )}
        {!detail && !error && <div style={ui.muted}>Loading…</div>}

        {detail && p && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {p.deleted ? (
                <button type="button" style={ui.button} disabled={busy !== null} onClick={restore}>
                  {busy === "restore" ? "Restoring…" : "Restore account"}
                </button>
              ) : (
                <>
                  <button type="button" style={ui.ghostButton} disabled={busy !== null} onClick={revokeSessions}>
                    {busy === "revoke" ? "Revoking…" : "Revoke sessions"}
                  </button>
                  <button
                    type="button"
                    style={ui.ghostButton}
                    disabled={busy !== null || p.canEnablePasswordReset === false}
                    title={p.canEnablePasswordReset === false ? "Only available for other non-admin users" : "Issue a one-time password reset code"}
                    onClick={issueResetCode}
                  >
                    {busy === "reset" ? "Issuing…" : p.passwordReset?.active ? "New reset code" : "Password reset code"}
                  </button>
                  <button type="button" style={ui.dangerButton} disabled={busy !== null} onClick={() => setDeleting(true)}>
                    Delete account
                  </button>
                </>
              )}
            </div>

            <section style={ui.card}>
              <h3 style={ui.h3}>Profile</h3>
              <Field label="UID" value={<code>{p.uid}</code>} />
              <Field label="Status" value={<span style={badgeStyle(p.deleted ? "failed" : "success")}>{humanize(p.accountStatus)}</span>} />
              {p.deleted && <Field label="Purge after" value={formatDateTime(p.deleteAfterMs)} />}
              <Field label="Created" value={formatDateTime(p.createdAt)} />
              <Field label="Last active" value={`${formatAgo(p.lastActiveAt)} (${formatDateTime(p.lastActiveAt)})`} />
              <Field label="Platform admin" value={p.isAdmin ? "Yes" : "No"} />
              <Field label="Sessions revoked at" value={formatDateTime(p.authRevokedAtMs)} />
              <Field label="Recovery configured" value={p.recoveryConfigured ? "Yes" : "No"} />
            </section>

            <section style={ui.card}>
              <h3 style={ui.h3}>Plan</h3>
              <Field label="Effective plan" value={<b>{detail.plan.effectivePlanName || detail.plan.effectivePlanId}</b>} />
              <Field label="Decided by" value={humanize(detail.plan.decidedBy)} />
              <Field label="Base plan (users.planId)" value={detail.plan.basePlanId} />
              <Field label="Stripe / billing plan" value={detail.plan.stripePlanId || "—"} />
              {detail.plan.subscriptionBlockedReason && <Field label="Billing block" value={detail.plan.subscriptionBlockedReason} />}
              <div style={{ marginTop: 12 }}>
                <PlanOverridePanel
                  userId={userId}
                  basePlanId={detail.plan.basePlanId}
                  effectivePlanId={detail.plan.effectivePlanId}
                  planOverride={detail.plan.planOverride}
                  decidedBy={detail.plan.decidedBy}
                  subscriptionBlockedReason={detail.plan.subscriptionBlockedReason}
                  planOptions={planOptions}
                  onMessage={onMessage}
                  onChanged={changed}
                />
              </div>
            </section>

            <section style={ui.card}>
              <h3 style={ui.h3}>Usage this month ({detail.usage.monthKey})</h3>
              <Field
                label="Streaming minutes"
                value={`${Math.round(detail.usage.streamingMinutes)} / ${formatLimitMinutes(detail.usage.limitMinutes)}${detail.usage.isBlocked ? " (blocked)" : ""}`}
              />
              <Field label="Plan allowance" value={formatLimitMinutes(detail.usage.planAllowanceMinutes)} />
              <Field label="Destination minutes" value={Math.round(detail.usage.destinationMinutes)} />
              <Field label="Recording minutes" value={Math.round(detail.usage.recordingMinutes)} />
              <Field label="Storage" value={`${formatBytes(detail.usage.storageUsedBytes)} / ${formatBytes(detail.usage.storageLimitBytes)}`} />
              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>One-time usage credits</div>
                <UsageCreditsPanel userId={userId} onMessage={onMessage} onChanged={changed} />
              </div>
            </section>

            <section style={ui.card}>
              <h3 style={ui.h3}>Billing</h3>
              <Field label="Status" value={humanize(detail.billing.status)} />
              <Field label="Stripe customer" value={detail.billing.stripeCustomerId || "—"} />
              <Field label="Subscription" value={detail.billing.subscriptionId || "—"} />
              <Field label="User billing" value={detail.billing.billingEnabled ? "On" : "Off (test mode)"} />
              <Field label="Platform billing" value={detail.billing.platformBillingEnabled ? "On" : "Off"} />
            </section>

            <section style={ui.card}>
              <h3 style={ui.h3}>Rooms ({detail.rooms.count ?? "?"})</h3>
              {detail.rooms.recent.length === 0 ? (
                <div style={ui.muted}>No rooms.</div>
              ) : (
                detail.rooms.recent.map((r) => (
                  <Field
                    key={r.roomId}
                    label={r.name || r.roomId}
                    value={`${humanize(r.status || "idle")} · ${humanize(r.access || "")} · ${formatDateTime(r.createdAt)}`}
                  />
                ))
              )}
            </section>

            <section style={ui.card}>
              <h3 style={ui.h3}>Recordings ({detail.recordings.count ?? "?"})</h3>
              {detail.recordings.recent.length === 0 ? (
                <div style={ui.muted}>No recordings.</div>
              ) : (
                detail.recordings.recent.map((r) => (
                  <Field
                    key={r.id}
                    label={r.title || r.id}
                    value={`${humanize(r.status || "")} · ${formatDateTime(r.startedAt)}${typeof r.billedMinutes === "number" ? ` · ${r.billedMinutes} min` : ""}`}
                  />
                ))
              )}
            </section>

            <section style={ui.card}>
              <h3 style={ui.h3}>Admin audit log</h3>
              {detail.auditLog.length === 0 ? (
                <div style={ui.muted}>No admin actions recorded for this user.</div>
              ) : (
                detail.auditLog.map((e) => (
                  <div key={e.id} style={{ fontSize: 13, padding: "4px 0", borderBottom: "1px solid rgba(148,163,184,0.1)" }}>
                    <b>{humanize(e.action || "")}</b> <span style={ui.muted}>· {formatDateTime(e.timestampMs)} · by {e.adminId || "?"}</span>
                  </div>
                ))
              )}
            </section>
          </>
        )}

        {deleting && detail && (
          <DeleteAccountDialog
            targets={[{ uid: userId, email: detail.profile.email, displayName: detail.profile.displayName }]}
            onClose={() => setDeleting(false)}
            onFinished={async (summary) => {
              notify(summary.message);
              setDeleting(false);
              await changed();
            }}
          />
        )}
      </aside>
    </div>
  );
}
