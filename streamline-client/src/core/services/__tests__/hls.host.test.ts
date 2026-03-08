import { describe, expect, it, vi } from "vitest";

import { API_BASE } from "../../lib/apiBase";

// Host-only HLS tests MUST explicitly mock apiFetchAuth.
const apiFetchAuthMock = vi.fn();

vi.mock("../../lib/api", () => {
  return {
    apiFetchAuth: (...args: any[]) => apiFetchAuthMock(...args),
  };
});

function makeRes(opts: {
  ok: boolean;
  status: number;
  json?: any;
  text?: string;
}): { ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> } {
  return {
    ok: opts.ok,
    status: opts.status,
    json: async () => opts.json ?? {},
    text: async () => opts.text ?? "",
  };
}

describe("services/hls (host-only)", () => {
  it("startHls uses apiFetchAuth POST + presetId body", async () => {
    apiFetchAuthMock.mockReset();
    apiFetchAuthMock.mockResolvedValueOnce(
      makeRes({ ok: true, status: 200, json: { roomId: "r1", status: "starting" } })
    );

    const { startHls } = await import("../hls");

    const res = await startHls("room_123");
    expect(res.roomId).toBe("r1");
    expect(apiFetchAuthMock).toHaveBeenCalledTimes(1);

    const [url, init, options] = apiFetchAuthMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE}/api/hls/start/${encodeURIComponent("room_123")}`);
    expect(init?.method).toBe("POST");
    expect(String(init?.body || "")).toContain("presetId");
    expect(options?.allowNonOk).toBe(true);
  });

  it("startHls passes x-room-access-token when provided", async () => {
    apiFetchAuthMock.mockReset();
    apiFetchAuthMock.mockResolvedValueOnce(
      makeRes({ ok: true, status: 200, json: { roomId: "r2", status: "starting" } })
    );

    const { startHls } = await import("../hls");

    await startHls("room_abc", "token_xyz");

    const [, init] = apiFetchAuthMock.mock.calls[0];
    expect(init?.headers).toMatchObject({ "x-room-access-token": "token_xyz" });
  });

  it("stopHls uses apiFetchAuth POST and supports x-room-access-token", async () => {
    apiFetchAuthMock.mockReset();
    apiFetchAuthMock.mockResolvedValueOnce(
      makeRes({ ok: true, status: 200, json: { roomId: "r3", hls: { status: "idle" } } })
    );

    const { stopHls } = await import("../hls");

    await stopHls("room_stop", "tok_stop");

    const [url, init, options] = apiFetchAuthMock.mock.calls[0];
    expect(String(url)).toBe(`${API_BASE}/api/hls/stop/${encodeURIComponent("room_stop")}`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "x-room-access-token": "tok_stop" });
    expect(options?.allowNonOk).toBe(true);
  });

  it("getHlsStatus throws on non-ok and includes status/text", async () => {
    apiFetchAuthMock.mockReset();
    apiFetchAuthMock.mockResolvedValueOnce(makeRes({ ok: false, status: 500, text: "boom" }));

    const { getHlsStatus } = await import("../hls");

    await expect(getHlsStatus("room_bad")).rejects.toThrow("status_failed_500:boom");
  });
});
