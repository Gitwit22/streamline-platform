import { FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  lookupSchoolBySlug,
  portalLogin,
  activateStaffAccount,
  validateStudentForActivation,
  activateStudentAccount,
  type SchoolPublicInfo,
} from "../api/schoolPortal";
import { setEduLane } from "../state/eduMode";

/* ── Shared styles ─────────────────────────────────────────────── */
const inputCls =
  "mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/10";
const labelCls = "block text-sm font-medium text-slate-300";
const btnPrimary =
  "w-full rounded-xl bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50";
const btnSecondary =
  "w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3.5 text-sm font-medium text-slate-200 transition hover:bg-slate-700 disabled:opacity-50";

/* ── Top-level tabs ────────────────────────────────────────────── */
type TabId = "faculty" | "students";
const TABS: { key: TabId; label: string }[] = [
  { key: "faculty", label: "Faculty" },
  { key: "students", label: "Students" },
];

/* ── Reserved slugs ────────────────────────────────────────────── */
const RESERVED = new Set(["admin", "login", "demo", "onboarding", "api", "embed", "settings", "dashboard", "broadcast", "learn-more", "get-started"]);

/* ================================================================
   SchoolPortal — the /:schoolSlug page
   ================================================================ */

export default function SchoolPortal() {
  const { schoolSlug = "" } = useParams<{ schoolSlug: string }>();
  const nav = useNavigate();

  const [school, setSchool] = useState<SchoolPublicInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("faculty");

  /* ── Fetch school info by slug ─────────────────────────────── */
  useEffect(() => {
    setEduLane();

    if (!schoolSlug || RESERVED.has(schoolSlug.toLowerCase())) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    lookupSchoolBySlug(schoolSlug)
      .then((s) => {
        if (cancelled) return;
        if (!s || s.status !== "active") {
          setNotFound(true);
        } else {
          setSchool(s);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [schoolSlug]);

  /* ── Loading ───────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
      </div>
    );
  }

  /* ── Not found ─────────────────────────────────────────────── */
  if (notFound) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8 text-red-400">
            <path d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white">School Not Found</h1>
        <p className="max-w-md text-sm text-slate-400">
          We couldn't find a school with the URL <span className="font-mono text-orange-300">/{schoolSlug}</span>.
          Check with your administrator for the correct link.
        </p>
        <button
          onClick={() => nav("/streamline/edu")}
          className="mt-4 rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 text-sm text-slate-200 hover:bg-slate-700"
        >
          Go to StreamLine EDU
        </button>
      </div>
    );
  }

  /* ── Portal ────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <style>{`
        @keyframes spFadeUp { from { opacity: 0; transform: translateY(20px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            {school?.logoUrl ? (
              <img src={school.logoUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-red-600 text-lg font-bold text-white">
                {school?.name?.charAt(0) || "S"}
              </div>
            )}
            <div>
              <div className="font-semibold text-white">{school?.name}</div>
              {school?.district && (
                <div className="text-xs text-slate-400">{school.district}</div>
              )}
            </div>
          </div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-slate-500">
            Powered by <span className="text-orange-400">StreamLine EDU</span>
          </div>
        </div>
      </header>

      {/* Main card */}
      <main className="mx-auto max-w-md px-6 py-12" style={{ animation: "spFadeUp 0.6s ease-out" }}>
        {/* Two-tab selector */}
        <div className="mb-8 flex rounded-xl border border-slate-700 bg-slate-900 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-gradient-to-r from-orange-500/20 to-red-600/20 text-orange-300"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Auth card */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/60 p-8">
          <div aria-hidden className="absolute left-0 right-0 top-0 h-[3px] bg-gradient-to-r from-orange-500 via-red-600 to-violet-600" />

          {tab === "faculty" && <FacultyPanel school={school!} slug={schoolSlug} nav={nav} />}
          {tab === "students" && <StudentPanel school={school!} slug={schoolSlug} nav={nav} />}
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-slate-500">
          Need help accessing your account? Contact your school administrator.
        </p>
      </main>
    </div>
  );
}

