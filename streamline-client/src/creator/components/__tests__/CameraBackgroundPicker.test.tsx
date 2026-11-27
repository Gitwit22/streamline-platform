import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import CameraBackgroundPicker from "../CameraBackgroundPicker";
import { cameraEffectStore } from "../../../lib/cameraEffects";

describe("CameraBackgroundPicker", () => {
  beforeEach(() => {
    localStorage.clear();
    cameraEffectStore.reset();
  });
  afterEach(() => cleanup());

  it("is hidden for people who can't publish a camera", () => {
    render(<CameraBackgroundPicker canUseCamera={false} />);
    expect(screen.queryByTestId("camera-background-toggle")).toBeNull();
  });

  it("picking blur and an image updates the selection", () => {
    render(<CameraBackgroundPicker canUseCamera />);
    fireEvent.click(screen.getByTestId("camera-background-toggle"));
    fireEvent.click(screen.getByTitle("Blur"));
    expect(cameraEffectStore.getSnapshot().effect).toEqual({ mode: "blur-strong", imageId: null });
    expect(screen.getByTestId("camera-background-toggle").textContent).toBe("Background: blur");

    fireEvent.click(screen.getByTitle("Ocean"));
    expect(cameraEffectStore.getSnapshot().effect).toEqual({ mode: "image", imageId: "ocean" });
    expect(screen.getByTitle("Ocean").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByTitle("None"));
    expect(cameraEffectStore.getSnapshot().effect.mode).toBe("none");
  });

  it("shows a failure from the controller and the reverted selection", () => {
    render(<CameraBackgroundPicker canUseCamera />);
    fireEvent.click(screen.getByTestId("camera-background-toggle"));
    fireEvent.click(screen.getByTitle("Slight blur"));
    act(() => cameraEffectStore.fail("Background effects aren't supported in this browser."));
    expect(screen.getByRole("alert").textContent).toMatch(/supported in this browser/);
    expect(screen.getByTitle("None").getAttribute("aria-pressed")).toBe("true");
  });

  it("rejects an unsupported upload without changing the background", async () => {
    render(<CameraBackgroundPicker canUseCamera />);
    fireEvent.click(screen.getByTestId("camera-background-toggle"));
    const gif = new File(["GIF89a"], "x.gif", { type: "image/gif" });
    fireEvent.change(screen.getByLabelText("Upload your own background"), { target: { files: [gif] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/PNG, JPG or WebP/);
    expect(cameraEffectStore.getSnapshot().effect.mode).toBe("none");
  });

  it("offers the saved custom image and removing it", () => {
    cameraEffectStore.setCustomImage("data:image/jpeg;base64,AA");
    render(<CameraBackgroundPicker canUseCamera />);
    fireEvent.click(screen.getByTestId("camera-background-toggle"));
    expect(screen.getByTitle("Your image").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByText("Remove your image"));
    expect(screen.queryByTitle("Your image")).toBeNull();
    expect(cameraEffectStore.getSnapshot().effect.mode).toBe("none");
  });
});
