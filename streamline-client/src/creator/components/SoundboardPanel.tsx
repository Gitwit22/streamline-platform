import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";

type SfxEffect = "applause" | "boo" | "crickets" | "airhorn";

const EFFECTS: { id: SfxEffect; label: string; emoji: string }[] = [
  { id: "applause", label: "Applause", emoji: "👏" },
  { id: "boo", label: "Boo", emoji: "👎" },
  { id: "crickets", label: "Crickets", emoji: "🦗" },
  { id: "airhorn", label: "Air Horn", emoji: "📯" },
];

/**
 * How long to show the "cooling down" indicator after a trigger (ms).
 * Intentionally 500ms longer than the server-side SFX_COOLDOWN_MS (3000ms) to
 * prevent the UI from unlocking before the server is ready to accept another trigger.
 */
const COOLDOWN_MS = 3_500;

interface SoundboardPanelProps {
  roomId: string;
  /** Whether the soundboard feature is enabled on this platform and plan. */
  enabled?: boolean;
  /** Optionally restrict which effects are allowed (from room customization). */
  allowedEffects?: SfxEffect[];
}

// ── Audio synthesis ──────────────────────────────────────────────────────────

/**
 * Synthesizes a built-in SFX using the Web Audio API.
 * All synthesis is host-local (V1). Future: replace with LiveKit data channel broadcast.
 * Errors are swallowed so a broken AudioContext never disrupts room audio.
 */
function playSynthesizedEffect(effect: SfxEffect): void {
  try {
    const ctx = new AudioContext();

    const play = () => {
      const now = ctx.currentTime;
      switch (effect) {
        case "applause": {
          // Burst of filtered white noise fading out over 2s.
          const bufferSize = ctx.sampleRate * 2;
          const buf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
          const data = buf.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const filter = ctx.createBiquadFilter();
          filter.type = "bandpass";
          filter.frequency.value = 1800;
          filter.Q.value = 0.5;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.5, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 2);
          src.connect(filter);
          filter.connect(gain);
          gain.connect(ctx.destination);
          src.start(now);
          src.stop(now + 2);
          setTimeout(() => ctx.close(), 2500);
          break;
        }
        case "boo": {
          // Descending tone with vibrato over 1.5s.
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(300, now);
          osc.frequency.exponentialRampToValueAtTime(80, now + 1.5);
          gain.gain.setValueAtTime(0.35, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 1.5);
          setTimeout(() => ctx.close(), 2000);
          break;
        }
        case "crickets": {
          // Chirping oscillation: two tones alternating at 8 Hz for 2s.
          const chirpCount = 16;
          const chirpInterval = 0.125;
          for (let i = 0; i < chirpCount; i++) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = i % 2 === 0 ? 4200 : 3800;
            const t = now + i * chirpInterval;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.2, t + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + 0.1);
          }
          setTimeout(() => ctx.close(), 2500);
          break;
        }
        case "airhorn": {
          // Loud ascending blast: 0.6s fast rise then sustain.
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "square";
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
          gain.gain.setValueAtTime(0.6, now);
          gain.gain.setValueAtTime(0.5, now + 0.15);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.6);
          setTimeout(() => ctx.close(), 1000);
          break;
        }
        default:
          ctx.close();
      }
    };

    if (ctx.state === "suspended") {
      ctx.resume().then(play).catch(() => ctx.close());
    } else {
      play();
    }
  } catch {
    // Web Audio unavailable or blocked — fail silently.
  }
}

/**
 * SoundboardPanel — host-only panel for triggering built-in room sound effects.
 *
 * Safety rules:
 * - Effect failure must not affect room audio transport.
 * - Cooldown is enforced client-side (mirrored server-side) to prevent spam.
 * - Buttons show a visual cooldown indicator.
 * - If the panel is disabled or `enabled` is false, it renders a locked state.
 * - No custom sounds, no guest triggering, no persistent loops.
 */
