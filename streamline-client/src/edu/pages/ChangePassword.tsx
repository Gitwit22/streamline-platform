import { FormEvent, useCallback, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { portalChangePassword } from "../api/schoolPortal";

/* ── Shared classes ──────────────────────────────────────────── */
const inputCls =
  "mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10";
const labelCls = "block text-sm font-medium text-slate-300";
const btnPrimary =
  "w-full rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50";

/* ================================================================
   ChangePassword – student forced password change after first login
   Route: /streamline/edu/portal/:schoolSlug/change-password
   ================================================================ */

export default function ChangePassword() {
  const { schoolSlug = "" } = useParams<{ schoolSlug: string }>();
  const [searchParams] = useSearchParams();
  const usernameHint = searchParams.get("u") || "";
  const nav = useNavigate();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError("");

      if (!currentPassword) {
        setError("Enter your temporary password.");
        return;
      }
      if (newPassword.length < 8) {
        setError("New password must be at least 8 characters.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      if (newPassword === currentPassword) {
        setError("New password must be different from the temporary password.");
        return;
      }

      setBusy(true);
      try {
        await portalChangePassword(schoolSlug, {
          username: usernameHint,
          currentPassword,
          newPassword,
        });
        setSuccess(true);
        // Redirect to dashboard after a brief pause so user sees success message
        setTimeout(() => nav("/streamline/edu/dashboard", { replace: true }), 1500);
      } catch (err: any) {
        setError(err?.message || "Failed to change password.");
      } finally {
        setBusy(false);
      }
    },
    [currentPassword, newPassword, confirmPassword, usernameHint, schoolSlug, nav],
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <div className="w-full max-w-md">
        <div className="relative overflow-hidden rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/60 p-8">
          <div aria-hidden className="absolute left-0 right-0 top-0 h-[3px] bg-gradient-to-r from-orange-500 via-red-600 to-violet-600" />

          {success ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-green-500/10">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7 text-green-400">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white">Password Changed!</h2>
              <p className="text-sm text-slate-400">
                Redirecting to your dashboard…
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-white">Set Your Password</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Your teacher created this account. Please choose a new password to continue.
                </p>
              </div>

              {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
              )}

              {usernameHint && (
                <div className="rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm text-slate-300">
                  Username: <span className="font-mono text-orange-300">{usernameHint}</span>
                </div>
              )}

              <div>
                <label className={labelCls} htmlFor="cp-current">Temporary Password</label>
                <input
                  id="cp-current"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  type="password"
                  className={inputCls}
                  placeholder="Enter the password your teacher gave you"
                  autoComplete="current-password"
                />
              </div>

              <div>
                <label className={labelCls} htmlFor="cp-new">New Password</label>
                <input
                  id="cp-new"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  type="password"
                  className={inputCls}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                />
              </div>

              <div>
                <label className={labelCls} htmlFor="cp-confirm">Confirm New Password</label>
                <input
                  id="cp-confirm"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  type="password"
                  className={inputCls}
                  placeholder="Type your new password again"
                  autoComplete="new-password"
                />
              </div>

              <button type="submit" disabled={busy} className={btnPrimary}>
                {busy ? "Changing…" : "Change Password"}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Need help? Contact your school administrator.
        </p>
      </div>
    </div>
  );
}
