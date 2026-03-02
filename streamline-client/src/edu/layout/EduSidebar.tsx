import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useEduMe } from "./EduProtectedRoute";
import { apiFetch, clearAuthStorage } from "../../lib/api";
import { logout } from "../../lib/logout";

type NavItem = { id: string; label: string; path: string };

export default function EduSidebar() {
  const nav = useNavigate();
  const loc = useLocation();
  const me = useEduMe();

  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const role = String(me?.orgRole || me?.role || "viewer");
  const schoolName = String(me?.orgName || "Your School");
  const isFacultyAdmin = role === "faculty_admin";
  const canPeople = isFacultyAdmin || role === "student_producer" || role === "student_producer_assigned";

  const items = useMemo<NavItem[]>(
    () => [
      { id: "dashboard", label: "Dashboard", path: "/streamline/edu/dashboard" },
      { id: "broadcast", label: "Broadcast", path: "/streamline/edu/broadcast" },
      { id: "events", label: "Events", path: "/streamline/edu/events" },
      { id: "archive", label: "Archive", path: "/streamline/edu/archive" },
      ...(canPeople ? [{ id: "people", label: "People", path: "/streamline/edu/people" }] : []),
      { id: "embed", label: "Website Embed", path: "/streamline/edu/embed" },
      ...(isFacultyAdmin ? [{ id: "settings", label: "Settings", path: "/streamline/edu/settings" }] : []),
    ],
    [isFacultyAdmin, canPeople]
  );

  useEffect(() => {
    if (!menuOpen) return;

    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!menuRef.current) return;
      if (menuRef.current.contains(t)) return;
      setMenuOpen(false);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }

    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);


  async function onLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    await logout();
    setMenuOpen(false);
    setLoggingOut(false);
    nav("/streamline/edu/login", { replace: true });
  }

  return (
    <nav className="fixed left-0 top-0 z-50 flex h-full w-64 flex-col border-r border-slate-700 bg-slate-900">
      <div className="border-b border-slate-700 bg-slate-900 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-700/60 bg-slate-950/40">
            <img src="/edu_logo.png" alt="EDU" className="h-10 w-10 object-contain" />
          </div>
          <div>
            <div className="font-bold tracking-tight text-white">StreamLine</div>
            <div className="font-mono text-xs tracking-[0.2em] text-orange-300">EDU</div>
          </div>
        </div>
      </div>

      <div className="border-b border-slate-700 bg-slate-900/50 px-6 py-4">
        <div className="mb-1 font-mono text-[11px] tracking-[0.2em] text-slate-500">SCHOOL</div>
        <div className="text-sm font-medium text-white">{schoolName}</div>
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        {items.map((item) => {
          const active = loc.pathname === item.path;
          return (
            <button
              key={item.id}
              onClick={() => nav(item.path)}
              className={`w-full px-6 py-3 text-left transition-colors ${
                active
                  ? "border-r-2 border-orange-500 bg-orange-500/10 text-orange-300"
                  : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
              }`}
            >
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="border-t border-slate-700 p-4">
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-800/60"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-800 text-sm font-semibold text-white">
              {String(me?.displayName || "EDU")
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .map((p: string) => p[0]?.toUpperCase())
                .join("") || "ED"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white">{String(me?.displayName || "User")}</div>
              <div className="font-mono text-[11px] tracking-[0.15em] text-slate-500">{role}</div>
            </div>
            <svg className="h-4 w-4 flex-shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute bottom-[calc(100%+8px)] left-0 w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                disabled={loggingOut}
                onClick={() => void onLogout()}
                className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-sm transition-colors ${
                  loggingOut
                    ? "cursor-not-allowed bg-slate-900 text-slate-500"
                    : "text-red-200 hover:bg-red-500/10"
                }`}
              >
                <span>{loggingOut ? "Logging out…" : "Log out"}</span>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 17l5-5-5-5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H3" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 4v16" />
                </svg>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