export default function SoundboardPanel({
  roomId,
  enabled = true,
  allowedEffects,
}: SoundboardPanelProps) {
  const [isTriggering, setIsTriggering] = useState<SfxEffect | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastTriggered, setLastTriggered] = useState<SfxEffect | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
    };
  }, []);

  const isCoolingDown = Date.now() < cooldownUntil;
  const remainingCooldownMs = Math.max(0, cooldownUntil - Date.now());

  const handleTrigger = useCallback(
    async (effect: SfxEffect) => {
      if (!enabled || isTriggering || Date.now() < cooldownUntil) return;

      setIsTriggering(effect);
      setLastError(null);

      try {
        const res = await apiFetch(
          `/api/rooms/${encodeURIComponent(roomId)}/sfx/trigger`,
          {
            method: "POST",
            body: JSON.stringify({ effect }),
          },
          { allowNonOk: true }
        );

        const ct = res.headers.get("content-type") || "";
        const data: any = ct.includes("application/json") ? await res.json() : null;

        if (res.status === 429) {
          // Use server-provided retry window when available.
          const retryMs = data?.retryAfterMs ?? COOLDOWN_MS;
          setCooldownUntil(Date.now() + retryMs);
        } else if (!res.ok) {
          const msg = data?.error || `HTTP ${res.status}`;
          setLastError(msg === "effect_not_allowed" ? "Effect not allowed" : "Could not play effect");
        } else {
          // Success — play the effect locally (V1: host-only audio).
          playSynthesizedEffect(effect);
          // Start local cooldown.
          setLastTriggered(effect);
          setCooldownUntil(Date.now() + COOLDOWN_MS);
          if (cooldownRef.current) clearTimeout(cooldownRef.current);
          cooldownRef.current = setTimeout(() => {
            setLastTriggered(null);
          }, COOLDOWN_MS);
        }
      } catch {
        // Network failure — fail silently, do not disrupt room.
        setLastError("Could not reach server");
      } finally {
        setIsTriggering(null);
      }
    },
    [enabled, isTriggering, cooldownUntil, roomId]
  );

  const effectiveAllowed = allowedEffects && allowedEffects.length > 0
    ? allowedEffects
    : EFFECTS.map((e) => e.id);

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.headerLabel}>🎚 Sound Effects</span>
        {!enabled && <span style={styles.lockedBadge}>Locked</span>}
      </div>

      {lastError && (
        <div style={styles.error} aria-live="polite">
          {lastError}
        </div>
      )}

      <div style={styles.grid}>
        {EFFECTS.map((fx) => {
          const isAllowed = effectiveAllowed.includes(fx.id);
          const isFiring = isTriggering === fx.id;
          const wasTriggered = lastTriggered === fx.id;
          const disabled = !enabled || !isAllowed || !!isTriggering || isCoolingDown;

          return (
            <button
              key={fx.id}
              aria-label={`Trigger ${fx.label}`}
              disabled={disabled}
              onClick={() => handleTrigger(fx.id)}
              style={{
                ...styles.effectBtn,
                ...(isFiring ? styles.effectBtnFiring : {}),
                ...(wasTriggered ? styles.effectBtnActive : {}),
                ...(disabled ? styles.effectBtnDisabled : {}),
              }}
            >
              <span style={{ fontSize: 20, display: "block", marginBottom: 2 }}>
                {fx.emoji}
              </span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>{fx.label}</span>
              {isFiring && (
                <span style={styles.firingDot} aria-hidden />
              )}
            </button>
          );
        })}
      </div>

      {isCoolingDown && (
        <CooldownBar durationMs={COOLDOWN_MS} remainingMs={remainingCooldownMs} />
      )}
    </div>
  );
}

// ── CooldownBar ─────────────────────────────────────────────────────────────

function CooldownBar({
  durationMs,
  remainingMs,
}: {
  durationMs: number;
  remainingMs: number;
}) {
  const [pct, setPct] = useState(100);

  useEffect(() => {
    const startPct = (remainingMs / durationMs) * 100;
    setPct(startPct);

    const interval = setInterval(() => {
      setPct((prev) => Math.max(0, prev - (100 / (durationMs / 50))));
    }, 50);

    return () => clearInterval(interval);
  }, [durationMs, remainingMs]);

  return (
    <div
      aria-label={`Cooldown: ${(remainingMs / 1000).toFixed(1)}s`}
      style={{
        marginTop: 8,
        height: 3,
        background: "rgba(255,255,255,0.1)",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          background: "#6366f1",
          transition: "width 50ms linear",
          borderRadius: 2,
        }}
      />
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 12,
    padding: "12px 14px",
    userSelect: "none",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  headerLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#ccc",
  },
  lockedBadge: {
    fontSize: 11,
    color: "#888",
    background: "rgba(255,255,255,0.06)",
    borderRadius: 8,
    padding: "2px 8px",
    border: "1px solid rgba(255,255,255,0.1)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 8,
  },
  effectBtn: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    color: "#e0e0e0",
    cursor: "pointer",
    padding: "10px 6px",
    textAlign: "center" as const,
    transition: "background 0.15s, transform 0.1s",
    position: "relative" as const,
    lineHeight: 1.3,
  },
  effectBtnFiring: {
    background: "rgba(99,102,241,0.25)",
    borderColor: "rgba(99,102,241,0.5)",
    transform: "scale(0.95)",
  },
  effectBtnActive: {
    background: "rgba(99,102,241,0.15)",
    borderColor: "rgba(99,102,241,0.35)",
  },
  effectBtnDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },
  firingDot: {
    display: "block",
    position: "absolute" as const,
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#6366f1",
  },
  error: {
    color: "#f87171",
    fontSize: 12,
    marginBottom: 8,
    padding: "4px 8px",
    background: "rgba(248,113,113,0.1)",
    borderRadius: 6,
  },
};
