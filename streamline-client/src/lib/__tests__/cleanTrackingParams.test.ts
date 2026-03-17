import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanTrackingParams } from "../cleanTrackingParams";

describe("cleanTrackingParams", () => {
  it("is a function", () => {
    expect(typeof cleanTrackingParams).toBe("function");
  });

  it("does not throw when called in a test environment", () => {
    expect(() => cleanTrackingParams()).not.toThrow();
  });

  describe("with mocked window.location and history", () => {
    let replaceStateSpy: ReturnType<typeof vi.fn>;
    let originalHref: string;

    beforeEach(() => {
      originalHref = window.location.href;
      replaceStateSpy = vi.fn();
      vi.spyOn(window.history, "replaceState").mockImplementation(replaceStateSpy);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function setLocationHref(href: string) {
      Object.defineProperty(window, "location", {
        value: new URL(href),
        writable: true,
        configurable: true,
      });
    }

    it("strips fbclid from the URL", () => {
      setLocationHref("https://app.example.com/invite/abc123?fbclid=abc123xyz");
      cleanTrackingParams();
      expect(replaceStateSpy).toHaveBeenCalledTimes(1);
      const cleanedUrl = replaceStateSpy.mock.calls[0][2];
      expect(cleanedUrl).toBe("/invite/abc123");
      expect(cleanedUrl).not.toContain("fbclid");
    });

    it("strips utm_* parameters", () => {
      setLocationHref("https://app.example.com/i/token123?utm_source=facebook&utm_medium=social&utm_campaign=spring");
      cleanTrackingParams();
      expect(replaceStateSpy).toHaveBeenCalledTimes(1);
      const cleanedUrl = replaceStateSpy.mock.calls[0][2];
      expect(cleanedUrl).toBe("/i/token123");
      expect(cleanedUrl).not.toContain("utm_");
    });

    it("strips gclid and msclkid", () => {
      setLocationHref("https://app.example.com/join?t=abc&gclid=123&msclkid=456");
      cleanTrackingParams();
      expect(replaceStateSpy).toHaveBeenCalledTimes(1);
      const cleanedUrl = replaceStateSpy.mock.calls[0][2];
      expect(cleanedUrl).toBe("/join?t=abc");
      expect(cleanedUrl).not.toContain("gclid");
      expect(cleanedUrl).not.toContain("msclkid");
    });

    it("preserves legitimate query parameters", () => {
      setLocationHref("https://app.example.com/room/myroom?gst=token123&fbclid=abc");
      cleanTrackingParams();
      expect(replaceStateSpy).toHaveBeenCalledTimes(1);
      const cleanedUrl = replaceStateSpy.mock.calls[0][2];
      expect(cleanedUrl).toBe("/room/myroom?gst=token123");
    });

    it("does not call replaceState when no tracking params exist", () => {
      setLocationHref("https://app.example.com/invite/abc123?gst=token");
      cleanTrackingParams();
      expect(replaceStateSpy).not.toHaveBeenCalled();
    });

    it("strips igshid from Instagram shares", () => {
      setLocationHref("https://app.example.com/invite/xyz?igshid=abc123");
      cleanTrackingParams();
      expect(replaceStateSpy).toHaveBeenCalledTimes(1);
      const cleanedUrl = replaceStateSpy.mock.calls[0][2];
      expect(cleanedUrl).toBe("/invite/xyz");
    });
  });
});
