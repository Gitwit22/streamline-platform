import { useEffect, useRef, useState, useCallback } from "react";
import {
  AudioMixer,
  ALL_BUS_IDS,
  BUS_LABELS,
  type BusId,
  type MixerState,
  type DuckingConfig,
} from "../../lib/audioMixer";
import { useLocalRecording } from "../hooks/useLocalRecording";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AudioMixerModalProps {
  open: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Singleton mixer instance (lives for the lifetime of the tab)
// ---------------------------------------------------------------------------

let _mixerInstance: AudioMixer | null = null;

export function getMixer(): AudioMixer {
  if (!_mixerInstance) _mixerInstance = new AudioMixer();
  return _mixerInstance;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AudioMixerModal({ open, onClose }: AudioMixerModalProps) {
  const mixer = useRef(getMixer()).current;
  const [state, setState] = useState<MixerState>(() => mixer.getState());

  // Subscribe to mixer state updates
  useEffect(() => {
    const unsub = mixer.subscribe(setState);
    return unsub;
  }, [mixer]);

  // Initialise AudioContext on first open (requires user gesture)
  useEffect(() => {
    if (open) mixer.init();
  }, [open, mixer]);

  // Keyboard: Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleGain = useCallback(
    (busId: BusId, v: number) => mixer.setGain(busId, v),
    [mixer],
  );
  const handleMute = useCallback(
    (busId: BusId) => {
      const cur = state.buses[busId].muted;
      mixer.setMuted(busId, !cur);
    },
    [mixer, state],
  );
  const handleSolo = useCallback(
    (busId: BusId) => {
      const cur = state.buses[busId].solo;
      mixer.setSolo(busId, !cur);
    },
    [mixer, state],
  );
  const handleOutputToggle = useCallback(
    (busId: BusId, output: "monitor" | "program") => {
      const cur = state.buses[busId].outputs[output];
      mixer.setOutputFlag(busId, output, !cur);
    },
    [mixer, state],
  );

  // --- Music player state ---
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicFileInputRef = useRef<HTMLInputElement>(null);
  const [musicPlaying, setMusicPlaying] = useState(false);

  const loadMusicFile = useCallback((file: File) => {
    // Clean up previous
    if (musicAudioRef.current) {
      musicAudioRef.current.pause();
      mixer.disconnectMusicElement();
      URL.revokeObjectURL(musicAudioRef.current.src);
      musicAudioRef.current = null;
    }

    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.src = URL.createObjectURL(file);
    audio.loop = true;
    musicAudioRef.current = audio;
    setMusicFile(file);
    setMusicPlaying(false);

    // Must init context first (user gesture)
    mixer.init();
    mixer.connectMusicElement(audio);
  }, [mixer]);

  const toggleMusicPlay = useCallback(() => {
    const audio = musicAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => { /* autoplay blocked */ });
      setMusicPlaying(true);
    } else {
      audio.pause();
      setMusicPlaying(false);
    }
  }, []);

  const stopMusic = useCallback(() => {
    const audio = musicAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setMusicPlaying(false);
  }, []);

  const removeMusic = useCallback(() => {
    if (musicAudioRef.current) {
      musicAudioRef.current.pause();
      mixer.disconnectMusicElement();
      URL.revokeObjectURL(musicAudioRef.current.src);
      musicAudioRef.current = null;
    }
    setMusicFile(null);
    setMusicPlaying(false);
  }, [mixer]);

  // Sync play state if audio ends (for non-loop scenarios)
  useEffect(() => {
    const audio = musicAudioRef.current;
    if (!audio) return;
    const onEnded = () => setMusicPlaying(false);
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  });

  // Cleanup music on unmount
  useEffect(() => {
    return () => {
      if (musicAudioRef.current) {
        musicAudioRef.current.pause();
        URL.revokeObjectURL(musicAudioRef.current.src);
      }
    };
  }, []);

  // --- Local recording ---
  const recording = useLocalRecording();

  if (!open) return null;

  const inputBuses = ALL_BUS_IDS.filter((id) => id !== "masterBus");

  return (
    <div
      style={{
        position: "fixed",
        bottom: "80px",
        right: "420px",
        zIndex: 51,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          width: "460px",
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          background: "rgba(20, 20, 20, 0.98)",
          border: "1px solid rgba(139, 92, 246, 0.5)",
          borderRadius: "0.75rem",
          boxShadow: "0 20px 60px rgba(139, 92, 246, 0.2)",
          backdropFilter: "blur(20px)",
          color: "#e5e7eb",
        }}
      >
        {/* ---- Header ---- */}
        <div
          style={{
            padding: "0.75rem 1rem",
            background:
              "linear-gradient(135deg, rgba(139,92,246,0.12), rgba(168,85,247,0.06))",
            borderBottom: "2px solid rgba(139,92,246,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "#a78bfa",
              }}
            >
              🎛️ Audio Mixer
            </div>
            <div style={{ fontSize: "0.65rem", color: "#9ca3af", marginTop: 2 }}>
              Monitor = your headphones &bull; Program = recording/export mix
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(139,92,246,0.15)",
              border: "1px solid rgba(139,92,246,0.3)",
              borderRadius: "0.4rem",
              color: "#c4b5fd",
              cursor: "pointer",
              padding: "0.25rem 0.55rem",
              fontSize: "0.8rem",
              fontWeight: 600,
              lineHeight: 1,
            }}
            aria-label="Close mixer"
          >
            ✕
          </button>
        </div>

        {/* ---- Content ---- */}
        <div style={{ padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>

          {/* Output header labels */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 60px 60px",
              gap: "0.4rem",
              alignItems: "center",
              paddingBottom: "0.25rem",
              borderBottom: "1px solid rgba(55,65,81,0.6)",
            }}
          >
            <span style={{ fontSize: "0.65rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Bus
            </span>
            <span
              style={{
                fontSize: "0.6rem",
                color: "#34d399",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                textAlign: "center",
              }}
            >
              Monitor
            </span>
            <span
              style={{
                fontSize: "0.6rem",
                color: "#f87171",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                textAlign: "center",
              }}
            >
              Program
            </span>
          </div>

          {/* ---- Input buses ---- */}
          {inputBuses.map((busId) => (
            <BusStrip
              key={busId}
              busId={busId}
              bus={state.buses[busId]}
              onGain={handleGain}
              onMute={handleMute}
              onSolo={handleSolo}
              onOutputToggle={handleOutputToggle}
            />
          ))}

          {/* ---- Divider ---- */}
          <div style={{ borderTop: "1px solid rgba(139,92,246,0.25)", margin: "0.15rem 0" }} />

          {/* ---- Master bus ---- */}
          <BusStrip
            busId="masterBus"
            bus={state.buses.masterBus}
            onGain={handleGain}
            onMute={handleMute}
            onSolo={handleSolo}
            onOutputToggle={handleOutputToggle}
            isMaster
          />

          {/* ---- Output gains ---- */}
          <div
            style={{
              display: "flex",
              gap: "1rem",
              marginTop: "0.25rem",
              padding: "0.6rem",
              background: "rgba(15,23,42,0.7)",
              borderRadius: "0.4rem",
              border: "1px solid rgba(55,65,81,0.5)",
            }}
          >
            <OutputFader
              label="Monitor"
              sublabel="What you hear locally"
              color="#34d399"
              value={state.monitorGain}
              onChange={(v) => mixer.setMonitorGain(v)}
            />
            <OutputFader
              label="Program"
              sublabel="Recording / export output"
              color="#f87171"
              value={state.programGain}
              onChange={(v) => mixer.setProgramGain(v)}
            />
          </div>

          {/* ---- Music Player ---- */}
          <div
            style={{
              padding: "0.6rem",
              background: "rgba(15,23,42,0.7)",
              borderRadius: "0.4rem",
              border: "1px solid rgba(55,65,81,0.5)",
              display: "flex",
              flexDirection: "column",
              gap: "0.4rem",
            }}
          >
            <div style={{ fontSize: "0.65rem", fontWeight: 600, color: "#a78bfa", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              🎵 Music
            </div>
            <input
              ref={musicFileInputRef}
              type="file"
              accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac,audio/mp4,audio/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) loadMusicFile(file);
                e.target.value = "";
              }}
            />
            {!musicFile ? (
              <button
                onClick={() => musicFileInputRef.current?.click()}
                style={{
                  fontSize: "0.65rem",
                  padding: "0.4rem 0.6rem",
                  borderRadius: "0.3rem",
                  border: "1px solid rgba(139,92,246,0.3)",
                  background: "rgba(139,92,246,0.1)",
                  color: "#c4b5fd",
                  cursor: "pointer",
                }}
              >
                Load audio file…
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.6rem", color: "#d1d5db", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {musicFile.name}
                </span>
                <button
                  onClick={toggleMusicPlay}
                  title={musicPlaying ? "Pause" : "Play"}
                  style={{
                    width: 28, height: 22, fontSize: "0.6rem", fontWeight: 700,
                    borderRadius: "0.25rem", border: "none", cursor: "pointer",
                    background: musicPlaying ? "#eab308" : "#059669",
                    color: musicPlaying ? "#000" : "#fff",
                  }}
                >
                  {musicPlaying ? "⏸" : "▶"}
                </button>
                <button
                  onClick={stopMusic}
                  title="Stop"
                  style={{
                    width: 28, height: 22, fontSize: "0.6rem", fontWeight: 700,
                    borderRadius: "0.25rem", border: "none", cursor: "pointer",
                    background: "rgba(55,65,81,0.7)", color: "#9ca3af",
                  }}
                >
                  ⏹
                </button>
                <button
                  onClick={() => musicFileInputRef.current?.click()}
                  title="Replace"
                  style={{
                    width: 28, height: 22, fontSize: "0.55rem", fontWeight: 700,
                    borderRadius: "0.25rem", border: "none", cursor: "pointer",
                    background: "rgba(55,65,81,0.7)", color: "#9ca3af",
                  }}
                >
                  📂
                </button>
                <button
                  onClick={removeMusic}
                  title="Remove"
                  style={{
                    width: 28, height: 22, fontSize: "0.55rem", fontWeight: 700,
                    borderRadius: "0.25rem", border: "none", cursor: "pointer",
                    background: "rgba(220,38,38,0.2)", color: "#f87171",
                  }}
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* ---- Local Recording ---- */}
          <div
            style={{
              padding: "0.6rem",
              background: "rgba(15,23,42,0.7)",
              borderRadius: "0.4rem",
              border: recording.state === "recording"
                ? "1px solid rgba(220,38,38,0.5)"
                : "1px solid rgba(55,65,81,0.5)",
              display: "flex",
              flexDirection: "column",
              gap: "0.4rem",
            }}
          >
            <div style={{ fontSize: "0.65rem", fontWeight: 600, color: "#f87171", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              ⏺ Program Recording
            </div>
            <div style={{ fontSize: "0.55rem", color: "#6b7280" }}>
              Records the mixed program output locally. Does not affect LiveKit live audio.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              {recording.state === "idle" && !recording.lastResult && (
                <button
                  onClick={recording.start}
                  style={{
                    fontSize: "0.65rem", padding: "0.35rem 0.6rem",
                    borderRadius: "0.3rem", border: "1px solid rgba(220,38,38,0.3)",
                    background: "rgba(220,38,38,0.1)", color: "#f87171",
                    cursor: "pointer",
                  }}
                >
                  Start Recording
                </button>
              )}
              {recording.state === "recording" && (
                <button
                  onClick={recording.stop}
                  style={{
                    fontSize: "0.65rem", padding: "0.35rem 0.6rem",
                    borderRadius: "0.3rem", border: "1px solid rgba(220,38,38,0.5)",
                    background: "rgba(220,38,38,0.25)", color: "#fca5a5",
                    cursor: "pointer", animation: "pulse 1.5s ease-in-out infinite",
                  }}
                >
                  ⏹ Stop Recording
                </button>
              )}
              {recording.state === "stopping" && (
                <span style={{ fontSize: "0.6rem", color: "#9ca3af" }}>Finalizing…</span>
              )}
              {recording.lastResult && (
                <>
                  <button
                    onClick={() => recording.download()}
                    style={{
                      fontSize: "0.65rem", padding: "0.35rem 0.6rem",
                      borderRadius: "0.3rem", border: "1px solid rgba(59,130,246,0.3)",
                      background: "rgba(59,130,246,0.1)", color: "#93c5fd",
                      cursor: "pointer",
                    }}
                  >
                    ⬇ Download
                  </button>
                  <span style={{ fontSize: "0.55rem", color: "#6b7280" }}>
                    {Math.round(recording.lastResult.durationMs / 1000)}s
                  </span>
                  <button
                    onClick={() => { recording.clearResult(); }}
                    title="Discard"
                    style={{
                      width: 22, height: 22, fontSize: "0.55rem", fontWeight: 700,
                      borderRadius: "0.25rem", border: "none", cursor: "pointer",
                      background: "rgba(55,65,81,0.5)", color: "#6b7280",
                    }}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
            {recording.error && (
              <div style={{ fontSize: "0.55rem", color: "#f87171" }}>{recording.error}</div>
            )}
          </div>

          {/* ---- Ducking Settings (Advanced) ---- */}
          <DuckingControls
            config={state.ducking}
            onChange={(partial) => mixer.setDuckingConfig(partial)}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BusStrip sub-component
// ---------------------------------------------------------------------------

interface BusStripProps {
  busId: BusId;
  bus: MixerState["buses"][BusId];
  onGain: (id: BusId, v: number) => void;
  onMute: (id: BusId) => void;
  onSolo: (id: BusId) => void;
  onOutputToggle: (id: BusId, output: "monitor" | "program") => void;
  isMaster?: boolean;
}

function BusStrip({
  busId,
  bus,
  onGain,
  onMute,
  onSolo,
  onOutputToggle,
  isMaster,
}: BusStripProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 60px 60px",
        gap: "0.4rem",
        alignItems: "center",
        padding: "0.5rem",
        background: isMaster
          ? "rgba(139,92,246,0.06)"
          : "rgba(15,23,42,0.5)",
        borderRadius: "0.4rem",
        border: isMaster
          ? "1px solid rgba(139,92,246,0.25)"
          : "1px solid rgba(55,65,81,0.4)",
      }}
    >
      {/* Left column: label + gain slider + mute/solo */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              color: isMaster ? "#c4b5fd" : "#e5e7eb",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              minWidth: 70,
            }}
          >
            {BUS_LABELS[busId]}
          </span>

          {/* Mute */}
          <button
            onClick={() => onMute(busId)}
            title={bus.muted ? "Unmute" : "Mute"}
            style={{
              width: 26,
              height: 22,
              fontSize: "0.6rem",
              fontWeight: 700,
              borderRadius: "0.25rem",
              border: "none",
              cursor: "pointer",
              background: bus.muted ? "#dc2626" : "rgba(55,65,81,0.7)",
              color: bus.muted ? "#fff" : "#9ca3af",
            }}
          >
            M
          </button>

          {/* Solo */}
          <button
            onClick={() => onSolo(busId)}
            title={bus.solo ? "Unsolo" : "Solo"}
            style={{
              width: 26,
              height: 22,
              fontSize: "0.6rem",
              fontWeight: 700,
              borderRadius: "0.25rem",
              border: "none",
              cursor: "pointer",
              background: bus.solo ? "#eab308" : "rgba(55,65,81,0.7)",
              color: bus.solo ? "#000" : "#9ca3af",
            }}
          >
            S
          </button>

          <span
            style={{
              fontSize: "0.6rem",
              color: "#6b7280",
              marginLeft: "auto",
              minWidth: 28,
              textAlign: "right",
            }}
          >
            {Math.round(bus.gain * 100)}%
          </span>
        </div>

        {/* Gain slider */}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={bus.gain}
          onChange={(e) => onGain(busId, Number(e.target.value))}
          style={{
            width: "100%",
            height: 4,
            accentColor: isMaster ? "#a78bfa" : "#6366f1",
            cursor: "pointer",
          }}
          aria-label={`${BUS_LABELS[busId]} gain`}
        />
      </div>

      {/* Monitor output toggle */}
      <div style={{ textAlign: "center" }}>
        <button
          onClick={() => onOutputToggle(busId, "monitor")}
          title={`Monitor (local headphones): ${bus.outputs.monitor ? "ON" : "OFF"}`}
          style={{
            width: 32,
            height: 22,
            fontSize: "0.55rem",
            fontWeight: 700,
            borderRadius: "0.25rem",
            border: "none",
            cursor: "pointer",
            background: bus.outputs.monitor ? "#059669" : "rgba(55,65,81,0.5)",
            color: bus.outputs.monitor ? "#fff" : "#6b7280",
          }}
        >
          MON
        </button>
      </div>

      {/* Program output toggle */}
      <div style={{ textAlign: "center" }}>
        <button
          onClick={() => onOutputToggle(busId, "program")}
          title={`Program (recording/export mix): ${bus.outputs.program ? "ON" : "OFF"}`}
          style={{
            width: 32,
            height: 22,
            fontSize: "0.55rem",
            fontWeight: 700,
            borderRadius: "0.25rem",
            border: "none",
            cursor: "pointer",
            background: bus.outputs.program ? "#dc2626" : "rgba(55,65,81,0.5)",
            color: bus.outputs.program ? "#fff" : "#6b7280",
          }}
        >
          PGM
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OutputFader sub-component
// ---------------------------------------------------------------------------

interface OutputFaderProps {
  label: string;
  sublabel?: string;
  color: string;
  value: number;
  onChange: (v: number) => void;
}

function OutputFader({ label, sublabel, color, value, onChange }: OutputFaderProps) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: "0.65rem", fontWeight: 600, color, textTransform: "uppercase" }}>
          {label}
        </span>
        <span style={{ fontSize: "0.6rem", color: "#6b7280" }}>
          {Math.round(value * 100)}%
        </span>
      </div>
      {sublabel && (
        <div style={{ fontSize: "0.5rem", color: "#6b7280", marginBottom: 3 }}>{sublabel}</div>
      )}
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          height: 4,
          accentColor: color,
          cursor: "pointer",
        }}
        aria-label={`${label} output gain`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DuckingControls sub-component (collapsible advanced section)
// ---------------------------------------------------------------------------

interface DuckingControlsProps {
  config: DuckingConfig;
  onChange: (partial: Partial<DuckingConfig>) => void;
}

function DuckingControls({ config, onChange }: DuckingControlsProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        padding: "0.6rem",
        background: "rgba(15,23,42,0.7)",
        borderRadius: "0.4rem",
        border: "1px solid rgba(55,65,81,0.5)",
      }}
    >
      <button
        onClick={() => setExpanded((prev) => !prev)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "0.3rem",
          padding: 0,
          width: "100%",
        }}
      >
        <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "#a78bfa", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          ⚙ Ducking
        </span>
        <span style={{ fontSize: "0.55rem", color: "#6b7280", marginLeft: "auto" }}>
          {expanded ? "▲" : "▼"}
        </span>
      </button>
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
          {/* Depth */}
          <DuckingSlider
            label="Depth"
            hint="Lower = more ducking"
            min={0}
            max={1}
            step={0.01}
            value={config.depth}
            display={`${Math.round(config.depth * 100)}%`}
            onChange={(v) => onChange({ depth: v })}
          />
          {/* Threshold */}
          <DuckingSlider
            label="Threshold"
            hint="RMS level to trigger ducking"
            min={0.001}
            max={0.1}
            step={0.001}
            value={config.threshold}
            display={config.threshold.toFixed(3)}
            onChange={(v) => onChange({ threshold: v })}
          />
          {/* Attack */}
          <DuckingSlider
            label="Attack"
            hint="Speed ducking kicks in"
            min={10}
            max={500}
            step={10}
            value={config.attackMs}
            display={`${config.attackMs}ms`}
            onChange={(v) => onChange({ attackMs: v })}
          />
          {/* Release */}
          <DuckingSlider
            label="Release"
            hint="Speed ducking fades out"
            min={50}
            max={2000}
            step={50}
            value={config.releaseMs}
            display={`${config.releaseMs}ms`}
            onChange={(v) => onChange({ releaseMs: v })}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DuckingSlider sub-component
// ---------------------------------------------------------------------------

interface DuckingSliderProps {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (v: number) => void;
}

function DuckingSlider({ label, hint, min, max, step, value, display, onChange }: DuckingSliderProps) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: "0.6rem", fontWeight: 600, color: "#d1d5db" }}>{label}</span>
        <span style={{ fontSize: "0.55rem", color: "#6b7280" }}>{display}</span>
      </div>
      <div style={{ fontSize: "0.5rem", color: "#4b5563", marginBottom: 2 }}>{hint}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          height: 3,
          accentColor: "#a78bfa",
          cursor: "pointer",
        }}
        aria-label={`Ducking ${label}`}
      />
    </div>
  );
}
