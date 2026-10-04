import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { apiFetchAuth } from "../../../lib/api";
import {
  DEFAULT_DELETION_OPTIONS,
  buildDeleteRequestBody,
  formatBytes,
  formatSubscriptionSummary,
  isDeleteConfirmed,
  subscriptionStillBilling,
  summarizeBulkDeletion,
  toPerUserResult,
  type BulkDeletionSummary,
  type DeletionImpact,
  type DeletionOptions,
  type PerUserDeletionResult,
} from "../../../lib/adminAccountDeletion";

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

export type DeleteTarget = { uid: string; email?: string | null; displayName?: string | null };

export type DeleteAccountDialogProps = {
  targets: DeleteTarget[];
  onClose: () => void;
  /** Called after the run (even with failures) so the caller can reload. */
  onFinished?: (summary: BulkDeletionSummary) => void | Promise<void>;
};

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 300,
  padding: 16,
};
const panel: CSSProperties = {
  width: 620,
  maxWidth: "100%",
  maxHeight: "90vh",
  overflowY: "auto",
  background: "rgba(15,15,15,0.98)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 14,
  color: "#e5e7eb",
  padding: 20,
};
const muted: CSSProperties = { color: "#9ca3af", fontSize: 13 };
const card: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  padding: 10,
  marginBottom: 8,
  background: "rgba(255,255,255,0.03)",
  fontSize: 13,
};
const warn: CSSProperties = {
  border: "1px solid rgba(245,158,11,0.5)",
  background: "rgba(245,158,11,0.12)",
  color: "#fde68a",
  borderRadius: 8,
  padding: 10,
  fontSize: 13,
  margin: "10px 0",
};
const danger: CSSProperties = { ...warn, border: "1px solid rgba(239,68,68,0.5)", background: "rgba(239,68,68,0.12)", color: "#fecaca" };
const input: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #374151",
  background: "#111827",
  color: "#e5e7eb",
  fontSize: 14,
  width: "100%",
  boxSizing: "border-box",
};
const btn: CSSProperties = { padding: "8px 14px", borderRadius: 8, border: "none", fontWeight: 700, cursor: "pointer", fontSize: 14 };

type ImpactState = { loading: boolean; impact: DeletionImpact | null; error: string | null };

/**
 * Admin "Delete Account" dialog (single or bulk). Shows the billing impact
 * first, lets the admin choose the steps, requires typing DELETE, then calls
 * DELETE /api/admin/users/:id per user with the same options and reports
 * every failure (a Stripe cancel failure means that account was NOT deleted).
 */
