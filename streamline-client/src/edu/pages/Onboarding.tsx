import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiUnauthorizedError, apiFetchAuth } from "../../lib/api";
import { createTopAdmin, resetDemoOrg, setOnboardingProgress } from "../api/onboarding";

function useQueryStep(): number {
  const location = useLocation();
  try {
    const sp = new URLSearchParams(location.search || "");
    const raw = sp.get("step");
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return 1;
    const step = Math.floor(n);
    return Math.max(1, Math.min(5, step));
  } catch {
    return 1;
  }
}

export default function Onboarding() {
  const nav = useNavigate();
  const location = useLocation();
  const step = useQueryStep();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [info, setInfo] = useState<string>("");

  const [orgName, setOrgName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    // Keep the URL normalized so refresh/resume is stable, but don't fight user navigation.
    const sp = new URLSearchParams(location.search || "");
    const current = sp.get("step");
    if (current !== String(step)) {
      const next = new URLSearchParams();
      next.set("step", String(step));
      nav(`/streamline/edu/onboarding?${next.toString()}`, { replace: true });
    }
  }, [location.search, nav, step]);

  const stepTitle = useMemo(() => {
    if (step === 1) return "Reset demo (admin-only)";
    if (step === 2) return "Create your Top Admin";
    if (step === 3) return "School info";
    if (step === 4) return "Add people";
    return "Events + embed";
  }, [step]);

  function goStep(n: number) {
    nav(`/streamline/edu/onboarding?step=${Math.max(1, Math.min(5, n))}`);
  }

  async function hydrateMe() {
    try {
      await apiFetchAuth("/api/account/me", { method: "GET", cache: "no-store" });
    } catch {
      // ignore
    }
  }

  async function markProgress(nextStep: number) {
    try {
      await setOnboardingProgress(nextStep);
    } catch {
      // Non-blocking; the wizard can continue even if progress persistence fails.
    }
  }

  async function onResetDemo() {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      const out = await resetDemoOrg();
      setInfo(`Demo reset complete. Deleted orgMembers=${out?.deleted?.orgMembers ?? 0}.`);
    } catch (err: any) {
      if (err instanceof ApiUnauthorizedError || err?.status === 401) {
        setError("Reset requires a platform admin session. Sign in as admin first.");
      } else {
        setError(err?.body?.error || err?.message || "Reset failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onCreateTopAdmin(e: FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      const out = await createTopAdmin({
        orgName: orgName.trim() || "Your School",
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        password,
        confirmPassword,
      });

      try {
        localStorage.setItem("authToken", out.token);
      } catch {}

      await hydrateMe();
      await markProgress(3);
      setInfo("Top Admin created. You are now signed in.");
      goStep(3);
    } catch (err: any) {
      setError(err?.body?.error || err?.message || "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <div className="text-2xl font-bold tracking-tight">Set up your school</div>
            <div className="mt-1 text-sm text-slate-400">Guided onboarding (tenant-scoped, safe reset)</div>
          </div>
          <Link
            to="/streamline/edu/login"
            className="rounded-xl border border-slate-700 bg-slate-900/40 px-4 py-2 text-sm text-slate-200 hover:border-slate-600 hover:bg-slate-800/40"
          >
            Back to login
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-5">
              <div className="text-sm font-semibold text-slate-200">Progress</div>
              <div className="mt-4 space-y-2 text-sm">
                {[1, 2, 3, 4, 5].map((n) => (
                  <div
                    key={n}
                    className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                      n === step
                        ? "border-orange-500/40 bg-orange-500/10"
                        : "border-slate-800/50 bg-slate-900/30"
                    }`}
                  >
                    <div className="font-medium">Step {n}</div>
                    <div className="text-xs text-slate-400">
                      {n === 1
                        ? "Reset demo"
                        : n === 2
                          ? "Top Admin"
                          : n === 3
                            ? "School info"
                            : n === 4
                              ? "Add people"
                              : "Events + embed"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-8">
            <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
              <div className="text-lg font-semibold">Step {step}: {stepTitle}</div>
              <div className="mt-2 text-sm text-slate-400">
                This flow is tenant-scoped. No endpoints here perform global wipes.
              </div>

              {error ? (
                <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              ) : null}
              {info ? (
                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  {info}
                </div>
              ) : null}

              {step === 1 ? (
                <div className="mt-6 space-y-4">
                  <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-4 text-sm text-slate-300">
                    Optional: reset the shared demo org. This action is guarded and requires a platform admin session.
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={onResetDemo}
                      className="rounded-xl border border-slate-700 bg-slate-900/30 px-4 py-2 text-sm text-slate-200 hover:border-slate-600 hover:bg-slate-800/40 disabled:opacity-60"
                    >
                      {busy ? "Resetting…" : "Reset demo org"}
                    </button>
                    <button
                      type="button"
                      onClick={() => goStep(2)}
                      className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ) : null}

              {step === 2 ? (
                <form onSubmit={onCreateTopAdmin} className="mt-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300">School name</label>
                    <input
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10"
                      placeholder="Example High School"
                      autoComplete="organization"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-slate-300">First name</label>
                      <input
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10"
                        placeholder="Jordan"
                        autoComplete="given-name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300">Last name</label>
                      <input
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10"
                        placeholder="Lee"
                        autoComplete="family-name"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300">Email</label>
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10"
                      placeholder="you@school.edu"
                      type="email"
                      autoComplete="email"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300">Phone (optional)</label>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10"
                      placeholder="(555) 555-5555"
                      autoComplete="tel"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-slate-300">Password</label>
                      <input
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10"
                        type="password"
                        autoComplete="new-password"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300">Confirm</label>
                      <input
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10"
                        type="password"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => goStep(1)}
                      className="rounded-xl border border-slate-700 bg-slate-900/30 px-4 py-2 text-sm text-slate-200 hover:border-slate-600 hover:bg-slate-800/40"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {busy ? "Creating…" : "Create Top Admin"}
                    </button>
                  </div>
                </form>
              ) : null}

              {step === 3 ? (
                <div className="mt-6 space-y-4">
                  <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-4 text-sm text-slate-300">
                    Update your school settings (branding, policies, etc.).
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Link
                      to="/streamline/edu/settings"
                      className="rounded-xl border border-slate-700 bg-slate-900/30 px-4 py-2 text-sm text-slate-200 hover:border-slate-600 hover:bg-slate-800/40"
                    >
                      Open settings
                    </Link>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        await markProgress(4);
                        setBusy(false);
                        goStep(4);
                      }}
                      className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ) : null}

              {step === 4 ? (
                <div className="mt-6 space-y-4">
                  <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-4 text-sm text-slate-300">
                    Invite faculty and students. Faculty Admin is required for role changes.
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Link
                      to="/streamline/edu/people"
                      className="rounded-xl border border-slate-700 bg-slate-900/30 px-4 py-2 text-sm text-slate-200 hover:border-slate-600 hover:bg-slate-800/40"
                    >
                      Open people
                    </Link>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        await markProgress(5);
                        setBusy(false);
                        goStep(5);
                      }}
                      className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ) : null}

              {step === 5 ? (
                <div className="mt-6 space-y-4">
                  <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-4 text-sm text-slate-300">
                    Create your first event, then generate an embed code for your website.
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Link
                      to="/streamline/edu/events"
                      className="rounded-xl border border-slate-700 bg-slate-900/30 px-4 py-2 text-sm text-slate-200 hover:border-slate-600 hover:bg-slate-800/40"
                    >
                      Open events
                    </Link>
                    <Link
                      to="/streamline/edu/embed"
                      className="rounded-xl border border-slate-700 bg-slate-900/30 px-4 py-2 text-sm text-slate-200 hover:border-slate-600 hover:bg-slate-800/40"
                    >
                      Open embed tools
                    </Link>
                    <Link
                      to="/streamline/edu/dashboard"
                      className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white"
                    >
                      Finish
                    </Link>
                  </div>
                </div>
              ) : null}

              {step !== 1 && step !== 2 && step !== 3 && step !== 4 && step !== 5 ? (
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => goStep(step - 1)}
                    className="rounded-xl border border-slate-700 bg-slate-900/30 px-4 py-2 text-sm text-slate-200 hover:border-slate-600 hover:bg-slate-800/40"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => goStep(step + 1)}
                    className="rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white"
                  >
                    Continue
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mt-4 rounded-2xl border border-slate-800/60 bg-slate-900/30 p-5 text-sm text-slate-300">
              Guardrail: onboarding/reset will be per-org (no global wipes).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
