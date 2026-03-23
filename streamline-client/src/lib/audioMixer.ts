/**
 * Audio Mixer Engine
 *
 * Bus-based mixer model using the Web Audio API.
 *
 * Buses:
 *   guestBus        – all remote participant mic tracks
 *   localMicBus     – host microphone
 *   screenShareBus  – screen-share audio tracks
 *   musicBus        – uploaded / selected MP3 playback
 *   masterBus       – final program output
 *
 * Each bus exposes: gain, mute, solo, ducking priority,
 * and target-output flags (monitor / program).
 *
 * Two outputs:
 *   monitor  – what the producer hears locally
 *   program  – what goes to stream / recording / viewers
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BusId =
  | "guestBus"
  | "localMicBus"
  | "screenShareBus"
  | "musicBus"
  | "masterBus";

/** Which output(s) this bus feeds into. */
export interface OutputFlags {
  monitor: boolean;
  program: boolean;
}

/** Per-bus state that the UI reads / writes. */
export interface BusState {
  gain: number;          // 0 – 1 (linear)
  muted: boolean;
  solo: boolean;
  duckingPriority: number; // 0 = no ducking, higher = higher priority
  outputs: OutputFlags;
}

/** Ducking engine parameters — all tunable at runtime. */
export interface DuckingConfig {
  threshold: number;    // RMS threshold to consider a bus "active" (0–1)
  attackMs: number;     // how quickly ducking kicks in (ms)
  releaseMs: number;    // how quickly ducking fades out (ms)
  depth: number;        // gain multiplier applied to ducked buses (0–1, lower = more ducking)
  pollMs: number;       // analysis interval (ms)
}

/** Complete mixer snapshot the UI can subscribe to. */
export interface MixerState {
  buses: Record<BusId, BusState>;
  monitorGain: number;   // 0 – 1
  programGain: number;   // 0 – 1
  ducking: DuckingConfig;
}

export type MixerListener = (state: MixerState) => void;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_BUS_STATE: Record<BusId, BusState> = {
  guestBus: {
    gain: 0.8,
    muted: false,
    solo: false,
    duckingPriority: 0,
    outputs: { monitor: true, program: true },
  },
  localMicBus: {
    gain: 1.0,
    muted: false,
    solo: false,
    duckingPriority: 2,
    outputs: { monitor: true, program: true },
  },
  screenShareBus: {
    gain: 0.85,
    muted: false,
    solo: false,
    duckingPriority: 0,
    outputs: { monitor: true, program: true },
  },
  musicBus: {
    gain: 0.5,
    muted: false,
    solo: false,
    duckingPriority: 0,
    outputs: { monitor: true, program: false },
  },
  masterBus: {
    gain: 1.0,
    muted: false,
    solo: false,
    duckingPriority: 0,
    outputs: { monitor: true, program: true },
  },
};

// ---------------------------------------------------------------------------
// Human-readable labels
// ---------------------------------------------------------------------------

export const BUS_LABELS: Record<BusId, string> = {
  guestBus: "Guests",
  localMicBus: "Host Mic",
  screenShareBus: "Screen Share",
  musicBus: "Music",
  masterBus: "Master",
};

export const ALL_BUS_IDS: BusId[] = [
  "localMicBus",
  "guestBus",
  "screenShareBus",
  "musicBus",
  "masterBus",
];

// ---------------------------------------------------------------------------
// AudioMixer class
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Ducking configuration (defaults — tunable at runtime via setDuckingConfig)
// ---------------------------------------------------------------------------

const DEFAULT_DUCKING: DuckingConfig = {
  threshold: 0.01,
  attackMs: 80,
  releaseMs: 400,
  depth: 0.25,
  pollMs: 50,
};

/**
 * Client-side audio mixer built on the Web Audio API.
 *
 * Usage:
 *   const mixer = new AudioMixer();
 *   mixer.subscribe(state => { … });
 *   mixer.setGain("musicBus", 0.6);
 *   mixer.connectSource("guestBus", mediaStream);
 */
export class AudioMixer {
  private ctx: AudioContext | null = null;

  // Per-bus Web Audio nodes
  private gainNodes = new Map<BusId, GainNode>();

  // Screen-share audio processing (compressor + limiter)
  private screenShareCompressor: DynamicsCompressorNode | null = null;

