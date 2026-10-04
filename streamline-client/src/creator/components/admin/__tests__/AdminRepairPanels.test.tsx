import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const fetchMock = vi.fn();
vi.mock("../../../../lib/api", () => ({
  apiFetchAuth: (...args: unknown[]) => fetchMock(...args),
}));

const authState: { user: any; loading: boolean } = { user: null, loading: false };
vi.mock("../../../../hooks/useAuthMe", () => ({
  useAuthMe: () => ({ ...authState, refresh: vi.fn() }),
}));

import { SupportTicketsPanel } from "../SupportTicketsPanel";
import { OperationsPanel } from "../OperationsPanel";
import { AdminGuard } from "../AdminGuard";
import { UserDetailDrawer } from "../UserDetailDrawer";
import { buildUsagePath, filterUsageRows, planLabel } from "../../../pages/adminUsageQuery";

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

describe("adminUsageQuery", () => {
  it("builds a relative usage path without new URL (empty API base safe)", () => {
    expect(buildUsagePath({ plan: "all", limit: 100 })).toBe("/api/admin/usage?limit=100&counters=0");
    expect(buildUsagePath({ plan: "pro", emailPrefix: " Ann@ ", cursor: "u9", limit: 1000 })).toBe(
      "/api/admin/usage?limit=200&counters=0&plan=pro&search=ann%40&cursor=u9"
    );
  });

  it("filters rows without crashing on a missing email", () => {
    const rows = [
      { userId: "u1", email: null, displayName: "Ann" },
      { userId: "u2", email: "bob@x.io" },
      { userId: "u3" },
    ];
    expect(filterUsageRows(rows, "ann").map((r) => r.userId)).toEqual(["u1"]);
    expect(filterUsageRows(rows, "BOB").map((r) => r.userId)).toEqual(["u2"]);
    expect(filterUsageRows(rows, "u3").map((r) => r.userId)).toEqual(["u3"]);
    expect(filterUsageRows(rows, "").length).toBe(3);
  });

  it("labels plans from the fetched list", () => {
    expect(planLabel([{ id: "pro", name: "Pro Max" }], "pro")).toBe("Pro Max");
    expect(planLabel([], "creator_plus")).toBe("creator_plus");
    expect(planLabel([], undefined)).toBe("free");
  });
});

const TICKET = {
  id: "t1",
  status: "open",
  allowedNext: ["in_progress", "resolved", "closed"],
  subject: "Stream will not start",
  category: "streaming",
  priority: "high",
  submitter: { uid: "u1", email: "ann@x.io", auth: "user" },
  assignee: null,
  createdAtMs: Date.now() - 60_000,
  updatedAtMs: null,
  notesCount: 0,
};

describe("SupportTicketsPanel", () => {
  it("lists open tickets, opens one and changes its status", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return res(200, { ok: true, ticket: { ...TICKET, status: "in_progress", allowedNext: ["open", "resolved", "closed"], message: "help", meta: {}, history: [], internalNotes: [] } });
      }
      if (url.includes("/support/tickets/t1")) {
        return res(200, { ok: true, ticket: { ...TICKET, message: "It fails at 10%", meta: { pageUrl: "/room/x", userAgent: null, context: {} }, history: [], internalNotes: [] } });
      }
      return res(200, { ok: true, tickets: [TICKET], nextCursor: null });
    });
    const onMessage = vi.fn();
    render(<SupportTicketsPanel onMessage={onMessage} />);
    expect(await screen.findByText("Stream will not start")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toContain("/api/admin/support/tickets?limit=50&status=open");
    expect(screen.getByText(/No email provider is connected/)).toBeTruthy();

    fireEvent.click(screen.getByText("Stream will not start"));
    expect(await screen.findByText("It fails at 10%")).toBeTruthy();
    fireEvent.click(screen.getByText("Mark in progress"));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith("Ticket marked in progress"));
    const patch = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH");
    expect(patch?.[0]).toContain("/api/admin/support/tickets/t1");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ status: "in_progress" });
  });

  it("shows a load error", async () => {
    fetchMock.mockResolvedValue(res(500, { error: "internal_error" }));
    render(<SupportTicketsPanel />);
    expect(await screen.findByText(/Failed to load tickets: internal_error/)).toBeTruthy();
  });
});

