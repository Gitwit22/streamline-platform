import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

type FakeTrack = {
  kind: string;
  deviceId: string;
  stopped: boolean;
  isMuted: boolean;
  processor?: { name: string };
  mediaStreamTrack: { getSettings: () => { deviceId: string } };
  attach: ReturnType<typeof vi.fn>;
  stop: () => void;
  getProcessor: () => { name: string } | undefined;
  setProcessor: (p: { name: string }) => Promise<void>;
  stopProcessor: () => Promise<void>;
};

const created: FakeTrack[] = [];
let videoFailure: Error | null = null;

function fakeTrack(kind: string, deviceId: string): FakeTrack {
  const t: FakeTrack = {
    kind,
    deviceId,
    stopped: false,
    isMuted: false,
    mediaStreamTrack: { getSettings: () => ({ deviceId }) },
    attach: vi.fn(),
    stop: () => {
      t.stopped = true;
      t.processor = undefined;
    },
    getProcessor: () => t.processor,
    setProcessor: async (p) => {
      t.processor = p;
    },
    stopProcessor: async () => {
      t.processor = undefined;
    },
  };
  created.push(t);
  return t;
}

vi.mock("livekit-client", () => ({
  VideoPresets: { h720: { resolution: { width: 1280, height: 720 } } },
  createLocalVideoTrack: vi.fn(async (opts: { deviceId?: string }) => {
    if (videoFailure) throw videoFailure;
    return fakeTrack("video", opts?.deviceId || "cam-default");
  }),
  createLocalAudioTrack: vi.fn(async (opts: { deviceId?: string }) => fakeTrack("audio", opts?.deviceId || "mic-default")),
  createAudioAnalyser: vi.fn(() => ({ calculateVolume: () => 0.3, cleanup: async () => {} })),
}));

const processorModule = {
  supportsBackgroundProcessors: () => true,
  BackgroundProcessor: vi.fn((opts: unknown, name?: string) => ({ name: name || "", opts, switchTo: vi.fn(async () => {}) })),
};
vi.mock("../../../lib/cameraEffectApplier", async (orig) => {
  const actual = await orig<typeof import("../../../lib/cameraEffectApplier")>();
  return { ...actual, loadBackgroundProcessors: async () => processorModule };
});

import PreJoinScreen from "../PreJoinScreen";
import { cameraEffectStore } from "../../../lib/cameraEffects";
import { DEFAULT_PREJOIN_CHOICES, PREJOIN_STORAGE_KEY, type PreJoinChoices } from "../../../lib/preJoin";

const devices = [
  { kind: "videoinput", deviceId: "cam-default", label: "FaceTime HD" },
  { kind: "videoinput", deviceId: "cam2", label: "USB Camera" },
  { kind: "audioinput", deviceId: "mic-default", label: "Built-in Mic" },
];

function renderScreen(props: Partial<{ cameraAllowed: boolean; micAllowed: boolean; initial: PreJoinChoices }> = {}) {
  const onJoin = vi.fn();
  render(
    <PreJoinScreen
      displayName="Dana"
      initialChoices={props.initial || DEFAULT_PREJOIN_CHOICES}
      cameraAllowed={props.cameraAllowed ?? true}
      micAllowed={props.micAllowed ?? true}
      onJoin={onJoin}
    />,
  );
  return onJoin;
}

const live = (kind: string) => created.filter((t) => t.kind === kind && !t.stopped);

