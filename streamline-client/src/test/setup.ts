import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

declare global {
  // Allows tests to deterministically control Hls.isSupported() without per-test mocks.
  // Defaults to true.
  // eslint-disable-next-line no-var
  var __sl_hls_supported: boolean | undefined;
  // Incremented each time Hls.destroy() is called.
  // eslint-disable-next-line no-var
  var __sl_hls_destroyedCount: number | undefined;
}

globalThis.__sl_hls_supported ??= true;
globalThis.__sl_hls_destroyedCount ??= 0;

vi.mock("hls.js", () => {
  type Handler = (evt?: any, data?: any) => void;

  class HlsMock {
    static Events = {
      MANIFEST_PARSED: "MANIFEST_PARSED",
      ERROR: "ERROR",
      FRAG_BUFFERED: "FRAG_BUFFERED",
      LEVEL_SWITCHED: "LEVEL_SWITCHED",
    };

    static isSupported() {
      return globalThis.__sl_hls_supported !== false;
    }

    private handlers = new Map<string, Set<Handler>>();

    loadSource() {}
    attachMedia() {}
    startLoad() {}

    on(event: string, handler: Handler) {
      if (!this.handlers.has(event)) this.handlers.set(event, new Set());
      this.handlers.get(event)!.add(handler);
    }

    off(event: string, handler?: Handler) {
      const set = this.handlers.get(event);
      if (!set) return;
      if (!handler) {
        set.clear();
        return;
      }
      set.delete(handler);
    }

    // Optional: tests can manually trigger events if needed.
    emit(event: string, data?: any) {
      const set = this.handlers.get(event);
      if (!set) return;
      for (const handler of set) handler(event, data);
    }

    destroy() {
      globalThis.__sl_hls_destroyedCount = (globalThis.__sl_hls_destroyedCount || 0) + 1;
      this.handlers.clear();
    }
  }

  return { default: HlsMock };
});

// jsdom doesn't implement media playback APIs; stub them to avoid unhandled rejections.
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: () => Promise.resolve(),
});

Object.defineProperty(HTMLMediaElement.prototype, "pause", {
  configurable: true,
  value: () => undefined,
});

Object.defineProperty(HTMLMediaElement.prototype, "load", {
  configurable: true,
  value: () => undefined,
});
