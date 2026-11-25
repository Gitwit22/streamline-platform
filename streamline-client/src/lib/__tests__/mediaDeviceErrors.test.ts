import { describe, expect, it } from "vitest";
import { classifyMediaDeviceError, deviceFromKind } from "../mediaDeviceErrors";

const err = (name: string, message = "") => Object.assign(new Error(message), { name });

describe("classifyMediaDeviceError", () => {
  it("ignores a cancelled screen-share picker (NotAllowedError, no device kind)", () => {
    // Regression: this used to show "Camera/mic blocked" while camera and mic worked.
    expect(classifyMediaDeviceError(err("NotAllowedError", "Permission denied by user"))).toBeNull();
    expect(classifyMediaDeviceError(err("NotAllowedError", "Permission denied"), undefined)).toBeNull();
  });

  it("explains an OS-level screen recording block without a reload button", () => {
    const r = classifyMediaDeviceError(err("NotAllowedError", "Permission denied by system"));
    expect(r?.device).toBe("screen");
    expect(r?.type).toBe("notSupported");
    expect(r?.message).toMatch(/system settings/);
  });

  it("names the device that was denied", () => {
    const cam = classifyMediaDeviceError(err("NotAllowedError"), "videoinput");
    expect(cam).toMatchObject({ type: "denied", device: "videoinput" });
    expect(cam?.message).toMatch(/^🔒 Camera blocked/);
    const mic = classifyMediaDeviceError(err("PermissionDeniedError"), "audioinput");
    expect(mic).toMatchObject({ type: "denied", device: "audioinput" });
    expect(mic?.message).toMatch(/^🔒 Microphone blocked/);
  });

  it("maps other device errors", () => {
    expect(classifyMediaDeviceError(err("NotFoundError"), "videoinput")?.type).toBe("notFound");
    expect(classifyMediaDeviceError(err("NotReadableError"), "audioinput")?.type).toBe("notReadable");
    expect(classifyMediaDeviceError(err("OverconstrainedError"), "videoinput")?.type).toBe("notSupported");
    expect(classifyMediaDeviceError(err("AbortError"), "videoinput")?.message).toMatch(/AbortError/);
  });

  it("deviceFromKind treats anything but mic/camera as screen share", () => {
    expect(deviceFromKind("audioinput")).toBe("audioinput");
    expect(deviceFromKind("videoinput")).toBe("videoinput");
    expect(deviceFromKind(undefined)).toBe("screen");
    expect(deviceFromKind("audiooutput")).toBe("screen");
  });
});
