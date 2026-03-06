import { useState } from "react";
import { useEduMe } from "../layout/EduProtectedRoute";
import Students from "./Students";
import Directory from "./Directory";
import People from "./People";

/* ── Sub-tab definitions ─────────────────────────────────────── */

type TabId = "staff" | "students" | "manage";

const TABS: { id: TabId; label: string; adminOnly?: boolean }[] = [
  { id: "staff", label: "Staff" },
  { id: "students", label: "Students" },
  { id: "manage", label: "Roles & Permissions", adminOnly: true },
];

/* ── Component ─────────────────────────────────────────────────── */

export default function PeopleHub() {
  const me = useEduMe();
  const role = String(me?.orgRole || me?.role || "faculty_admin");
  const isFacultyAdmin = role === "faculty_admin";
  const canManage =
    isFacultyAdmin ||
    role === "student_producer" ||
    role === "student_producer_assigned";

  const [tab, setTab] = useState<TabId>("staff");

  const visibleTabs = TABS.filter((t) => {
    if (t.adminOnly && !canManage) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">People</h1>
        <p className="mt-1 text-sm text-slate-400">
          Browse staff, students, and manage roles in your school.
        </p>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-slate-700/60">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? "text-orange-300"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
            {tab === t.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-orange-500" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {tab === "staff" && <Directory />}
        {tab === "students" && <Students />}
        {tab === "manage" && <People />}
      </div>
    </div>
  );
}
