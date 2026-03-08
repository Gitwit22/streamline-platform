import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import EduSidebar from "./EduSidebar";
import EduTopbar from "./EduTopbar";
import { setEduLane } from "../state/eduMode";
import { SchoolBrandingProvider } from "../state/schoolBranding";
import IncomingCallBanner from "../components/IncomingCallBanner";

/** Routes that need a full-bleed layout (no padding, overflow hidden). */
const FULL_BLEED_PATTERN = /\/rooms\/[^/]+$/;

export default function EduShell() {
  const { pathname } = useLocation();
  const isFullBleed = FULL_BLEED_PATTERN.test(pathname);

  useEffect(() => {
    setEduLane();
  }, []);

  return (
    <SchoolBrandingProvider>
      {/* Site-wide incoming call notification — visible on every tab/page */}
      <IncomingCallBanner />
      <div className="h-screen bg-slate-900 text-white flex overflow-hidden">
        <EduSidebar />
        <div className="flex-1 flex flex-col ml-64 min-h-0">
          <EduTopbar />
          <main className={`flex-1 min-h-0 ${isFullBleed ? "" : "p-6 overflow-y-auto"}`}>
            <Outlet />
          </main>
        </div>
      </div>
    </SchoolBrandingProvider>
  );
}
