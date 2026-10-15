import { describe, expect, it } from "vitest";
import {
  DEFAULT_OFFLINE_MESSAGE,
  HLS_BRANDING_LIMITS,
  brandingEquals,
  brandingFromConfig,
  resolveViewerBranding,
  validateBranding,
  validateLogoUrl,
} from "./hlsBranding";

describe("hlsBranding", () => {
  it("normalizes stored config", () => {
    expect(brandingFromConfig(null)).toEqual({ title: "", subtitle: "", logoUrl: "", offlineMessage: "", theme: "dark" });
    expect(brandingFromConfig({ enabled: true, title: "Show", theme: "light" }).theme).toBe("light");
  });

  it("validates logo URLs", () => {
    expect(validateLogoUrl("")).toBeNull();
    expect(validateLogoUrl("https://cdn.example.com/logo.png")).toBeNull();
    expect(validateLogoUrl("logo.png")).not.toBeNull();
    expect(validateLogoUrl("javascript:alert(1)")).not.toBeNull();
    expect(validateLogoUrl("data:image/png;base64,AA")).not.toBeNull();
  });

  it("validates field lengths", () => {
    const b = brandingFromConfig({ title: "x".repeat(HLS_BRANDING_LIMITS.title + 1), logoUrl: "nope" });
    const errors = validateBranding(b);
    expect(Object.keys(errors).sort()).toEqual(["logoUrl", "title"]);
    expect(validateBranding(brandingFromConfig({ title: "ok" }))).toEqual({});
  });

  it("compares branding ignoring logo whitespace", () => {
    const a = brandingFromConfig({ logoUrl: "https://x.io/a.png" });
    expect(brandingEquals(a, { ...a, logoUrl: " https://x.io/a.png " })).toBe(true);
    expect(brandingEquals(a, { ...a, theme: "light" })).toBe(false);
  });

  it("resolves what the public viewer shows (channel > room > embed > defaults)", () => {
    const fallback = resolveViewerBranding({ embedName: "Weekly Show", embedDescription: "Fridays" });
    expect(fallback).toEqual({
      title: "Weekly Show",
      subtitle: "Fridays",
      logoUrl: "",
      offlineMessage: DEFAULT_OFFLINE_MESSAGE,
      isLightTheme: false,
    });

    const resolved = resolveViewerBranding({
      channelBranding: { title: "Channel", subtitle: "", logoUrl: "https://x.io/l.png", offlineMessage: "Back Monday", theme: "light" },
      roomConfig: { enabled: true, title: "Room title", subtitle: "Room sub", theme: "dark" },
      embedName: "Weekly Show",
    });
    expect(resolved).toEqual({
      title: "Channel",
      subtitle: "Room sub",
      logoUrl: "https://x.io/l.png",
      offlineMessage: "Back Monday",
      isLightTheme: true,
    });

    // An offline message is shown exactly as stored, even the old placeholder
    // text (the server strips the seeded one); unsafe logos are not shown.
    const typed = resolveViewerBranding({ roomConfig: { enabled: false, offlineMessage: "This stream is offline." } });
    expect(typed.offlineMessage).toBe("This stream is offline.");
    const legacy = resolveViewerBranding({ roomConfig: { enabled: false, offlineMessage: "", logoUrl: "javascript:x" } });
    expect(legacy.offlineMessage).toBe(DEFAULT_OFFLINE_MESSAGE);
    expect(legacy.logoUrl).toBe("");
    expect(legacy.title).toBe("StreamLine");
  });
});
