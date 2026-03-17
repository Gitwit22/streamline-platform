import { describe, expect, it } from "vitest";
import {
  detectInAppBrowser,
  getInAppBrowserName,
  getOpenInBrowserHint,
} from "../detectInAppBrowser";

// Note: detectInAppBrowser and getInAppBrowserName rely on navigator.userAgent.
// In a test (Node) environment, userAgent is empty, so detection returns false/null.

describe("detectInAppBrowser", () => {
  it("returns false for a standard browser (test env)", () => {
    expect(detectInAppBrowser()).toBe(false);
  });
});

describe("getInAppBrowserName", () => {
  it("returns null for a standard browser (test env)", () => {
    expect(getInAppBrowserName()).toBeNull();
  });
});

describe("getOpenInBrowserHint", () => {
  it("returns platform-specific hints for known apps", () => {
    expect(getOpenInBrowserHint("Facebook")).toContain("menu");
    expect(getOpenInBrowserHint("Instagram")).toContain("menu");
    expect(getOpenInBrowserHint("TikTok")).toContain("browser");
    expect(getOpenInBrowserHint("Snapchat")).toContain("browser");
    expect(getOpenInBrowserHint("WhatsApp")).toContain("browser");
    expect(getOpenInBrowserHint("WeChat")).toContain("browser");
    expect(getOpenInBrowserHint("Line")).toContain("browser");
    expect(getOpenInBrowserHint("Twitter")).toContain("browser");
    expect(getOpenInBrowserHint("Pinterest")).toContain("browser");
    expect(getOpenInBrowserHint("LinkedIn")).toContain("browser");
  });

  it("returns a generic hint for unknown app names", () => {
    expect(getOpenInBrowserHint(null)).toContain("default browser");
    expect(getOpenInBrowserHint("Unknown")).toContain("default browser");
  });
});
