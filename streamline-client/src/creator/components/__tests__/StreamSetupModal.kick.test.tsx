import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../../../lib/api", () => ({
  apiFetchAuth: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
}));
vi.mock("../../../services/hls", () => ({
  getHlsStatus: vi.fn(async () => ({ status: "idle" })),
  startHls: vi.fn(),
  stopHls: vi.fn(),
}));

import StreamSetupModal from "../StreamSetupModal";

const KICK_URL = "rtmps://fa723fc1b171.global-contribute.live-video.net:443/app";
const savedKick = {
  id: "dest-kick",
  targetId: "tgt-kick",
  platform: "kick",
  name: "My Kick",
  enabled: true,
  mode: "manual" as const,
  persistent: true,
  rtmpUrlBase: KICK_URL,
  status: "connected" as const,
  hasKey: true,
  keyPreview: "1111",
};

function renderModal(extra: Record<string, unknown> = {}) {
  const onStartStream = vi.fn(async () => {});
  render(
    <StreamSetupModal
      open
      onClose={() => {}}
      roomName="Room"
      roomId="room-1"
      roomAccessToken="tok"
      streamStatus="idle"
      onStartStream={onStartStream}
      onStopStream={async () => {}}
      recordingStatus="idle"
      onStartRecording={async () => {}}
      onStopRecording={async () => {}}
      rtmpDestinationsMax={3}
      multistreamAllowed
      showHlsSection={false}
      {...extra}
    />
  );
  fireEvent.click(screen.getByText("Stream Destinations"));
  return { onStartStream };
}

function kickCard() {
  const label = screen.getAllByText("Kick").find((el) => el.tagName === "SPAN");
  return label!.closest("div[style*='border-radius']") as HTMLElement;
}

afterEach(() => {
  cleanup();
  localStorage.clear(); // the section remembers open/closed per room
});

describe("Kick in the Go Live picker", () => {
  it("lists Kick with the saved destination's status and masked key preview", () => {
    renderModal({ savedDestinations: [savedKick] });
    const card = kickCard();
    expect(within(card).getByText(/connected • ••••1111/)).toBeTruthy();
  });

  it("saved Kick destination: enabling it and going live sends the destination id, not a key", async () => {
    const { onStartStream } = renderModal({ savedDestinations: [savedKick] });
    fireEvent.click(within(kickCard()).getByRole("checkbox"));
    fireEvent.click(screen.getByText("📡 Go Live"));
    await Promise.resolve();
    expect(onStartStream).toHaveBeenCalledTimes(1);
    const payload = (onStartStream.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.enabledTargetIds).toEqual(["dest-kick"]);
    expect(JSON.stringify(payload)).not.toContain("sk_");
  });

  it("Add key: masked Stream Key field plus Server URL prefilled from the saved destination", () => {
    renderModal({ savedDestinations: [savedKick] });
    fireEvent.click(within(kickCard()).getByText("Add key"));
    const keyInput = within(kickCard()).getByLabelText(/Kick Stream Key/) as HTMLInputElement;
    expect(keyInput.type).toBe("password");
    const urlInput = within(kickCard()).getByLabelText("Kick Server URL") as HTMLInputElement;
    expect(urlInput.value).toBe(KICK_URL);
  });

  it("no saved Kick: setup help shown; an rtmp:// Server URL is flagged on the Kick card only", async () => {
    const { onStartStream } = renderModal({ savedDestinations: [] });
    const card = kickCard();
    expect(within(card).getByText(/No saved Kick destination yet/)).toBeTruthy();
    fireEvent.click(within(card).getByText("Add key"));
    fireEvent.change(within(kickCard()).getByLabelText("Kick Server URL"), { target: { value: "rtmp://ingest.example.net/app" } });
    fireEvent.change(within(kickCard()).getByLabelText(/Kick Stream Key/), { target: { value: "sk_us-west-2_Abc123" } });
    fireEvent.click(screen.getByText("📡 Go Live"));
    await Promise.resolve();
    expect(onStartStream).not.toHaveBeenCalled();
    expect(within(kickCard()).getByText(/must start with rtmps:\/\//)).toBeTruthy();
  });
});
