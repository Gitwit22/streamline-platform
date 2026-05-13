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
      </div>
    </header>
  );
}