/* ================================================================
   FACULTY PANEL — sign-in + inline activate
   ================================================================ */

type FacultyView = "login" | "activate";

function FacultyPanel({ school, slug, nav }: { school: SchoolPublicInfo; slug: string; nav: ReturnType<typeof useNavigate> }) {
  const [view, setView] = useState<FacultyView>("login");

  return view === "login"
    ? <FacultyLoginForm school={school} slug={slug} nav={nav} onActivate={() => setView("activate")} />
    : <FacultyActivateForm school={school} slug={slug} nav={nav} onBack={() => setView("login")} />;
}

/* ── Faculty sign-in ─────────────────────────────────────────── */

function FacultyLoginForm({
  school, slug, nav, onActivate,
}: {
  school: SchoolPublicInfo; slug: string; nav: ReturnType<typeof useNavigate>; onActivate: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError("");
      if (!username.trim() || !password) {
        setError("Please enter your username and password.");
        return;
      }
      setBusy(true);
      try {
        const result = await portalLogin(slug, { username: username.trim(), password, accountType: "staff" });
        try { localStorage.setItem("authToken", result.token); } catch {}
        setEduLane();
        nav("/streamline/edu/dashboard", { replace: true });
      } catch (err: any) {
        setError(err?.message || "Invalid credentials");
      } finally {
        setBusy(false);
      }
    },
    [username, password, slug, nav],
  );

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white">Faculty Sign In</h2>
        <p className="mt-1 text-sm text-slate-400">Sign in with your {school.name} credentials.</p>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div>
        <label className={labelCls} htmlFor="fac-user">Username</label>
        <input id="fac-user" value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} placeholder="your.username" autoComplete="username" />
      </div>
      <div>
        <label className={labelCls} htmlFor="fac-pass">Password</label>
        <input id="fac-pass" value={password} onChange={(e) => setPassword(e.target.value)} type="password" className={inputCls} placeholder="••••••••" autoComplete="current-password" />
      </div>

      <button type="submit" disabled={busy} className={btnPrimary}>
        {busy ? "Signing in…" : "Sign In"}
      </button>

      <button type="button" onClick={onActivate} className={btnSecondary}>
        Activate Account
      </button>
    </form>
  );
}

/* ── Faculty activation ──────────────────────────────────────── */

function FacultyActivateForm({
  school, slug, nav, onBack,
}: {
  school: SchoolPublicInfo; slug: string; nav: ReturnType<typeof useNavigate>; onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [position, setPosition] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError("");
      if (!code.trim()) { setError("Onboarding code is required."); return; }
      if (!fullName.trim()) { setError("Full name is required."); return; }
      if (!username.trim()) { setError("Choose a username."); return; }
      if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
      if (password !== confirmPassword) { setError("Passwords do not match."); return; }

      setBusy(true);
      try {
        const result = await activateStaffAccount(slug, {
          onboardingCode: code.trim().toUpperCase(),
          fullName: fullName.trim(),
          username: username.trim(),
          password,
          confirmPassword,
          positionTitle: position.trim(),
        });
        try { localStorage.setItem("authToken", result.token); } catch {}
        setEduLane();
        nav("/streamline/edu/dashboard", { replace: true });
      } catch (err: any) {
        setError(err?.message || "Activation failed");
      } finally {
        setBusy(false);
      }
    },
    [code, fullName, username, password, confirmPassword, position, slug, nav],
  );

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <button type="button" onClick={onBack} className="mb-2 text-xs text-slate-400 hover:text-orange-300">
          ← Back to sign in
        </button>
        <h2 className="text-xl font-bold text-white">Activate Faculty Account</h2>
        <p className="mt-1 text-sm text-slate-400">
          Use the activation code your administrator gave you to set up your {school.name} account.
        </p>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div>
        <label className={labelCls} htmlFor="fac-act-code">Activation Code</label>
        <input
          id="fac-act-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className={inputCls + " font-mono tracking-widest uppercase"}
          placeholder="DSA-456"
          autoComplete="off"
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="fac-act-name">Full Name</label>
        <input id="fac-act-name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} placeholder="Jordan Lee" autoComplete="name" />
      </div>

      <div>
        <label className={labelCls} htmlFor="fac-act-title">Position / Title</label>
        <input id="fac-act-title" value={position} onChange={(e) => setPosition(e.target.value)} className={inputCls} placeholder="Media Arts Teacher" autoComplete="organization-title" />
      </div>

      <div>
        <label className={labelCls} htmlFor="fac-act-user">Choose Username</label>
        <input id="fac-act-user" value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} placeholder="jordan.lee" autoComplete="username" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="fac-act-pass">Password</label>
          <input id="fac-act-pass" value={password} onChange={(e) => setPassword(e.target.value)} type="password" className={inputCls} autoComplete="new-password" />
        </div>
        <div>
          <label className={labelCls} htmlFor="fac-act-confirm">Confirm</label>
          <input id="fac-act-confirm" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} type="password" className={inputCls} autoComplete="new-password" />
        </div>
      </div>

      <button type="submit" disabled={busy} className={btnPrimary}>
        {busy ? "Activating…" : "Activate Account"}
      </button>
    </form>
  );
}

