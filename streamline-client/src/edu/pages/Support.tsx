import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useEduMe } from "../layout/EduProtectedRoute";
import TicketsTab from "../components/support/TicketsTab";
import ReportsTab from "../components/support/ReportsTab";
import ResponsesTab from "../components/support/ResponsesTab";
import TicketDetail from "../components/support/TicketDetail";
import type { EduSupportTicket } from "../api/tickets";

const TABS = ["tickets", "reports", "responses"] as const;
type Tab = (typeof TABS)[number];

export default function Support() {
  const me = useEduMe();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab") || "tickets";
  const activeTab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "tickets";

  const [selectedTicket, setSelectedTicket] = useState<EduSupportTicket | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  function switchTab(tab: Tab) {
    setSelectedTicket(null);
    setSearchParams({ tab });
  }

  // If coming back from detail, clear selection when tab changes
  useEffect(() => {
    setSelectedTicket(null);
  }, [activeTab]);

  const tabClasses = (tab: Tab) =>
    `px-5 py-2.5 text-sm font-medium rounded-lg transition-colors ${
      activeTab === tab
        ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
        : "text-slate-400 hover:text-white hover:bg-slate-800/60"
    }`;

  // If a ticket is selected, show detail view
  if (selectedTicket) {
    return (
      <TicketDetail
        ticketId={selectedTicket.id}
        onBack={() => {
          setSelectedTicket(null);
          triggerRefresh();
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Support Center</h1>
        <p className="mt-1 text-sm text-slate-400">
          Create support tickets, submit reports, and track responses.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-700/50 pb-4">
        <button className={tabClasses("tickets")} onClick={() => switchTab("tickets")}>
          Tickets
        </button>
        <button className={tabClasses("reports")} onClick={() => switchTab("reports")}>
          Reports
        </button>
        <button className={tabClasses("responses")} onClick={() => switchTab("responses")}>
          Responses
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "tickets" && (
        <TicketsTab
          refreshKey={refreshKey}
          onSelectTicket={setSelectedTicket}
          onRefresh={triggerRefresh}
        />
      )}
      {activeTab === "reports" && <ReportsTab onRefresh={triggerRefresh} />}
      {activeTab === "responses" && (
        <ResponsesTab onSelectTicket={setSelectedTicket} refreshKey={refreshKey} />
      )}
    </div>
  );
}
