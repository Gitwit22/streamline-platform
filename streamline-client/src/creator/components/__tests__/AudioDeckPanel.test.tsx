import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DeckState } from "../../../lib/audioDeck";

const deck = {
  ensureLoaded: vi.fn(async () => {}),
  addFiles: vi.fn(() => 1),
  addFromLibrary: vi.fn(() => true),
  playTrack: vi.fn(),
  togglePlay: vi.fn(),
  next: vi.fn(),
  previous: vi.fn(),
  stop: vi.fn(),
  seek: vi.fn(),
  setLoopMode: vi.fn(),
  setVolume: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
  retrySave: vi.fn(),
  playPad: vi.fn(async () => {}),
  stopPad: vi.fn(),
  stopAllPads: vi.fn(),
  clearError: vi.fn(),
};
let state: DeckState;
vi.mock("../../hooks/useAudioDeck", () => ({ useAudioDeck: () => ({ deck, state }) }));

let broadcasting = false;
vi.mock("../../../lib/mixerInstance", () => ({
  getMixer: () => ({ isBroadcasting: () => broadcasting, subscribeBroadcast: () => () => {} }),
}));

const listMock = vi.fn();
vi.mock("../../../lib/editingApi", () => ({ assetsApi: { list: (...a: unknown[]) => listMock(...a) } }));

import AudioDeckPanel from "../AudioDeckPanel";

function baseState(over: Partial<DeckState> = {}): DeckState {
  return {
    loaded: true,
    persistError: null,
    playlist: [],
    pads: [],
    currentId: null,
    playing: false,
    position: 0,
    duration: 0,
    loopMode: "all",
    padsPlaying: [],
    error: null,
    ...over,
  };
}

const mp3 = (name: string) => new File(["x"], name, { type: "audio/mpeg" });

describe("AudioDeckPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    broadcasting = false;
  });

  it("loads the deck and warns when the mix isn't sent to the stream", () => {
    state = baseState();
    const openMixer = vi.fn();
    render(<AudioDeckPanel open onClose={() => {}} onOpenMixer={openMixer} />);
    expect(deck.ensureLoaded).toHaveBeenCalled();
    expect(screen.getByTestId("audio-not-broadcasting").textContent).toContain("Only you hear this");
    fireEvent.click(screen.getByText("Open mixer"));
    expect(openMixer).toHaveBeenCalled();
  });

  it("hides the warning while broadcasting", () => {
    broadcasting = true;
    state = baseState();
    render(<AudioDeckPanel open onClose={() => {}} />);
    expect(screen.queryByTestId("audio-not-broadcasting")).toBeNull();
  });

  it("drops files onto the playlist and the soundboard", () => {
    state = baseState();
    render(<AudioDeckPanel open onClose={() => {}} />);
    const files = [mp3("a.mp3")];
    fireEvent.drop(screen.getByTestId("playlist-drop"), { dataTransfer: { files, types: ["Files"] } });
    expect(deck.addFiles).toHaveBeenLastCalledWith(files, "playlist");
    fireEvent.drop(screen.getByTestId("pads-drop"), { dataTransfer: { files, types: ["Files"] } });
    expect(deck.addFiles).toHaveBeenLastCalledWith(files, "pads");
    fireEvent.change(screen.getByTestId("pads-file-input"), { target: { files } });
    expect(deck.addFiles).toHaveBeenLastCalledWith(files, "pads");
  });

  it("says so when nothing could be added", () => {
    state = baseState();
    deck.addFiles.mockReturnValueOnce(0);
    render(<AudioDeckPanel open onClose={() => {}} />);
    fireEvent.drop(screen.getByTestId("playlist-drop"), {
      dataTransfer: { files: [new File(["x"], "a.txt", { type: "text/plain" })], types: ["Files"] },
    });
    expect(screen.getByText("Only audio files can be added.")).toBeTruthy();
  });

  it("shows playback controls, save state and retry", () => {
    state = baseState({
      playlist: [
        { id: "t1", name: "Intro", volume: 1, assetId: "a1", url: "https://x/a1", saveState: "saved" },
        { id: "t2", name: "Big file", volume: 1, assetId: null, url: "blob:1", saveState: "failed", saveError: "Storage limit exceeded" },
        { id: "t3", name: "Old", volume: 1, assetId: "gone", url: null, saveState: "missing" },
      ],
      currentId: "t1",
      playing: true,
      duration: 100,
      position: 30,
    });
    render(<AudioDeckPanel open onClose={() => {}} />);
    expect(screen.getByTestId("now-playing").textContent).toBe("Intro");
    fireEvent.click(screen.getByLabelText("Pause"));
    expect(deck.togglePlay).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Next"));
    expect(deck.next).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Seek"), { target: { value: "50" } });
    expect(deck.seek).toHaveBeenCalledWith(50);
    fireEvent.change(screen.getByLabelText("Loop"), { target: { value: "one" } });
    expect(deck.setLoopMode).toHaveBeenCalledWith("one");
    expect(screen.getByText("Unavailable")).toBeTruthy();
    fireEvent.click(screen.getByText("Retry"));
    expect(deck.retrySave).toHaveBeenCalledWith("t2");
    fireEvent.click(screen.getByLabelText("Remove Old"));
    expect(deck.remove).toHaveBeenCalledWith("t3");
  });

  it("plays and stops pads", () => {
    state = baseState({
      pads: [
        { id: "p1", name: "Clap", volume: 1, assetId: "a", url: "https://x/a", saveState: "saved" },
        { id: "p2", name: "Horn", volume: 1, assetId: "b", url: "https://x/b", saveState: "saved" },
      ],
      padsPlaying: ["p2"],
    });
    render(<AudioDeckPanel open onClose={() => {}} />);
    fireEvent.click(screen.getByTitle("Play Clap"));
    expect(deck.playPad).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByTitle("Stop Horn"));
    expect(deck.stopPad).toHaveBeenCalledWith("p2");
    fireEvent.click(screen.getByText("Stop all"));
    expect(deck.stopAllPads).toHaveBeenCalled();
  });

  it("adds audio from the content library", async () => {
    state = baseState();
    listMock.mockResolvedValue([
      { id: "a1", type: "audio", name: "Theme", videoUrl: "https://x/a1", duration: 65 },
      { id: "v1", type: "video", name: "Clip", videoUrl: "https://x/v1", duration: 5 },
    ]);
    render(<AudioDeckPanel open onClose={() => {}} />);
    fireEvent.click(screen.getAllByText("From library")[0]);
    fireEvent.click(await screen.findByText("Theme"));
    expect(screen.queryByText("Clip")).toBeNull();
    expect(deck.addFromLibrary).toHaveBeenCalledWith({ id: "a1", name: "Theme", url: "https://x/a1" }, "playlist");
  });
});
