import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import EduSidebar from "./EduSidebar";
import EduTopbar from "./EduTopbar";
import { setEduLane } from "../state/eduMode";

export default function EduShell() {
  useEffect(() => {
    setEduLane();
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-white flex">
      <EduSidebar />
      <div className="flex-1 flex flex-col ml-64">
        <EduTopbar />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
