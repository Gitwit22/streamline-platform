import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useSchoolBranding } from "../state/schoolBranding";
import SchoolLogo from "../components/SchoolLogo";
import NotificationBell from "../components/NotificationBell";

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
  const { branding } = useSchoolBranding();

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-slate-700 bg-slate-900/60 px-6 backdrop-blur-xl">
      <div>
        <h1 className="text-xl font-bold text-white">{title}</h1>
        {subtitle ? <p className="text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      <div className="flex items-center gap-4">
        {branding.schoolName ? (
          <div className="flex items-center gap-2">
            <SchoolLogo size="xs" />
            <span className="hidden text-sm font-medium text-slate-300 md:inline">{branding.schoolName}</span>
          </div>
        ) : null}
        <NotificationBell />
      </div>
    </header>
  );
}
