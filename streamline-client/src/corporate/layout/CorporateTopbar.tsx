import { useMemo } from "react";
import { useLocation } from "react-router-dom";

function titleForPath(pathname: string): { title: string; subtitle: string | null } {
  if (pathname.endsWith("/dashboard")) return { title: "Command Center", subtitle: "Overview" };
  if (pathname.endsWith("/calls")) return { title: "Calls", subtitle: "Active and scheduled calls" };
  if (pathname.endsWith("/broadcasts")) return { title: "Broadcasts", subtitle: "Live and upcoming broadcasts" };
  if (pathname.endsWith("/chat")) return { title: "Chat", subtitle: "Team messaging" };
  if (pathname.endsWith("/training")) return { title: "Training", subtitle: "Required and optional modules" };
  if (pathname.endsWith("/documents")) return { title: "Documents", subtitle: "Policies and resources" };
  if (pathname.endsWith("/analytics")) return { title: "Analytics", subtitle: "Usage and engagement metrics" };
  if (pathname.endsWith("/admin")) return { title: "Admin", subtitle: "Organization settings" };
  return { title: "Corporate", subtitle: null };
}

export default function CorporateTopbar() {
  const loc = useLocation();
  const { title, subtitle } = useMemo(() => titleForPath(loc.pathname), [loc.pathname]);

  return (
    <header
      className="sticky top-0 z-40 flex h-16 items-center justify-between px-6 backdrop-blur-xl"
      style={{
        borderBottom: "1px solid hsl(215 35% 20%)",
        background: "hsl(218 35% 11% / 0.6)",
      }}
    >
      <div>
        <h1 className="text-xl font-bold" style={{ color: "#fff" }}>{title}</h1>
        {subtitle && <p className="text-sm" style={{ color: "hsl(214 25% 55%)" }}>{subtitle}</p>}
      </div>
      <div className="flex items-center gap-4">
        <button
          className="rounded-xl p-2 transition-colors"
          style={{
            border: "1px solid hsl(215 35% 20%)",
            background: "hsl(215 28% 18% / 0.4)",
            color: "hsl(214 25% 68%)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "hsl(215 28% 18% / 0.7)";
            e.currentTarget.style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "hsl(215 28% 18% / 0.4)";
            e.currentTarget.style.color = "hsl(214 25% 68%)";
          }}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
