import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fbToken = vi.fn<() => Promise<string | null>>();
const fbTokenWhenReady = vi.fn<() => Promise<string | null>>();

vi.mock("../firebaseClient", () => ({
  getFirebaseIdToken: () => fbToken(),
  getFirebaseIdTokenWhenReady: () => fbTokenWhenReady(),
}));

const JWT = "aaa.bbb.ccc";

function res(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("auth session helpers", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let unauthorizedEvents: number;
  const onUnauth = () => {
    unauthorizedEvents++;
  };

  beforeEach(() => {
    localStorage.clear();
    fbToken.mockReset();
    fbTokenWhenReady.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    unauthorizedEvents = 0;
    (window as any).__sl_last_unauthorized_event_ts = undefined;
    window.addEventListener("sl:unauthorized", onUnauth);
  });

  afterEach(() => {
    window.removeEventListener("sl:unauthorized", onUnauth);
    vi.unstubAllGlobals();
  });

  it("hasAuthSession sees a Firebase session even without legacy authToken", async () => {
    const { hasAuthSession, optionalAuthHeaders } = await import("../api");
    fbTokenWhenReady.mockResolvedValue(JWT);
    expect(await hasAuthSession()).toBe(true);
    expect(await optionalAuthHeaders()).toEqual({ Authorization: `Bearer ${JWT}` });
  });

  it("hasAuthSession falls back to the legacy token and is false when anonymous", async () => {
    const { hasAuthSession, optionalAuthHeaders } = await import("../api");
    fbTokenWhenReady.mockResolvedValue(null);
    expect(await hasAuthSession()).toBe(false);
    expect(await optionalAuthHeaders()).toEqual({});
    localStorage.setItem("authToken", JWT);
    expect(await hasAuthSession()).toBe(true);
  });

  it("apiFetchAuth returns a 401 (no side effects) with allowNonOk + suppressAuthSideEffects", async () => {
    const { apiFetchAuth } = await import("../api");
    localStorage.setItem("authToken", JWT);
    fbToken.mockResolvedValue(null);
    fetchMock.mockResolvedValue(res(401, { error: "invite_invalid" }));
    const r = await apiFetchAuth("/api/rooms/r/token", { method: "POST" }, { allowNonOk: true, suppressAuthSideEffects: true });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "invite_invalid" });
    expect(localStorage.getItem("authToken")).toBe(JWT);
    expect(unauthorizedEvents).toBe(0);
  });

  it("apiFetchAuth still throws + emits on 401 by default", async () => {
    const { apiFetchAuth, ApiUnauthorizedError } = await import("../api");
    localStorage.setItem("authToken", JWT);
    fbToken.mockResolvedValue(null);
    fetchMock.mockResolvedValue(res(401));
    await expect(apiFetchAuth("/api/x", {}, { allowNonOk: true })).rejects.toBeInstanceOf(ApiUnauthorizedError);
    expect(localStorage.getItem("authToken")).toBeNull();
    expect(unauthorizedEvents).toBe(1);
  });

  it("apiFetchOptionalAuth sends Authorization only when signed in", async () => {
    const { apiFetchOptionalAuth } = await import("../api");
    fetchMock.mockResolvedValue(res(200, { ok: true }));

    fbTokenWhenReady.mockResolvedValue(null);
    await apiFetchOptionalAuth("/api/rooms/r/status", { headers: { "x-guest-session": "g" } });
    let headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("x-guest-session")).toBe("g");

    fbTokenWhenReady.mockResolvedValue(JWT);
    fbToken.mockResolvedValue(JWT);
    await apiFetchOptionalAuth("/api/rooms/r/status", { headers: { "x-room-access-token": "rat" } });
    headers = new Headers(fetchMock.mock.calls[1][1].headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${JWT}`);
    expect(headers.get("x-room-access-token")).toBe("rat");
  });

  it("apiFetchOptionalAuth returns 403 without throwing or emitting", async () => {
    const { apiFetchOptionalAuth } = await import("../api");
    fbTokenWhenReady.mockResolvedValue(JWT);
    fbToken.mockResolvedValue(JWT);
    fetchMock.mockResolvedValue(res(403, { error: "not_allowed" }));
    const r = await apiFetchOptionalAuth("/api/rooms/r/controls", { method: "PATCH" });
    expect(r.status).toBe(403);
    expect(unauthorizedEvents).toBe(0);
  });
});