/* ================================================================
   STUDENT PANEL — sign-in + inline 2-step activate
   ================================================================ */

type StudentView = "login" | "activate-step1" | "activate-step2";

function StudentPanel({ school, slug, nav }: { school: SchoolPublicInfo; slug: string; nav: ReturnType<typeof useNavigate> }) {
  const [view, setView] = useState<StudentView>("login");
  // Carry validated username + studentId from step 1 → step 2
  const [activationCtx, setActivationCtx] = useState<{ username: string; studentId: string; fullName: string }>({ username: "", studentId: "", fullName: "" });

  if (view === "activate-step1") {
    return (
      <StudentActivateStep1
        school={school}
        slug={slug}
        onBack={() => setView("login")}
        onValidated={(ctx) => { setActivationCtx(ctx); setView("activate-step2"); }}
      />
    );
  }

  if (view === "activate-step2") {
    return (
      <StudentActivateStep2
        school={school}
        slug={slug}
        nav={nav}
        studentId={activationCtx.studentId}
        username={activationCtx.username}
        fullName={activationCtx.fullName}
        onBack={() => setView("activate-step1")}
      />
    );
  }

  return <StudentLoginForm school={school} slug={slug} nav={nav} onActivate={() => setView("activate-step1")} />;
}

/* ── Student sign-in ─────────────────────────────────────────── */

function StudentLoginForm({
  school, slug, nav, onActivate,
}: {
  school: SchoolPublicInfo; slug: string; nav: ReturnType<typeof useNavigate>; onActivate: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError("");
      if (!username.trim() || !password) {
        setError("Please enter your username and password.");
        return;
      }
      setBusy(true);
      try {
        const result = await portalLogin(slug, { username: username.trim(), password, accountType: "student" });
        try { localStorage.setItem("authToken", result.token); } catch {}
        setEduLane();
        if (result.mustChangePassword) {
          nav(`/streamline/edu/portal/${slug}/change-password?u=${encodeURIComponent(username.trim())}`, { replace: true });
        } else {
          nav("/streamline/edu/dashboard", { replace: true });
        }
      } catch (err: any) {
        setError(err?.message || "Invalid credentials");
      } finally {
        setBusy(false);
      }
    },
    [username, password, slug, nav],
  );

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white">Student Sign In</h2>
        <p className="mt-1 text-sm text-slate-400">Sign in with the credentials your teacher provided.</p>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div>
        <label className={labelCls} htmlFor="stu-user">Username</label>
        <input id="stu-user" value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} placeholder="your.username" autoComplete="username" />
      </div>
      <div>
        <label className={labelCls} htmlFor="stu-pass">Password</label>
        <input id="stu-pass" value={password} onChange={(e) => setPassword(e.target.value)} type="password" className={inputCls} placeholder="••••••••" autoComplete="current-password" />
      </div>

      <button type="submit" disabled={busy} className={btnPrimary}>
        {busy ? "Signing in…" : "Sign In"}
      </button>

      <button type="button" onClick={onActivate} className={btnSecondary}>
        Activate Account
      </button>
    </form>
  );
}

