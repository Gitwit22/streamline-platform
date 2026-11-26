import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DeckState } from "../../../lib/audioDeck";
import type { VideoDeckState } from "../../../lib/mediaVideo";

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

const videoDeck = {
  ensureLoaded: vi.fn(async () => {}),
  addFiles: vi.fn(() => 1),
  addFromLibrary: vi.fn(() => true),
  play: vi.fn(async () => {}),
  togglePause: vi.fn(),
  stop: vi.fn(async () => {}),
  seek: vi.fn(),
  setPlayMode: vi.fn(),
  addYouTube: vi.fn((): string | null => null),
  openPlayer: vi.fn(),
  capturePlayer: vi.fn(async () => {}),
  disconnectPlayer: vi.fn(),
  setVolume: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
  retrySave: vi.fn(),
  clearError: vi.fn(),
};
let videoState: VideoDeckState;
vi.mock("../../hooks/useVideoDeck", () => ({ useVideoDeck: () => ({ deck: videoDeck, state: videoState }) }));
function baseVideoState(over: Partial<VideoDeckState> = {}): VideoDeckState {
  return {
    loaded: true,
    persistError: null,
    videos: [],
    currentId: null,
    target: null,
    status: "off",
    playing: false,
    position: 0,
    duration: 0,
    playMode: "once",
    error: null,
    notice: null,
    preview: null,
    attached: true,
    caps: { stage: true, box: true, sound: true },
    player: "none",
    ...over,
  };
}

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
  beforeEach(() => {
    videoState = baseVideoState();
  });
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
    // Sections: Videos, Playlist, Soundboard.
    fireEvent.click(screen.getAllByText("From library")[1]);
    fireEvent.click(await screen.findByText("Theme"));
    expect(screen.queryByText("Clip")).toBeNull();
    expect(deck.addFromLibrary).toHaveBeenCalledWith({ id: "a1", name: "Theme", url: "https://x/a1" }, "playlist");
  });
  it("is titled Media", () => {
    state = baseState();
    render(<AudioDeckPanel open onClose={() => {}} />);
    expect(screen.getByText("🎞️ Media")).toBeTruthy();
    expect(videoDeck.ensureLoaded).toHaveBeenCalled();
  });

  it("adds video files by drop and file picker, and rejects non-video files", () => {
    state = baseState();
    render(<AudioDeckPanel open onClose={() => {}} />);
    const files = [new File(["x"], "clip.mp4", { type: "video/mp4" })];
    fireEvent.drop(screen.getByTestId("videos-drop"), { dataTransfer: { files, types: ["Files"] } });
    expect(videoDeck.addFiles).toHaveBeenLastCalledWith(files);
    fireEvent.change(screen.getByTestId("videos-file-input"), { target: { files } });
    expect(videoDeck.addFiles).toHaveBeenLastCalledWith(files);
    videoDeck.addFiles.mockReturnValueOnce(0);
    fireEvent.drop(screen.getByTestId("videos-drop"), { dataTransfer: { files: [mp3("a.mp3")], types: ["Files"] } });
    expect(screen.getByText("Only video files can be added.")).toBeTruthy();
  });

  it("plays in the box or on stage and stops back to the camera", () => {
    state = baseState();
    videoState = baseVideoState({
      videos: [
        { id: "v1", kind: "file", name: "Intro", volume: 1, assetId: "a", youtubeId: null, url: "https://x/v1", saveState: "saved" },
        { id: "v2", kind: "file", name: "Promo", volume: 1, assetId: "b", youtubeId: null, url: "https://x/v2", saveState: "saved" },
      ],
      currentId: "v2",
      target: "box",
      status: "live",
      playing: true,
      duration: 30,
    });
    render(<AudioDeckPanel open onClose={() => {}} />);
    expect(screen.getByTestId("video-now-playing").textContent).toContain("In your video box: Promo");
    fireEvent.click(screen.getByTitle("Play Intro in my video box"));
    expect(videoDeck.play).toHaveBeenLastCalledWith("v1", "box");
    fireEvent.click(screen.getByTitle("Play Intro on stage"));
    expect(videoDeck.play).toHaveBeenLastCalledWith("v1", "stage");
    fireEvent.click(screen.getByLabelText("Pause video"));
    expect(videoDeck.togglePause).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Stop (back to my camera)"));
    expect(videoDeck.stop).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Play mode"), { target: { value: "next" } });
    expect(videoDeck.setPlayMode).toHaveBeenCalledWith("next");
  });

  it("disables playing outside a room, and explains it to invisible hosts", () => {
    state = baseState();
    const v1 = { id: "v1", kind: "file" as const, name: "Intro", volume: 1, assetId: "a", youtubeId: null, url: "https://x/v1", saveState: "saved" as const };
    videoState = baseVideoState({ attached: false, caps: { stage: false, box: false, sound: false }, videos: [v1] });
    render(<AudioDeckPanel open onClose={() => {}} />);
    expect(screen.getByText("Join the room to play videos.")).toBeTruthy();
    expect((screen.getByTitle("Play Intro in my video box") as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    videoState = baseVideoState({ caps: { stage: false, box: false, sound: false }, videos: [v1] });
    render(<AudioDeckPanel open onClose={() => {}} />);
    expect(screen.getByTestId("video-cant-publish").textContent).toMatch(/Invisible hosts/);
    expect((screen.getByTitle("Play Intro on stage") as HTMLButtonElement).disabled).toBe(true);
  });

  it("adds YouTube links and walks through connecting the player", () => {
    state = baseState();
    render(<AudioDeckPanel open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("YouTube link"), { target: { value: "https://youtu.be/dQw4w9WgXcQ" } });
    fireEvent.click(screen.getByText("+ YouTube"));
    expect(videoDeck.addYouTube).toHaveBeenCalledWith("https://youtu.be/dQw4w9WgXcQ");
    videoDeck.addYouTube.mockReturnValueOnce("That isn't a YouTube video link.");
    fireEvent.change(screen.getByLabelText("YouTube link"), { target: { value: "nope" } });
    fireEvent.click(screen.getByText("+ YouTube"));
    expect(screen.getByText("That isn't a YouTube video link.")).toBeTruthy();
    cleanup();

    const yt = { id: "y1", kind: "youtube" as const, name: "Song", volume: 1, assetId: null, youtubeId: "dQw4w9WgXcQ", url: null, saveState: "saved" as const };
    videoState = baseVideoState({ videos: [yt], player: "ready" });
    render(<AudioDeckPanel open onClose={() => {}} />);
    const blocked = screen.getAllByTitle("Connect the YouTube player first") as HTMLButtonElement[];
    expect(blocked).toHaveLength(2); // Box + Stage
    expect(blocked.every((b) => b.disabled)).toBe(true);
    fireEvent.click(screen.getByText("Open player tab again"));
    expect(videoDeck.openPlayer).toHaveBeenCalled();
    fireEvent.click(screen.getByText("2. Capture player tab"));
    expect(videoDeck.capturePlayer).toHaveBeenCalled();
    cleanup();

    videoState = baseVideoState({ videos: [yt], player: "connected" });
    render(<AudioDeckPanel open onClose={() => {}} />);
    expect(screen.getByTestId("yt-player-connected")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Play Song on stage"));
    expect(videoDeck.play).toHaveBeenLastCalledWith("y1", "stage");
  });

  it("adds finished videos and recordings from the library, not audio or unfinished recordings", async () => {
    state = baseState();
    listMock.mockResolvedValue([
      { id: "a1", type: "audio", name: "Theme", videoUrl: "https://x/a1", duration: 65 },
      { id: "v1", type: "video", name: "Clip", videoUrl: "https://x/v1", duration: 5, hasVideo: true },
      { id: "r1", type: "recording", name: "Last show", videoUrl: "https://x/r1", status: "ready", hasVideo: true },
      { id: "r2", type: "recording", name: "Processing show", videoUrl: "https://x/r2", status: "processing" },
    ]);
    render(<AudioDeckPanel open onClose={() => {}} />);
    fireEvent.click(screen.getAllByText("From library")[0]);
    fireEvent.click(await screen.findByText("Clip"));
    expect(screen.getByText("Last show")).toBeTruthy();
    expect(screen.queryByText("Theme")).toBeNull();
    expect(screen.queryByText("Processing show")).toBeNull();
    expect(videoDeck.addFromLibrary).toHaveBeenCalledWith({ id: "v1", name: "Clip", url: "https://x/v1" });
  });
});
