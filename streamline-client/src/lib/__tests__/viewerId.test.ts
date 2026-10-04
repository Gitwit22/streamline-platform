import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VIEWER_ID_STORAGE_KEY,
  __resetViewerIdForTests,
  generateViewerId,
  getViewerId,
  isValidViewerId,
} from "../viewerId";

describe("viewerId", () => {
  beforeEach(() => {
    __resetViewerIdForTests();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates ids the server accepts", () => {
    const id = generateViewerId();
    expect(isValidViewerId(id)).toBe(true);
    expect(id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(generateViewerId()).not.toBe(id);
  });

  it("persists in localStorage and is stable", () => {
    const a = getViewerId();
    expect(localStorage.getItem(VIEWER_ID_STORAGE_KEY)).toBe(a);
    __resetViewerIdForTests();
    expect(getViewerId()).toBe(a);
  });

  it("replaces an invalid stored value", () => {
    localStorage.setItem(VIEWER_ID_STORAGE_KEY, "bad id!");
    const id = getViewerId();
    expect(isValidViewerId(id)).toBe(true);
    expect(localStorage.getItem(VIEWER_ID_STORAGE_KEY)).toBe(id);
  });

  it("falls back to sessionStorage, then memory, when storage throws", () => {
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage) {
      if (this === localStorage) throw new Error("quota");
    });
    const id = getViewerId();
    expect(isValidViewerId(id)).toBe(true);
    setSpy.mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    // In-memory fallback keeps the same id for this page.
    expect(getViewerId()).toBe(id);
  });

  it("validates ids", () => {
    expect(isValidViewerId("short")).toBe(false);
    expect(isValidViewerId("x".repeat(65))).toBe(false);
    expect(isValidViewerId(null)).toBe(false);
  });
});
