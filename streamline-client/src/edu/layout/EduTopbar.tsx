import { useMemo } from "react";
import { useLocation } from "react-router-dom";

function titleForPath(pathname: string) {
  if (pathname.endsWith("/dashboard")) return { title: "Dashboard", subtitle: "Overview" };
  if (pathname.endsWith("/broadcast")) return { title: "Broadcast", subtitle: "Go live and manage your stream" };
  if (pathname.endsWith("/events")) return { title: "Events", subtitle: "Schedule and manage school broadcasts" };
  if (pathname.endsWith("/archive")) return { title: "Archive", subtitle: "Recordings and past broadcasts" };
  if (pathname.endsWith("/people")) return { title: "People", subtitle: "Roles and crew" };
  if (pathname.endsWith("/embed")) return { title: "Website Embed", subtitle: "Embed your HLS stream" };
  if (pathname.endsWith("/settings")) return { title: "Settings", subtitle: "School configuration" };
  return { title: "EDU", subtitle: null as string | null };
}

export default function EduTopbar() {
  const loc = useLocation();
  const { title, subtitle } = useMemo(() => titleForPath(loc.pathname), [loc.pathname]);

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-slate-700 bg-slate-900/60 px-6 backdrop-blur-xl">
      <div>
        <h1 className="text-xl font-bold text-white">{title}</h1>
        {subtitle ? <p className="text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      <div className="flex items-center gap-4">
        <button className="rounded-xl border border-slate-700 bg-slate-800/40 p-2 text-slate-300 transition-colors hover:bg-slate-800/70 hover:text-white">
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