  // Output buses
  private monitorGain: GainNode | null = null;
  private programGain: GainNode | null = null;

  // Program output destination — produces a real MediaStream
  private programDest: MediaStreamAudioDestinationNode | null = null;

  // Ducking
  private analysers = new Map<BusId, AnalyserNode>();
  private duckGains = new Map<BusId, GainNode>(); // per-bus ducking gain (between bus gain and outputs)
  private duckingTimer: ReturnType<typeof setInterval> | null = null;
  private duckingEnvelopes = new Map<BusId, number>(); // current ducking envelope 0..1 (1 = full duck)

  // Music bus: HTMLAudioElement source management
  private musicSource: MediaElementAudioSourceNode | null = null;
  private musicElement: HTMLAudioElement | null = null;

  // Source connections (so we can disconnect)
  private sources = new Map<string, MediaStreamAudioSourceNode>();

  // State & listeners
  private state: MixerState;
  private listeners = new Set<MixerListener>();

  constructor() {
    this.state = {
      buses: structuredClone(DEFAULT_BUS_STATE),
      monitorGain: 1.0,
      programGain: 1.0,
      ducking: { ...DEFAULT_DUCKING },
    };
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /** Call once after a user gesture to create the AudioContext. */
  init(): void {
    if (this.ctx) return;

    this.ctx = new AudioContext();

    // Create output gain nodes
    this.monitorGain = this.ctx.createGain();
    this.monitorGain.connect(this.ctx.destination); // monitor → speakers

    this.programGain = this.ctx.createGain();

    // Wire program output to a real MediaStreamDestination
    this.programDest = this.ctx.createMediaStreamDestination();
    this.programGain.connect(this.programDest);

    // Create per-bus gain nodes, ducking gains, and analysers
    for (const busId of ALL_BUS_IDS) {
      const busGain = this.ctx.createGain();
      this.gainNodes.set(busId, busGain);

      // Ducking gain sits between busGain and the output nodes
      const duckGain = this.ctx.createGain();
      this.duckGains.set(busId, duckGain);

      // For screenShareBus, insert a compressor/limiter to tame volume
      // spikes and smooth out inconsistent system audio levels.
      if (busId === "screenShareBus") {
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -24;   // start compressing earlier
        comp.knee.value = 12;
        comp.ratio.value = 6;         // moderate squeeze
        comp.attack.value = 0.003;    // fast attack for transients
        comp.release.value = 0.15;    // smooth release
        this.screenShareCompressor = comp;
        busGain.connect(comp);
        comp.connect(duckGain);
      } else {
        busGain.connect(duckGain);
      }

      // Analyser for ducking level detection
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      busGain.connect(analyser);
      this.analysers.set(busId, analyser);

      this.duckingEnvelopes.set(busId, 0);

      this.applyBusRouting(busId);
    }

    this.applyAllGains();
    this.startDuckingLoop();
  }

  /** Tear down the AudioContext and disconnect everything. */
  destroy(): void {
    this.stopDuckingLoop();

    for (const src of this.sources.values()) {
      try { src.disconnect(); } catch { /* already disconnected */ }
    }
    this.sources.clear();

    this.disconnectMusicElement();

    if (this.screenShareCompressor) {
      try { this.screenShareCompressor.disconnect(); } catch { /* ok */ }
      this.screenShareCompressor = null;
    }

    if (this.ctx && this.ctx.state !== "closed") {
      void this.ctx.close();
    }
    this.ctx = null;
    this.gainNodes.clear();
    this.duckGains.clear();
    this.analysers.clear();
    this.duckingEnvelopes.clear();
    this.monitorGain = null;
    this.programGain = null;
    this.programDest = null;
  }

  // -----------------------------------------------------------------------
  // Program output (for recording / export)
  // -----------------------------------------------------------------------

  /**
   * Returns the mixed program output as a MediaStream.
   * Can be passed to MediaRecorder or any other consumer.
   * Returns null if the mixer has not been initialized yet.
   */
  getProgramStream(): MediaStream | null {
    return this.programDest?.stream ?? null;
  }

  /**
   * Returns the raw MediaStreamDestination node for advanced consumers.
   */
  getProgramDestination(): MediaStreamAudioDestinationNode | null {
    return this.programDest;
  }

  /**
   * Convenience: returns the first audio track from the program output stream.
   * Useful for publishTrack() or adding audio to a composite MediaStream.
   */
  getProgramAudioTrack(): MediaStreamTrack | null {
    const stream = this.getProgramStream();
    if (!stream) return null;
    const tracks = stream.getAudioTracks();
    return tracks.length > 0 ? tracks[0] : null;
  }

  // -----------------------------------------------------------------------
  // Source management
  // -----------------------------------------------------------------------

  /**
   * Connect a MediaStream (e.g. a remote participant track) to a bus.
   * `key` should be a unique id for this source (e.g. participant id).
   */
  connectSource(busId: BusId, key: string, stream: MediaStream): void {
    if (!this.ctx) return;

    // Disconnect previous source with same key
    this.disconnectSource(key);

    const source = this.ctx.createMediaStreamSource(stream);
    const busNode = this.gainNodes.get(busId);
    if (busNode) source.connect(busNode);
    this.sources.set(key, source);
  }

  /** Disconnect a previously connected source by key. */
  disconnectSource(key: string): void {
    const existing = this.sources.get(key);
    if (existing) {
      try { existing.disconnect(); } catch { /* ok */ }
      this.sources.delete(key);
    }
  }

  // -----------------------------------------------------------------------
  // Music bus helpers
  // -----------------------------------------------------------------------

  /**
   * Connect an HTMLAudioElement to the musicBus.
   * Only one music element can be connected at a time; calling again
   * replaces the previous one.
   */
  connectMusicElement(el: HTMLAudioElement): void {
    if (!this.ctx) return;

    // Disconnect previous music source
    this.disconnectMusicElement();

    this.musicElement = el;
    this.musicSource = this.ctx.createMediaElementSource(el);
    const busNode = this.gainNodes.get("musicBus");
    if (busNode) this.musicSource.connect(busNode);
  }

  /** Disconnect the current music audio element from the mixer. */
  disconnectMusicElement(): void {
    if (this.musicSource) {
      try { this.musicSource.disconnect(); } catch { /* ok */ }
      this.musicSource = null;
    }
    this.musicElement = null;
  }

  /** Returns the currently connected music HTMLAudioElement, if any. */
  getMusicElement(): HTMLAudioElement | null {
    return this.musicElement;
  }

  // -----------------------------------------------------------------------
  // State mutations
  // -----------------------------------------------------------------------

  setGain(busId: BusId, value: number): void {
    this.state.buses[busId].gain = Math.max(0, Math.min(1, value));
    this.applyBusGain(busId);
    this.notify();
  }

  setMuted(busId: BusId, muted: boolean): void {
    this.state.buses[busId].muted = muted;
    this.applyBusGain(busId);
    this.notify();
  }

  setSolo(busId: BusId, solo: boolean): void {
    this.state.buses[busId].solo = solo;
    this.applyAllGains(); // solo affects all buses
    this.notify();
  }

  setDuckingPriority(busId: BusId, priority: number): void {
    this.state.buses[busId].duckingPriority = priority;
    this.notify();
  }

  setOutputFlag(busId: BusId, output: keyof OutputFlags, enabled: boolean): void {
    this.state.buses[busId].outputs[output] = enabled;
    this.applyBusRouting(busId);
    this.notify();
  }

  setMonitorGain(value: number): void {
    this.state.monitorGain = Math.max(0, Math.min(1, value));
    if (this.monitorGain) this.monitorGain.gain.value = this.state.monitorGain;
    this.notify();
  }

  setProgramGain(value: number): void {
    this.state.programGain = Math.max(0, Math.min(1, value));
    if (this.programGain) this.programGain.gain.value = this.state.programGain;
    this.notify();
  }

  /** Update ducking parameters at runtime. Partial updates are merged. */
  setDuckingConfig(partial: Partial<DuckingConfig>): void {
    const prev = this.state.ducking;
    this.state.ducking = { ...prev, ...partial };

    // If poll interval changed, restart the loop
    if (partial.pollMs !== undefined && partial.pollMs !== prev.pollMs) {
      this.stopDuckingLoop();
      this.startDuckingLoop();
    }

    this.notify();
  }

  getDuckingConfig(): DuckingConfig {
    return { ...this.state.ducking };
  }

  // -----------------------------------------------------------------------
  // Subscriptions
  // -----------------------------------------------------------------------

  subscribe(fn: MixerListener): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => { this.listeners.delete(fn); };
  }