/* ── Student activation — Step 1: enter username, validate ───── */

function StudentActivateStep1({
  school, slug, onBack, onValidated,
}: {
  school: SchoolPublicInfo;
  slug: string;
  onBack: () => void;
  onValidated: (ctx: { username: string; studentId: string; fullName: string }) => void;
}) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError("");
      if (!username.trim()) { setError("Enter the username your teacher assigned you."); return; }

      setBusy(true);
      try {
        const result = await validateStudentForActivation(slug, username.trim());
        onValidated({ username: username.trim(), studentId: result.studentId, fullName: result.fullName });
      } catch (err: any) {
        setError(err?.message || "Username not found or not eligible for activation.");
      } finally {
        setBusy(false);
      }
    },
    [username, slug, onValidated],
  );

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <button type="button" onClick={onBack} className="mb-2 text-xs text-slate-400 hover:text-orange-300">
          ← Back to sign in
        </button>
        <h2 className="text-xl font-bold text-white">Activate Student Account</h2>
        <p className="mt-1 text-sm text-slate-400">
          Enter the username your teacher gave you to set up your account at {school.name}.
        </p>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div>
        <label className={labelCls} htmlFor="stu-act-user">Your Assigned Username</label>
        <input id="stu-act-user" value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} placeholder="your.username" autoComplete="username" />
      </div>

      <button type="submit" disabled={busy} className={btnPrimary}>
        {busy ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

/* ── Student activation — Step 2: create password ────────────── */

function StudentActivateStep2({
  school, slug, nav, studentId, username, fullName, onBack,
}: {
  school: SchoolPublicInfo;
  slug: string;
  nav: ReturnType<typeof useNavigate>;
  studentId: string;
  username: string;
  fullName: string;
  onBack: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError("");
      if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
      if (password !== confirmPassword) { setError("Passwords do not match."); return; }

      setBusy(true);
      try {
        const result = await activateStudentAccount(slug, {
          studentId,
          username,
          password,
          confirmPassword,
        });
        try { localStorage.setItem("authToken", result.token); } catch {}
        setEduLane();
        nav("/streamline/edu/dashboard", { replace: true });
      } catch (err: any) {
        setError(err?.message || "Activation failed");
      } finally {
        setBusy(false);
      }
    },
    [password, confirmPassword, studentId, username, slug, nav],
  );

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <button type="button" onClick={onBack} className="mb-2 text-xs text-slate-400 hover:text-orange-300">
          ← Back
        </button>
        <h2 className="text-xl font-bold text-white">Create Your Password</h2>
        <p className="mt-1 text-sm text-slate-400">
          Welcome, <span className="font-medium text-white">{fullName}</span>! Choose a password for your {school.name} account.
        </p>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-3">
        <div className="text-xs text-slate-400">Username</div>
        <div className="mt-0.5 font-medium text-white">{username}</div>
      </div>

      <div>
        <label className={labelCls} htmlFor="stu-act-pass">Password</label>
        <input id="stu-act-pass" value={password} onChange={(e) => setPassword(e.target.value)} type="password" className={inputCls} placeholder="At least 8 characters" autoComplete="new-password" />
      </div>
      <div>
        <label className={labelCls} htmlFor="stu-act-confirm">Confirm Password</label>
        <input id="stu-act-confirm" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} type="password" className={inputCls} autoComplete="new-password" />
      </div>

      <button type="submit" disabled={busy} className={btnPrimary}>
        {busy ? "Activating…" : "Activate Account"}
      </button>
    </form>
  );
}
