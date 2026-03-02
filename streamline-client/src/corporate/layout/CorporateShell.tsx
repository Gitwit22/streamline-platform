import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import CorporateSidebar from "./CorporateSidebar";
import CorporateTopbar from "./CorporateTopbar";
import { setCorporateLane } from "../state/corporateMode";
import "../index.css";

export default function CorporateShell() {
  useEffect(() => {
    setCorporateLane();
  }, []);

  return (
    <div className="corporate-root min-h-screen flex">
      <CorporateSidebar />
      <div className="flex-1 flex flex-col ml-64">
        <CorporateTopbar />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
