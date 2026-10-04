import { describe, expect, it } from "vitest";
import {
  CHECKOUT_RETURN_MAX_ATTEMPTS,
  interpretPlaybackResponse,
  nextPlayerUrl,
  playbackRenewDelayMs,
  playbackTokenOf,
  resolvePlaybackUrl,
  samePlaybackTarget,
  shouldKeepPollingAfterCheckout,
  swapPlaybackToken,
} from "../playbackAccess";

const API = "https://api.example.com";

describe("interpretPlaybackResponse (server answer → gate)", () => {
  it("200 with a signed API path → granted with absolute URL", () => {
    const g = interpretPlaybackResponse(
      200,
      { ok: true, mode: "pay_per_view", playbackUrl: "/api/hls/play/r1/live.m3u8?token=abc", expiresAt: 123, protected: true },
      API
    );
    expect(g).toEqual({
      kind: "granted",
      url: "https://api.example.com/api/hls/play/r1/live.m3u8?token=abc",
      expiresAt: 123,
      protected: true,
      mode: "pay_per_view",
    });
  });

  it("200 public → direct URL kept, no expiry", () => {
    const g = interpretPlaybackResponse(200, { mode: "public", playbackUrl: "https://cdn/hls/r1/live.m3u8", expiresAt: null }, API);
    expect(g).toMatchObject({ kind: "granted", url: "https://cdn/hls/r1/live.m3u8", expiresAt: null, mode: "public" });
  });

  it("200 without a URL → authorized, waiting for the stream", () => {
    expect(interpretPlaybackResponse(200, { mode: "registered", playbackUrl: null }, API)).toEqual({ kind: "waiting_live", mode: "registered" });
  });

  it("401 → login, 402 → checkout with event, 403 → forbidden reasons, 404 → not_found, 5xx → unavailable", () => {
    expect(interpretPlaybackResponse(401, { error: "login_required" }, API).kind).toBe("login");
    const c = interpretPlaybackResponse(
      402,
      { error: "checkout_required", checkout: { eventId: "ev1", eventName: "Finals", monetizationMode: "fixed", currency: "usd", fixedAmountCents: 500, pwywMinCents: null } },
      API
    );
    expect(c).toMatchObject({ kind: "checkout", checkout: { eventId: "ev1", fixedAmountCents: 500 } });
    expect(interpretPlaybackResponse(403, { error: "private" }, API)).toMatchObject({ kind: "forbidden", reason: "private", message: "This stream is private." });
    expect(interpretPlaybackResponse(403, { error: "subscriber_not_available" }, API)).toMatchObject({ reason: "subscriber_not_available" });
    expect(interpretPlaybackResponse(403, { error: "ppv_unavailable", message: "Not on sale" }, API)).toMatchObject({ reason: "ppv_unavailable", message: "Not on sale" });
    expect(interpretPlaybackResponse(403, null, API)).toMatchObject({ reason: "unknown" });
    expect(interpretPlaybackResponse(404, {}, API).kind).toBe("not_found");
    expect(interpretPlaybackResponse(503, { error: "playback_unconfigured" }, API).kind).toBe("unavailable");
  });
});

describe("token helpers", () => {
  const url = "https://api.example.com/api/hls/play/r1/live.m3u8?token=old%2Bx";

  it("extracts and swaps tokens only on API playlist URLs", () => {
    expect(playbackTokenOf(url)).toBe("old+x");
    expect(swapPlaybackToken(url, "new/y")).toBe("https://api.example.com/api/hls/play/r1/live.m3u8?token=new%2Fy");
    expect(swapPlaybackToken("https://r2.example/seg.ts?X-Amz=1", "t")).toBe("https://r2.example/seg.ts?X-Amz=1");
    expect(swapPlaybackToken("/api/hls/play/r1/v1/index.m3u8", "t")).toBe("/api/hls/play/r1/v1/index.m3u8?token=t");
    expect(swapPlaybackToken(url, null)).toBe(url);
  });

  it("same target ignores the token; renewals keep hls.js attached, native takes the new URL", () => {
    const renewed = swapPlaybackToken(url, "fresh");
    expect(samePlaybackTarget(url, renewed)).toBe(true);
    expect(samePlaybackTarget(url, url.replace("r1", "r2"))).toBe(false);
    expect(nextPlayerUrl(url, renewed, false)).toBe(url);
    expect(nextPlayerUrl(url, renewed, true)).toBe(renewed);
    expect(nextPlayerUrl(null, renewed, false)).toBe(renewed);
    expect(nextPlayerUrl(url, url.replace("r1", "r2"), false)).toBe(url.replace("r1", "r2"));
  });

  it("renews at ~2/3 of remaining lifetime (min 5s); never for public URLs", () => {
    expect(playbackRenewDelayMs(null, 0)).toBeNull();
    expect(playbackRenewDelayMs(30 * 60_000, 0)).toBe(20 * 60_000);
    expect(playbackRenewDelayMs(1000, 0)).toBe(5000);
    expect(playbackRenewDelayMs(-50, 0)).toBe(5000);
  });

  it("resolvePlaybackUrl", () => {
    expect(resolvePlaybackUrl("/api/x", "https://a.b/")).toBe("https://a.b/api/x");
    expect(resolvePlaybackUrl("https://c/x", "https://a.b")).toBe("https://c/x");
    expect(resolvePlaybackUrl("/api/x", "")).toBe("/api/x");
  });
});

describe("checkout return polling", () => {
  it("keeps polling while the webhook hasn't granted access, up to a cap", () => {
    const checkout = { kind: "checkout", checkout: null, message: "", mode: "pay_per_view" } as const;
    expect(shouldKeepPollingAfterCheckout(checkout, 1)).toBe(true);
    expect(shouldKeepPollingAfterCheckout({ kind: "unavailable", message: "" }, 3)).toBe(true);
    expect(shouldKeepPollingAfterCheckout(checkout, CHECKOUT_RETURN_MAX_ATTEMPTS)).toBe(false);
    expect(shouldKeepPollingAfterCheckout({ kind: "granted", url: "u", expiresAt: 1, protected: true, mode: "pay_per_view" }, 1)).toBe(false);
    expect(shouldKeepPollingAfterCheckout({ kind: "waiting_live", mode: "pay_per_view" }, 1)).toBe(false);
  });
});
