import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Helper to re-evaluate the module with a fresh env stub.
// We do this by resetting the module registry so that resolveProgram()
// reads import.meta.env fresh on each call (no module-level caching).
async function importWithEnv(programValue: string | undefined) {
  vi.resetModules();
  if (programValue === undefined) {
    vi.stubEnv("VITE_STREAMLINE_PROGRAM", "");
  } else {
    vi.stubEnv("VITE_STREAMLINE_PROGRAM", programValue);
  }
  return import("../index");
}

describe("Program config — resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to EDU when VITE_STREAMLINE_PROGRAM is not set", async () => {
    const mod = await importWithEnv(undefined);
    expect(mod.getCurrentProgramKey()).toBe("edu");
  });

  it("defaults to EDU when VITE_STREAMLINE_PROGRAM is empty string", async () => {
    const mod = await importWithEnv("");
    expect(mod.getCurrentProgramKey()).toBe("edu");
  });

  it("resolves EDU config when VITE_STREAMLINE_PROGRAM=edu", async () => {
    const mod = await importWithEnv("edu");
    const config = mod.getProgramConfig();
    expect(config.programKey).toBe("edu");
    expect(config.appName).toBe("StreamLine EDU");
    expect(config.programDomain).toBe("streamline-edu");
  });

  it("resolves Corporate config when VITE_STREAMLINE_PROGRAM=corporate", async () => {
    const mod = await importWithEnv("corporate");
    const config = mod.getProgramConfig();
    expect(config.programKey).toBe("corporate");
    expect(config.appName).toBe("StreamLine Corporate");
    expect(config.programDomain).toBe("streamline-corporate");
  });

  it("falls back to EDU and logs a warning for an invalid value", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await importWithEnv("invalid-lane");
    expect(mod.getCurrentProgramKey()).toBe("edu");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid VITE_STREAMLINE_PROGRAM value")
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"invalid-lane"'));
    warnSpy.mockRestore();
  });

  it("is case-insensitive for the env value", async () => {
    const mod = await importWithEnv("CORPORATE");
    expect(mod.getCurrentProgramKey()).toBe("corporate");
  });

  it("trims whitespace from the env value", async () => {
    const mod = await importWithEnv("  edu  ");
    expect(mod.getCurrentProgramKey()).toBe("edu");
  });
});

describe("Program config — feature flags", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("EDU enables canUseClassrooms and canUseRecordingLibrary", async () => {
    const mod = await importWithEnv("edu");
    expect(mod.isFeatureEnabled("canUseClassrooms")).toBe(true);
    expect(mod.isFeatureEnabled("canUseRecordingLibrary")).toBe(true);
  });

  it("EDU disables canUseDepartments and canUseCorporateRooms", async () => {
    const mod = await importWithEnv("edu");
    expect(mod.isFeatureEnabled("canUseDepartments")).toBe(false);
    expect(mod.isFeatureEnabled("canUseCorporateRooms")).toBe(false);
  });

  it("Corporate enables canUseDepartments and canUseCorporateRooms", async () => {
    const mod = await importWithEnv("corporate");
    expect(mod.isFeatureEnabled("canUseDepartments")).toBe(true);
    expect(mod.isFeatureEnabled("canUseCorporateRooms")).toBe(true);
  });

  it("Corporate disables canUseClassrooms and canUseRecordingLibrary", async () => {
    const mod = await importWithEnv("corporate");
    expect(mod.isFeatureEnabled("canUseClassrooms")).toBe(false);
    expect(mod.isFeatureEnabled("canUseRecordingLibrary")).toBe(false);
  });

  it("both programs enable canUseWebinars and canUseAdminUsage", async () => {
    const eduMod = await importWithEnv("edu");
    expect(eduMod.isFeatureEnabled("canUseWebinars")).toBe(true);
    expect(eduMod.isFeatureEnabled("canUseAdminUsage")).toBe(true);

    const corpMod = await importWithEnv("corporate");
    expect(corpMod.isFeatureEnabled("canUseWebinars")).toBe(true);
    expect(corpMod.isFeatureEnabled("canUseAdminUsage")).toBe(true);
  });
});

describe("Program config — isProgramExplicitlyConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns false when env is not set", async () => {
    const mod = await importWithEnv(undefined);
    expect(mod.isProgramExplicitlyConfigured()).toBe(false);
  });

  it("returns false when env is empty string", async () => {
    const mod = await importWithEnv("");
    expect(mod.isProgramExplicitlyConfigured()).toBe(false);
  });

  it("returns true when env is 'edu'", async () => {
    const mod = await importWithEnv("edu");
    expect(mod.isProgramExplicitlyConfigured()).toBe(true);
  });

  it("returns true when env is 'corporate'", async () => {
    const mod = await importWithEnv("corporate");
    expect(mod.isProgramExplicitlyConfigured()).toBe(true);
  });

  it("returns false when env is an invalid value", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await importWithEnv("invalid");
    expect(mod.isProgramExplicitlyConfigured()).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("Program config — route and domain properties", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("EDU config has correct routes and domain values", async () => {
    const mod = await importWithEnv("edu");
    const config = mod.getProgramConfig();
    expect(config.defaultRouteAfterLogin).toBe("/streamline/edu/dashboard");
    expect(config.publicLandingRoute).toBe("/streamline/edu");
    expect(config.backendProgramHeader).toBe("streamline-edu");
    expect(config.enabledRoutes).toContain("broadcast");
    expect(config.enabledRoutes).toContain("media-library");
  });

  it("Corporate config has correct routes and domain values", async () => {
    const mod = await importWithEnv("corporate");
    const config = mod.getProgramConfig();
    expect(config.defaultRouteAfterLogin).toBe("/streamline/corporate/dashboard");
    expect(config.publicLandingRoute).toBe("/streamline/corporate");
    expect(config.backendProgramHeader).toBe("streamline-corporate");
    expect(config.enabledRoutes).toContain("training");
    expect(config.enabledRoutes).toContain("org-chart");
  });
});
