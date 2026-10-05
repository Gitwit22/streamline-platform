import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioMixer, STREAM_LOCKED_BUSES } from "../audioMixer";

// Minimal Web Audio fake: records the connection graph so routing can be asserted.
class FakeNode {
  out = new Set<FakeNode>();
  gain = { value: 1 };
  threshold = { value: 0 };
  knee = { value: 0 };
  ratio = { value: 0 };
  attack = { value: 0 };
  release = { value: 0 };
  fftSize = 0;
  smoothingTimeConstant = 0;
  constructor(public kind: string) {}
  connect(n: FakeNode) {
    this.out.add(n);
    return n;
  }
  disconnect() {
    this.out.clear();
  }
  getFloatTimeDomainData(a: Float32Array) {
    a.fill(0);
  }
}
let trackSeq = 0;
class FakeDest extends FakeNode {
  track = { id: `t${++trackSeq}`, kind: "audio" };
  stream = { getAudioTracks: () => [this.track] };
  constructor() {
    super("dest");
  }
}
class FakeAudioContext {
  state = "running";
  destination = new FakeNode("speakers");
  dests: FakeDest[] = [];
  createGain() {
    return new FakeNode("gain");
  }
  createDynamicsCompressor() {
    return new FakeNode("comp");
  }
  createAnalyser() {
    return new FakeNode("analyser");
  }
  createMediaStreamDestination() {
    const d = new FakeDest();
    this.dests.push(d);
    return d;
  }
  createMediaStreamSource() {
    return new FakeNode("source");
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
}

/** All nodes reachable from `from`. */
function reaches(from: FakeNode, target: FakeNode, seen = new Set<FakeNode>()): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  for (const n of from.out) if (reaches(n, target, seen)) return true;
  return false;
}

type Internals = { gainNodes: Map<string, FakeNode>; streamDest: FakeNode; programDest: FakeNode };
const internals = (m: AudioMixer) => m as unknown as Internals;

describe("AudioMixer stream output", () => {
  beforeEach(() => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });
  afterEach(() => vi.unstubAllGlobals());

  const busGain = (m: AudioMixer, id: string) => internals(m).gainNodes.get(id) as FakeNode;
  const streamDest = (m: AudioMixer) => internals(m).streamDest;
  const programDest = (m: AudioMixer) => internals(m).programDest;

  it("defaults: mic + music feed the stream; guests and screen share never do", () => {
    const m = new AudioMixer();
    m.init();
    expect(reaches(busGain(m, "localMicBus"), streamDest(m))).toBe(true);
    expect(reaches(busGain(m, "musicBus"), streamDest(m))).toBe(true);
    expect(reaches(busGain(m, "guestBus"), streamDest(m))).toBe(false);
    expect(reaches(busGain(m, "screenShareBus"), streamDest(m))).toBe(false);
    // Local recording (program) still includes guests.
    expect(reaches(busGain(m, "guestBus"), programDest(m))).toBe(true);
  });

  it("stream toggle routes per bus; locked buses cannot be enabled", () => {
    const m = new AudioMixer();
    m.init();
    m.setOutputFlag("musicBus", "stream", false);
    expect(reaches(busGain(m, "musicBus"), streamDest(m))).toBe(false);
    m.setOutputFlag("musicBus", "stream", true);
    expect(reaches(busGain(m, "musicBus"), streamDest(m))).toBe(true);
    for (const id of STREAM_LOCKED_BUSES) {
      m.setOutputFlag(id, "stream", true);
      expect(m.getState().buses[id].outputs.stream).toBe(false);
      expect(reaches(busGain(m, id), streamDest(m))).toBe(false);
    }
  });

  it("identifies its own output tracks and exposes the stream track", () => {
    const m = new AudioMixer();
    expect(m.getStreamAudioTrack()).toBeNull();
    m.init();
    const t = m.getStreamAudioTrack() as unknown as MediaStreamTrack;
    expect(t).toBeTruthy();
    expect(m.isMixerOutputTrack(t)).toBe(true);
    expect(m.isMixerOutputTrack(m.getProgramAudioTrack())).toBe(true);
    expect(m.isMixerOutputTrack({ id: "mic" } as MediaStreamTrack)).toBe(false);
  });

  it("broadcast + init listeners fire; destroy stops broadcasting", () => {
    const m = new AudioMixer();
    const inits = vi.fn();
    const casts: boolean[] = [];
    m.subscribeInit(inits);
    m.subscribeBroadcast((on) => casts.push(on));
    m.init();
    m.init(); // idempotent
    expect(inits).toHaveBeenCalledTimes(1);
    m.setBroadcasting(true);
    m.setBroadcasting(true);
    expect(m.isBroadcasting()).toBe(true);
    m.destroy();
    expect(m.isBroadcasting()).toBe(false);
    expect(casts).toEqual([true, false]);
  });
});