  getState(): MixerState {
    return structuredClone(this.state);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private notify(): void {
    const snapshot = this.getState();
    for (const fn of this.listeners) fn(snapshot);
  }

  /** Compute the effective gain for a bus, honouring mute & solo. */
  private effectiveGain(busId: BusId): number {
    const bus = this.state.buses[busId];
    if (bus.muted) return 0;

    // If any bus has solo enabled, only solo'd buses are audible
    const anySolo = ALL_BUS_IDS.some((id) => this.state.buses[id].solo);
    if (anySolo && !bus.solo) return 0;

    return bus.gain;
  }

  private applyBusGain(busId: BusId): void {
    const node = this.gainNodes.get(busId);
    if (node) node.gain.value = this.effectiveGain(busId);
  }

  private applyAllGains(): void {
    for (const busId of ALL_BUS_IDS) this.applyBusGain(busId);
  }

  /**
   * (Re-)connect a bus's ducking gain node to the appropriate output nodes.
   * Audio chain: source → busGain → duckGain → monitor/program outputs
   */
  private applyBusRouting(busId: BusId): void {
    const duckNode = this.duckGains.get(busId);
    if (!duckNode) return;

    // Disconnect duckGain from outputs (busGain→duckGain connection is permanent)
    try { duckNode.disconnect(); } catch { /* nothing connected yet */ }

    const flags = this.state.buses[busId].outputs;
    if (flags.monitor && this.monitorGain) duckNode.connect(this.monitorGain);
    if (flags.program && this.programGain) duckNode.connect(this.programGain);
  }

  // -----------------------------------------------------------------------
  // Ducking engine
  // -----------------------------------------------------------------------

  private startDuckingLoop(): void {
    if (this.duckingTimer) return;
    this.duckingTimer = setInterval(() => this.processDucking(), this.state.ducking.pollMs);
  }

  private stopDuckingLoop(): void {
    if (this.duckingTimer) {
      clearInterval(this.duckingTimer);
      this.duckingTimer = null;
    }
  }

  /** Measure RMS level for a bus via its analyser node. */
  private getBusRMS(busId: BusId): number {
    const analyser = this.analysers.get(busId);
    if (!analyser) return 0;
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  }

  /**
   * Core ducking loop: detect which buses are active with high priority,
   * then attenuate lower-priority buses.
   */
  private processDucking(): void {
    if (!this.ctx) return;

    const { threshold, attackMs, releaseMs, depth, pollMs } = this.state.ducking;

    // Find the highest active ducking priority
    let maxActivePriority = 0;
    for (const busId of ALL_BUS_IDS) {
      const bus = this.state.buses[busId];
      if (bus.duckingPriority <= 0) continue;
      if (bus.muted) continue;
      const rms = this.getBusRMS(busId);
      if (rms > threshold) {
        maxActivePriority = Math.max(maxActivePriority, bus.duckingPriority);
      }
    }

    // Apply ducking envelopes
    const attackCoeff = 1 - Math.exp(-pollMs / attackMs);
    const releaseCoeff = 1 - Math.exp(-pollMs / releaseMs);

    for (const busId of ALL_BUS_IDS) {
      const bus = this.state.buses[busId];
      const duckGain = this.duckGains.get(busId);
      if (!duckGain) continue;

      // Should this bus be ducked?
      const shouldDuck =
        maxActivePriority > 0 &&
        bus.duckingPriority < maxActivePriority &&
        bus.duckingPriority >= 0;

      const currentEnv = this.duckingEnvelopes.get(busId) ?? 0;
      const targetEnv = shouldDuck ? 1 : 0;
      const coeff = targetEnv > currentEnv ? attackCoeff : releaseCoeff;
      const newEnv = currentEnv + coeff * (targetEnv - currentEnv);
      this.duckingEnvelopes.set(busId, newEnv);

      // Map envelope (0..1) to gain (1..depth)
      const duckAmount = 1 - newEnv * (1 - depth);
      duckGain.gain.value = duckAmount;
    }
  }
}