export function DeleteAccountDialog({ targets, onClose, onFinished }: DeleteAccountDialogProps) {
  const [options, setOptions] = useState<DeletionOptions>(DEFAULT_DELETION_OPTIONS);
  const [confirmText, setConfirmText] = useState("");
  const [impacts, setImpacts] = useState<Record<string, ImpactState>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<PerUserDeletionResult[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const initial: Record<string, ImpactState> = {};
    for (const t of targets) initial[t.uid] = { loading: true, impact: null, error: null };
    setImpacts(initial);
    void (async () => {
      for (const t of targets) {
        let next: ImpactState;
        try {
          const res = await apiFetchAuth(
            `${API_BASE}/api/admin/users/${encodeURIComponent(t.uid)}/deletion-impact`,
            {},
            { allowNonOk: true }
          );
          const body: any = await res.json().catch(() => ({}));
          next = res.ok
            ? { loading: false, impact: (body?.impact as DeletionImpact) || null, error: null }
            : { loading: false, impact: null, error: String(body?.error || `HTTP ${res.status}`) };
        } catch (e: any) {
          next = { loading: false, impact: null, error: e?.message || "Failed to load" };
        }
        if (cancelled) return;
        setImpacts((prev) => ({ ...prev, [t.uid]: next }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targets]);

  const stillBillingCount = useMemo(
    () => targets.filter((t) => subscriptionStillBilling(impacts[t.uid]?.impact)).length,
    [targets, impacts]
  );
  const loadingImpacts = targets.some((t) => impacts[t.uid]?.loading);

  const label = (t: DeleteTarget) => t.email || t.displayName || t.uid;

  const run = async () => {
    if (!isDeleteConfirmed(confirmText) || running) return;
    setRunning(true);
    setProgress(0);
    const out: PerUserDeletionResult[] = [];
    const body = JSON.stringify(buildDeleteRequestBody(options, confirmText));
    for (const t of targets) {
      try {
        const res = await apiFetchAuth(
          `${API_BASE}/api/admin/users/${encodeURIComponent(t.uid)}`,
          { method: "DELETE", headers: { "Content-Type": "application/json" }, body },
          { allowNonOk: true }
        );
        const json: any = await res.json().catch(() => null);
        out.push(toPerUserResult(t.uid, res.status, json, label(t)));
      } catch (e: any) {
        out.push({ uid: t.uid, label: label(t), httpStatus: 0, outcome: "failed", error: e?.message || "network_error" });
      }
      setProgress(out.length);
    }
    setResults(out);
    setRunning(false);
    await onFinished?.(summarizeBulkDeletion(out));
  };

  const summary = results ? summarizeBulkDeletion(results) : null;

  return (
    <div style={overlay} onClick={running ? undefined : onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Delete account">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>
            Delete {targets.length === 1 ? "account" : `${targets.length} accounts`}
          </h3>
          <button onClick={onClose} disabled={running} style={{ ...btn, background: "transparent", color: "#9ca3af" }} aria-label="Close">
            ×
          </button>
        </div>

        <div style={muted}>
          Soft delete: the account is locked immediately and can be restored by an admin for 7 days. With
          media deletion scheduled, recordings, uploads and the account record are purged after that. Restoring
          an account does not restore a canceled Stripe subscription.
        </div>

        <div style={{ marginTop: 12 }}>
          {targets.map((t) => {
            const st = impacts[t.uid];
            const imp = st?.impact || null;
            return (
              <div key={t.uid} style={card}>
                <div style={{ fontWeight: 700 }}>{label(t)}</div>
                {st?.loading ? (
                  <div style={muted}>Loading impact…</div>
                ) : st?.error ? (
                  <div style={{ color: "#fca5a5" }}>Could not load impact: {st.error}</div>
                ) : imp ? (
                  <>
                    <div>
                      <span style={muted}>Subscription: </span>
                      {formatSubscriptionSummary(imp)}
                    </div>
                    <div style={muted}>
                      Rooms: {imp.rooms ?? "?"} · Recordings: {imp.recordings ?? "?"} · Storage: {formatBytes(imp.storageBytes)}
                      {imp.alreadyDeleted ? " · already deleted (re-running finishes the steps)" : ""}
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "12px 0" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={options.cancelStripe}
              disabled={running}
              onChange={(e) => setOptions((o) => ({ ...o, cancelStripe: e.target.checked }))}
            />
            Cancel Stripe subscription (immediately)
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={options.revokeSessions}
              disabled={running}
              onChange={(e) => setOptions((o) => ({ ...o, revokeSessions: e.target.checked }))}
            />
            Revoke active sessions
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={options.scheduleMediaDeletion}
              disabled={running}
              onChange={(e) => setOptions((o) => ({ ...o, scheduleMediaDeletion: e.target.checked }))}
            />
            Schedule media deletion (purge after 7 days)
          </label>
        </div>

        {!options.cancelStripe && stillBillingCount > 0 && (
          <div style={danger}>
            Billing will CONTINUE for {stillBillingCount} account{stillBillingCount === 1 ? "" : "s"}: the Stripe
            subscription stays active after deletion.
          </div>
        )}
        {options.cancelStripe && (
          <div style={muted}>
            If Stripe cancellation fails for an account, that account is not deleted and is listed as failed.
          </div>
        )}
        {!options.scheduleMediaDeletion && (
          <div style={warn}>Media and the account record are kept until you delete them (no automatic purge).</div>
        )}

        <label style={{ display: "block", margin: "12px 0 6px", fontSize: 13 }}>
          Type <b>DELETE</b> to confirm
        </label>
        <input
          style={input}
          value={confirmText}
          disabled={running || !!results}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="DELETE"
          autoComplete="off"
        />

        {summary && (
          <div style={summary.failed.length ? danger : summary.partial.length ? warn : { ...warn, borderColor: "rgba(34,197,94,0.5)", background: "rgba(34,197,94,0.12)", color: "#bbf7d0" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{summary.message}</div>
            {[...summary.failed, ...summary.partial].map((r) => (
              <div key={r.uid}>
                {r.label || r.uid}: {r.outcome} {r.error ? `(${r.error})` : ""} {r.message ? `- ${r.message}` : ""}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button onClick={onClose} disabled={running} style={{ ...btn, background: "#374151", color: "#e5e7eb" }}>
            {results ? "Close" : "Cancel"}
          </button>
          {!results && (
            <button
              onClick={run}
              disabled={running || !isDeleteConfirmed(confirmText) || loadingImpacts}
              style={{
                ...btn,
                background: "#dc2626",
                color: "#fff",
                opacity: running || !isDeleteConfirmed(confirmText) || loadingImpacts ? 0.5 : 1,
              }}
            >
              {running
                ? `Deleting… ${progress}/${targets.length}`
                : `Delete ${targets.length === 1 ? "account" : `${targets.length} accounts`}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default DeleteAccountDialog;
