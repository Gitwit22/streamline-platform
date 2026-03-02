import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCorporateMe } from "./CorporateProtectedRoute";

type NavItem = { id: string; label: string; path: string };

export default function CorporateSidebar() {
  const nav = useNavigate();
  const loc = useLocation();
  const me = useCorporateMe();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const role = String(me?.orgRole || me?.role || "viewer");
  const orgName = String(me?.orgName || "Your Organization");
  const isAdmin = role === "admin";

  const items = useMemo<NavItem[]>(
    () => [
      { id: "dashboard", label: "Dashboard", path: "/streamline/corporate/dashboard" },
      { id: "calls", label: "Calls", path: "/streamline/corporate/calls" },
      { id: "broadcasts", label: "Broadcasts", path: "/streamline/corporate/broadcasts" },
      { id: "chat", label: "Chat", path: "/streamline/corporate/chat" },
      { id: "training", label: "Training", path: "/streamline/corporate/training" },
      { id: "documents", label: "Documents", path: "/streamline/corporate/documents" },
      { id: "analytics", label: "Analytics", path: "/streamline/corporate/analytics" },
      ...(isAdmin ? [{ id: "admin", label: "Admin", path: "/streamline/corporate/admin" }] : []),
    ],
    [isAdmin],
  );

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
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

  function onLogout() {
    // TODO: wire real logout
    nav("/streamline/corporate/login", { replace: true });
  }

  return (
    <nav
      className="fixed left-0 top-0 z-50 flex h-full w-64 flex-col"
      style={{
        borderRight: "1px solid hsl(215 35% 20%)",
        background: "hsl(218 35% 11%)",
      }}
    >
      {/* Brand */}
      <div
        className="p-6"
        style={{ borderBottom: "1px solid hsl(215 35% 20%)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl"
            style={{
              border: "1px solid hsl(215 35% 20% / 0.6)",
              background: "hsl(218 50% 6% / 0.4)",
            }}
          >
            <img src="/corp_logo_sm.png" alt="Corp" className="h-10 w-10 object-contain" />
          </div>
          <div>
            <div className="font-bold tracking-tight" style={{ color: "#fff" }}>StreamLine</div>
            <div
              className="font-mono text-xs tracking-[0.2em]"
              style={{ color: "hsl(197 89% 66%)" }}
            >
              CORPORATE
            </div>
          </div>
        </div>
      </div>

      {/* Org name */}
      <div
        className="px-6 py-4"
        style={{
          borderBottom: "1px solid hsl(215 35% 20%)",
          background: "hsl(218 35% 11% / 0.5)",
        }}
      >
        <div
          className="mb-1 font-mono text-[11px] tracking-[0.2em]"
          style={{ color: "hsl(214 25% 40%)" }}
        >
          ORGANIZATION
        </div>
        <div className="text-sm font-medium" style={{ color: "#fff" }}>{orgName}</div>
      </div>

      {/* Nav items */}
      <div className="flex-1 overflow-y-auto py-4">
        {items.map((item) => {
          const active = loc.pathname === item.path;
          return (
            <button
              key={item.id}
              onClick={() => nav(item.path)}
              className="w-full px-6 py-3 text-left transition-colors"
              style={{
                borderRight: active ? "2px solid hsl(197 89% 66%)" : "2px solid transparent",
                background: active ? "hsl(197 89% 66% / 0.1)" : "transparent",
                color: active ? "hsl(197 89% 66%)" : "hsl(214 25% 68%)",
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.background = "hsl(215 28% 18% / 0.6)";
                  e.currentTarget.style.color = "#fff";
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "hsl(214 25% 68%)";
                }
              }}
            >
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* User footer */}
      <div className="p-4" style={{ borderTop: "1px solid hsl(215 35% 20%)" }}>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors"
            style={{ color: "#fff" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "hsl(215 28% 18% / 0.6)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
              style={{
                background: "linear-gradient(135deg, hsl(215 35% 20%), hsl(215 28% 25%))",
                color: "#fff",
              }}
            >
              {String(me?.displayName || "U")
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .map((p) => p[0]?.toUpperCase())
                .join("") || "U"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{String(me?.displayName || "User")}</div>
              <div
                className="font-mono text-[11px] tracking-[0.15em]"
                style={{ color: "hsl(214 25% 45%)" }}
              >
                {role}
              </div>
            </div>
            <svg className="h-4 w-4 flex-shrink-0" style={{ color: "hsl(214 25% 50%)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute bottom-[calc(100%+8px)] left-0 w-full overflow-hidden rounded-xl shadow-lg"
              style={{
                border: "1px solid hsl(215 35% 20%)",
                background: "hsl(218 35% 11%)",
              }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => { setMenuOpen(false); onLogout(); }}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-sm transition-colors"
                style={{ color: "hsl(355 82% 65%)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "hsl(355 82% 65% / 0.1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span>Log out</span>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 17l5-5-5-5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H3" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 4v16" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