describe("PreJoinScreen", () => {
  beforeEach(() => {
    created.length = 0;
    videoFailure = null;
    localStorage.clear();
    cameraEffectStore.reset();
    processorModule.BackgroundProcessor.mockClear();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices: async () => devices, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
  });
  afterEach(() => cleanup());

  it("previews camera and mic, then hands the choices to the room and releases the devices", async () => {
    const onJoin = renderScreen();
    await waitFor(() => expect(live("video")).toHaveLength(1));
    await waitFor(() => expect(live("audio")).toHaveLength(1));
    expect(await screen.findByRole("option", { name: "USB Camera" })).toBeTruthy();

    fireEvent.click(screen.getByTestId("prejoin-join"));

    expect(onJoin).toHaveBeenCalledWith({
      videoEnabled: true,
      audioEnabled: true,
      videoDeviceId: "cam-default",
      audioDeviceId: "mic-default",
    });
    // Camera and mic are free for the room to open.
    expect(created.every((t) => t.stopped)).toBe(true);
    expect(JSON.parse(localStorage.getItem(PREJOIN_STORAGE_KEY) || "{}")).toMatchObject({ videoEnabled: true });
  });

  it("joins with the camera off when turned off, and stops the preview", async () => {
    const onJoin = renderScreen();
    await waitFor(() => expect(live("video")).toHaveLength(1));
    fireEvent.click(screen.getByTestId("prejoin-toggle-camera"));
    await waitFor(() => expect(live("video")).toHaveLength(0));
    expect(screen.getByTestId("prejoin-camera-off")).toBeTruthy();
    fireEvent.click(screen.getByTestId("prejoin-join"));
    expect(onJoin.mock.calls[0][0]).toMatchObject({ videoEnabled: false, audioEnabled: true });
  });

  it("switching camera replaces the preview track with the chosen device", async () => {
    const onJoin = renderScreen();
    await waitFor(() => expect(live("video")).toHaveLength(1));
    await screen.findByRole("option", { name: "USB Camera" });
    fireEvent.change(screen.getByLabelText("Camera"), { target: { value: "cam2" } });
    await waitFor(() => expect(live("video").map((t) => t.deviceId)).toEqual(["cam2"]));
    fireEvent.click(screen.getByTestId("prejoin-join"));
    expect(onJoin.mock.calls[0][0].videoDeviceId).toBe("cam2");
  });

  it("applies the chosen background to the preview with the same processor the room uses", async () => {
    renderScreen();
    await waitFor(() => expect(live("video")).toHaveLength(1));
    fireEvent.click(screen.getByTitle("Blur"));
    await waitFor(() => expect(live("video")[0].processor?.name).toBe("sl-camera-background"));
    expect(processorModule.BackgroundProcessor).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "background-blur", blurRadius: 14 }),
      "sl-camera-background",
    );
    // The room's controller reads this same selection after Join.
    expect(cameraEffectStore.getSnapshot().effect).toEqual({ mode: "blur-strong", imageId: null });
  });

  it("a blocked camera shows why and joins without it", async () => {
    videoFailure = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const onJoin = renderScreen();
    expect((await screen.findByTestId("prejoin-camera-error")).textContent).toMatch(/Camera blocked/);
    expect(screen.getByTestId("prejoin-toggle-camera").textContent).toBe("Camera off");
    fireEvent.click(screen.getByTestId("prejoin-join"));
    expect(onJoin.mock.calls[0][0]).toMatchObject({ videoEnabled: false, audioEnabled: true });
  });

  it("respects host controls: no camera, no background options", async () => {
    const onJoin = renderScreen({ cameraAllowed: false });
    await waitFor(() => expect(live("audio")).toHaveLength(1));
    expect(live("video")).toHaveLength(0);
    expect(screen.getByTestId("prejoin-camera-off").textContent).toMatch(/host has turned off cameras/);
    expect(screen.queryByTestId("camera-background-options")).toBeNull();
    act(() => {
      fireEvent.click(screen.getByTestId("prejoin-join"));
    });
    expect(onJoin.mock.calls[0][0].videoEnabled).toBe(false);
  });

  it("starts from the remembered choices", async () => {
    renderScreen({ initial: { videoEnabled: false, audioEnabled: false, videoDeviceId: "", audioDeviceId: "" } });
    expect(screen.getByTestId("prejoin-toggle-camera").textContent).toBe("Camera off");
    expect(screen.getByTestId("prejoin-toggle-mic").textContent).toBe("Mic off");
    await new Promise((r) => setTimeout(r, 20));
    expect(created).toHaveLength(0);
  });
});
