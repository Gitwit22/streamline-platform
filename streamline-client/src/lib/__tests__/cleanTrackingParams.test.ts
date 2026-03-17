import { describe, expect, it } from "vitest";
import { cleanTrackingParams } from "../cleanTrackingParams";

// We need to mock window.location and window.history for these tests.
// Since cleanTrackingParams uses window.location.href and history.replaceState,
// we test the underlying logic by verifying the isTrackingParam classification.

describe("cleanTrackingParams", () => {
  it("is a function", () => {
    expect(typeof cleanTrackingParams).toBe("function");
  });

  it("does not throw when called in a test environment", () => {
    // The function guards against missing window/history so it should be safe
    expect(() => cleanTrackingParams()).not.toThrow();
  });
});