describe("OperationsPanel", () => {
  it("renders service health and live rooms with access and viewers", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/monitoring/overview")) {
        return res(200, { webhooks: { total: 3, success: 2, failed: 1 }, activeRooms: 1, supportTickets: { open: 2, inProgress: 0 }, pendingSupportEvents: 0 });
      }
      if (url.includes("/monitoring/services")) {
        return res(200, { services: [{ name: "livekit", label: "LiveKit", status: "operational", latencyMs: 120, detail: "2 active LiveKit room(s)" }] });
      }
      if (url.includes("/rooms/active")) {
        return res(200, {
          rooms: [
            {
              roomId: "r1",
              name: "Friday Show",
              ownerId: "u1",
              ownerEmail: "ann@x.io",
              access: "invite_only",
              startedAt: Date.now() - 5 * 60_000,
              participants: 3,
              onStage: 2,
              currentViewers: 14,
              hlsViewers: 10,
              viewerStats: { peak: 20, totalUnique: 31 },
              activeOutputs: 2,
            },
          ],
        });
      }
      if (url.includes("/stream-summary")) {
        return res(200, { sessionId: "s1", live: true, durationSec: 300, peakConcurrent: 20, uniqueViewers: { total: 31, hls: 20, rtc: 11 }, avgWatchSeconds: null, outputs: [] });
      }
      return res(200, { alerts: [], deliveries: [] });
    });
    const onOpenUser = vi.fn();
    render(<OperationsPanel onOpenUser={onOpenUser} />);
    expect(await screen.findByText("LiveKit")).toBeTruthy();
    expect(screen.getByText("2 active LiveKit room(s)")).toBeTruthy();
    expect(await screen.findByText("Friday Show")).toBeTruthy();
    expect(screen.getByText("Invite Only")).toBeTruthy();
    expect(screen.getByText("14 / 20 / 31")).toBeTruthy();
    fireEvent.click(screen.getByText("ann@x.io"));
    expect(onOpenUser).toHaveBeenCalledWith("u1");
    fireEvent.click(screen.getByText("Stream summary"));
    expect(await screen.findByText(/Peak: 20/)).toBeTruthy();
  });
});

describe("AdminGuard", () => {
  it("blocks non-admins and renders children for admins", () => {
    authState.user = { uid: "u1", isAdmin: false };
    const { rerender } = render(
      <MemoryRouter>
        <AdminGuard>
          <div>secret admin</div>
        </AdminGuard>
      </MemoryRouter>
    );
    expect(screen.getByText("Access denied")).toBeTruthy();
    expect(screen.queryByText("secret admin")).toBeNull();

    authState.user = { uid: "u1", isAdmin: true };
    rerender(
      <MemoryRouter>
        <AdminGuard>
          <div>secret admin</div>
        </AdminGuard>
      </MemoryRouter>
    );
    expect(screen.getByText("secret admin")).toBeTruthy();
    authState.user = null;
  });
});

const DETAIL = {
  profile: {
    uid: "u1",
    email: "ann@x.io",
    displayName: "Ann",
    createdAt: 1_700_000_000_000,
    lastActiveAt: Date.now() - 120_000,
    accountStatus: "active",
    deleted: false,
    deletedAtMs: null,
    deleteAfterMs: null,
    isAdmin: false,
    authRevokedAtMs: null,
    canEnablePasswordReset: true,
  },
  plan: { basePlanId: "free", stripePlanId: "free", effectivePlanId: "pro", decidedBy: "override", subscriptionBlockedReason: null, planOverride: { planId: "pro", active: true } },
  usage: {
    monthKey: "2026-10",
    streamingMinutes: 42,
    destinationMinutes: 80,
    recordingMinutes: 10,
    limitMinutes: 2400,
    planAllowanceMinutes: 2400,
    creditRemainingMinutes: 0,
    isBlocked: false,
    storageUsedBytes: 1024 * 1024 * 5,
    storageLimitBytes: null,
  },
  rooms: { count: 1, recent: [{ roomId: "r1", name: "Friday Show", status: "idle", access: "public", createdAt: 1 }] },
  recordings: { count: 0, recent: [] },
  billing: { status: "free", stripeCustomerId: null, subscriptionId: null, billingEnabled: true, platformBillingEnabled: true },
  auditLog: [{ id: "l1", action: "set_plan_override", adminId: "admin1", timestampMs: 1_700_000_100_000, details: {} }],
};

describe("UserDetailDrawer", () => {
  it("shows the detail and revokes sessions", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/revoke-sessions")) return res(200, { success: true, authRevokedAtMs: Date.now() });
      if (url.includes("/detail")) return res(200, DETAIL);
      if (url.includes("/credits")) return res(200, { success: true, credits: [], creditRemainingMinutes: 0 });
      return res(200, {});
    });
    vi.spyOn(window, "prompt").mockReturnValue("lost laptop");
    const onMessage = vi.fn();
    render(<UserDetailDrawer userId="u1" planOptions={[{ id: "pro", name: "Pro" }]} onClose={() => undefined} onMessage={onMessage} />);
    expect(await screen.findByText("Admin audit log")).toBeTruthy();
    expect(screen.getByText("42 / 2400 min")).toBeTruthy();
    expect(screen.getByText("5 MB / Unlimited")).toBeTruthy();
    expect(screen.getByText("Friday Show")).toBeTruthy();
    fireEvent.click(screen.getByText("Revoke sessions"));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith("Sessions revoked"));
    const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/revoke-sessions"));
    expect(post?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ reason: "lost laptop" });
  });
});
